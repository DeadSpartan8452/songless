'use strict';

/**
 * Téléchargement d'un morceau et intégration dans Songless.
 *
 * On donne un titre ("darude sandstorm") ou une URL, et on obtient :
 *   musiques/Artiste - Titre [videoId].mp3   +   une entrée dans metadata.json
 *
 * yt-dlp fait le téléchargement, ffmpeg l'encodage MP3. Les deux sont détectés
 * automatiquement (exécutable dans le PATH, module Python, ou install winget).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const T = require('./titles');
const store = require('./store');
const dupes = require('./dupes');
const musicbrainz = require('./musicbrainz');
const automaticMetadata = require('./automatic-metadata');
const antivirus = require('./antivirus');
const youtubeAndroid = require('./youtube-android');

const ROOT = path.join(__dirname, '..');
const MOBILE_HOST = process.env.SONGLESS_MOBILE_HOST === '1';
const MUSIC_DIR = process.env.SONGLESS_MUSIC_DIR
  ? path.resolve(process.env.SONGLESS_MUSIC_DIR)
  : path.join(ROOT, 'musiques');
const TMP_DIR = path.join(path.dirname(MUSIC_DIR), '.cache', 'dl');

function validatePublicMediaUrl(value) {
  let parsed;
  try { parsed = new URL(String(value).trim()); }
  catch (_) { throw new Error('Adresse invalide. Utilise une URL YouTube complète.'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Seules les adresses web http/https sont acceptées.');
  }
  if (parsed.username || parsed.password) throw new Error('Une URL contenant des identifiants est refusée.');
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const youtube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  if (!youtube) {
    throw new Error('Pour protéger l’ordinateur, les URL directes sont limitées à YouTube. Tu peux toujours saisir un titre.');
  }
  return parsed.toString();
}

// ---------------------------------------------------------------- outils externes

let _ytdlp = null;
let _ffmpeg = null;

/** Renvoie de quoi lancer yt-dlp : { cmd, prefixArgs } */
function findYtDlp() {
  if (_ytdlp) return _ytdlp;

  const candidates = [
    { cmd: 'yt-dlp', prefixArgs: [] },
    { cmd: 'yt-dlp.exe', prefixArgs: [] },
    { cmd: 'python', prefixArgs: ['-m', 'yt_dlp'] },
    { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
    { cmd: 'py', prefixArgs: ['-m', 'yt_dlp'] },
  ];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    candidates.unshift({
      cmd: path.join(local, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
      prefixArgs: [],
    });
    const packageRoot = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const directory of fs.readdirSync(packageRoot)) {
        if (!/^yt-dlp\.yt-dlp_/i.test(directory)) continue;
        candidates.unshift({ cmd: path.join(packageRoot, directory, 'yt-dlp.exe'), prefixArgs: [] });
      }
    } catch (_) { /* installation Winget absente */ }
  }

  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.prefixArgs, '--version'], {
        encoding: 'utf8', timeout: 25000, windowsHide: true,
      });
      if (r.status === 0 && /\d/.test(r.stdout || '')) {
        _ytdlp = { ...c, version: (r.stdout || '').trim() };
        return _ytdlp;
      }
    } catch (_) { /* candidat suivant */ }
  }
  return null;
}

/** Renvoie le dossier contenant ffmpeg, ou null. */
function findFfmpeg() {
  if (_ffmpeg !== null) return _ffmpeg;

  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0) {
      _ffmpeg = '';           // dans le PATH : rien à préciser à yt-dlp
      return _ffmpeg;
    }
  } catch (_) { /* on continue */ }

  const local = process.env.LOCALAPPDATA;
  const dirs = [path.join(ROOT, 'tools', 'bin')];
  if (local) {
    dirs.push(path.join(local, 'Microsoft', 'WinGet', 'Links'));
    const pkgRoot = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pkgRoot)) {
        if (!/^Gyan\.FFmpeg/i.test(d)) continue;
        const base = path.join(pkgRoot, d);
        for (const sub of fs.readdirSync(base)) {
          dirs.push(path.join(base, sub, 'bin'));
        }
      }
    } catch (_) { /* pas de winget */ }
  }

  for (const dir of dirs) {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    if (fs.existsSync(path.join(dir, exe))) {
      _ffmpeg = dir;
      return _ffmpeg;
    }
  }
  _ffmpeg = null;
  return null;
}

function checkTools() {
  if (MOBILE_HOST) {
    const ready = youtubeAndroid.available();
    return {
      ok: ready,
      engine: ready ? 'youtubejs' : null,
      ytdlp: null,
      ffmpeg: null,
      missing: ready ? [] : ['moteur audio Android'],
    };
  }
  const ytdlp = findYtDlp();
  const ffmpeg = findFfmpeg();
  return {
    ok: !!ytdlp && ffmpeg !== null,
    ytdlp: ytdlp ? ytdlp.version : null,
    ffmpeg: ffmpeg === null ? null : (ffmpeg || 'PATH'),
    missing: [
      !ytdlp ? 'yt-dlp (pip install yt-dlp)' : null,
      ffmpeg === null ? 'ffmpeg (winget install Gyan.FFmpeg)' : null,
    ].filter(Boolean),
  };
}

/** Lance yt-dlp et renvoie sa sortie. onLine reçoit la progression au fil de l'eau. */
function runYtDlp(args, onLine, options = {}) {
  const tool = findYtDlp();
  if (!tool) return Promise.reject(new Error('yt-dlp introuvable. Installe-le : pip install yt-dlp'));

  return new Promise((resolve, reject) => {
    const child = spawn(tool.cmd, [...tool.prefixArgs, ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let buf = '';
    let timedOut = false;
    const timeoutMs = Number(options.timeoutMs) || 0;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs) : null;

    child.stdout.on('data', (d) => {
      stdout += d;
      if (!onLine) return;
      buf += d.toString();
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) onLine(l.trim());
    });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const hasJsonResult = stdout.split(/\r?\n/)
        .some((line) => line.trim().startsWith('{'));
      if (code === 0 || (options.acceptPartialJson && hasJsonResult)) {
        resolve({ stdout, stderr });
      }
      else if (timedOut) reject(new Error(`yt-dlp a dépassé ${Math.round(timeoutMs / 1000)} s`));
      else reject(new Error(cleanYtDlpError(stderr) || `yt-dlp a échoué (code ${code})`));
    });
  });
}

function cleanYtDlpError(stderr) {
  const line = String(stderr || '').split(/\r?\n/).find((l) => /^ERROR/i.test(l));
  return line ? line.replace(/^ERROR:\s*/i, '').trim() : '';
}

// ---------------------------------------------------------------- choix du résultat

// Mots qui trahissent une version qu'on ne veut pas pour un blind test.
const BAD_WORDS = ['live', 'cover', 'reaction', 'sped up', 'slowed', 'nightcore',
  'karaoke', 'karaoké', 'instrumental', '8d', 'bass boosted', '1 hour', '1 heure',
  '10 hours', 'loop', 'compilation', 'tutorial', 'reversed', 'mashup', 'medley',
  'lesson', 'behind the scenes', 'interview', 'trailer'];

function scoreCandidate(entry, query) {
  const title = String(entry.title || '');
  const t = T.norm(title);
  const q = T.norm(query);
  const dur = entry.duration || 0;
  let score = 0;

  if (dur >= 45 && dur <= 420) score += 4;
  else if (dur > 0 && dur <= 900) score += 1;
  else if (dur > 900) score -= 6;
  else if (dur === 0) score -= 1;

  if (q && t.includes(q)) score += 3;
  const qw = new Set(q.split(' ').filter(Boolean));
  const tw = new Set(t.split(' ').filter(Boolean));
  const overlap = [...qw].filter((w) => tw.has(w)).length;
  score += qw.size ? (overlap / qw.size) * 3 : 0;

  // On ne pénalise que si l'utilisateur ne l'a pas demandé explicitement.
  for (const bad of BAD_WORDS) {
    if (t.includes(T.norm(bad)) && !q.includes(T.norm(bad))) score -= 2.5;
  }

  const channel = T.norm(entry.channel || entry.uploader || '');
  if (channel.includes('topic') || entry.channel_is_verified) score += 2;
  if ((entry.view_count || 0) > 1000000) score += 1.5;
  else if ((entry.view_count || 0) > 50000) score += 0.5;

  return score;
}

async function searchBest(query, onLog) {
  if (MOBILE_HOST) {
    const entries = await youtubeAndroid.searchVideos(query, 6);
    if (entries.length === 0) return null;
    const ranked = entries
      .map((e) => ({e, score: scoreCandidate(e, query)}))
      .sort((a, b) => b.score - a.score);
    if (onLog) onLog(`${entries.length} résultats, retenu : ${ranked[0].e.title}`);
    return ranked[0].e.url;
  }
  const args = [`ytsearch6:${query}`, '--flat-playlist', '--dump-json',
    '--no-warnings', '--ignore-config', '--socket-timeout', '20'];
  const { stdout } = await runYtDlp(args, null, {
    acceptPartialJson: true,
    timeoutMs: 45000,
  });

  const entries = stdout.split(/\r?\n/)
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);

  if (entries.length === 0) return null;

  const ranked = entries
    .map((e) => ({ e, score: scoreCandidate(e, query) }))
    .sort((a, b) => b.score - a.score);

  if (onLog) {
    onLog(`${entries.length} résultats, retenu : ${ranked[0].e.title}`);
  }
  const best = ranked[0].e;
  return best.url || (best.id ? `https://www.youtube.com/watch?v=${best.id}` : null);
}

/** Recherche une seule fiche YouTube complète, sans télécharger l'audio. */
async function searchMetadata(query) {
  if (MOBILE_HOST) {
    const entries = await youtubeAndroid.searchVideos(query, 5);
    let lastError = null;
    for (const entry of entries) {
      try {
        return await youtubeAndroid.getInfo(entry.url);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }
  const searchArgs = [
    `ytsearch5:${query}`,
    '--flat-playlist', '--dump-json', '--no-warnings', '--ignore-config',
    '--socket-timeout', '15',
  ];
  const { stdout } = await runYtDlp(searchArgs, null, {
    acceptPartialJson: true,
    timeoutMs: 15000,
  });
  const entries = stdout.split(/\r?\n/)
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter(Boolean);
  if (!entries.length) return null;
  const ranked = entries
    .map((entry) => ({ entry, score: scoreCandidate(entry, query) }))
    .sort((a, b) => b.score - a.score);
  let lastError = null;
  const deadline = Date.now() + 30000;
  for (const candidate of ranked) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const url = candidate.entry.url
      || (candidate.entry.id
        ? `https://www.youtube.com/watch?v=${candidate.entry.id}` : null);
    if (!url) continue;
    try {
      const detail = await runYtDlp([
        url, '--dump-json', '--skip-download', '--no-playlist',
        '--no-warnings', '--ignore-config', '--socket-timeout', '15',
      ], null, {
        acceptPartialJson: true,
        timeoutMs: Math.min(12000, remainingMs),
      });
      const info = detail.stdout.split(/\r?\n/)
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
        .find(Boolean);
      if (info) return info;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

// ---------------------------------------------------------------- playlists

/**
 * Énumère le contenu d'une playlist sans rien télécharger.
 *
 * `--flat-playlist` se contente de la liste : aucune page vidéo n'est ouverte,
 * une playlist de 200 titres se lit en quelques secondes. Le téléchargement
 * réel est fait ensuite, titre par titre, par downloadTrack().
 *
 * @param {string} url        URL de playlist (YouTube, YouTube Music)
 * @param {object} opts       { limite, onLog }
 * @returns {Promise<{titre: string, entrees: Array<{id,title,url,duration}>, tronquee: boolean}>}
 */
async function listPlaylist(url, opts = {}) {
  const limite = Math.max(1, Math.min(opts.limite || 100, 500));
  const log = opts.onLog || (() => {});

  if (!/^https?:\/\//i.test(String(url).trim())) {
    throw new Error('Colle l\'adresse complète d\'une playlist (https://...).');
  }
  const safeUrl = validatePublicMediaUrl(url);

  if (MOBILE_HOST) {
    log('Lecture de la playlist avec le moteur Android...');
    const result = await youtubeAndroid.listPlaylist(safeUrl, limite + 1);
    if (result.entries.length === 0) {
      throw new Error('Aucun titre trouvé : cette adresse est-elle bien une playlist ?');
    }
    return {
      titre: result.title,
      entrees: result.entries.slice(0, limite).map(entry => ({
        id: entry.id,
        title: entry.title || entry.id,
        url: entry.url,
        duration: entry.duration || 0,
      })),
      tronquee: result.entries.length > limite,
    };
  }

  log('Lecture de la playlist...');
  // On demande un élément de plus que le plafond : c'est ce qui permet de dire
  // « il en reste » plutôt que de tronquer en silence.
  const args = [
    safeUrl,
    '--flat-playlist', '--dump-json',
    '--playlist-end', String(limite + 1),
    '--no-warnings', '--ignore-config', '--socket-timeout', '20',
  ];
  const { stdout } = await runYtDlp(args);

  const brutes = stdout.split(/\r?\n/)
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);

  if (brutes.length === 0) {
    throw new Error('Aucun titre trouvé : cette adresse est-elle bien une playlist ?');
  }

  // Une URL de vidéo isolée passée ici renvoie une seule entrée sans playlist :
  // on le dit plutôt que de lancer un import d'un morceau déguisé.
  const titre = brutes[0].playlist_title || brutes[0].playlist || '';

  const entrees = brutes.slice(0, limite).map((e) => ({
    id: e.id || null,
    title: e.title || e.id || 'sans titre',
    url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
    duration: e.duration || 0,
  })).filter((e) => e.url);

  return { titre, entrees, tronquee: brutes.length > limite };
}

// ---------------------------------------------------------------- compilations découpées en chapitres

const GENERIC_CHAPTER = /^(intro|introduction|outro|conclusion|credits?|sponsor|publicit[eé]|transition|chapitre|chapter|track|piste|song|titre|partie)\s*\d*$/i;
const COMPILATION_TITLE = /\b(top\s*\d+|compilation|best\s+of|greatest\s+hits|playlist|medley|mix|mashup|hits?|songs?|musiques?|tracks?)\b/i;

function cleanChapterTitle(value) {
  return String(value || '')
    .replace(/^\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]|#?\d{1,3}\s*[.):-])\s*/i, '')
    .replace(/\s*[-–—]?\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function compilationFromInfo(info, limite = 100) {
  const max = Math.max(1, Math.min(Number(limite) || 100, 100));
  const rawChapters = Array.isArray(info && info.chapters) ? info.chapters : [];
  const seen = new Set();
  const all = [];

  for (const chapter of rawChapters) {
    const title = cleanChapterTitle(chapter && chapter.title);
    const duration = Math.max(0, Number(chapter && chapter.end_time) - Number(chapter && chapter.start_time));
    const key = T.tightKey(title);
    if (title.length < 3 || !key || GENERIC_CHAPTER.test(title) || seen.has(key)) continue;
    if (/^(chapitre|chapter|track|piste|song|titre|partie)\s*\d+$/i.test(title)) continue;
    seen.add(key);
    all.push({ title, query: title, duration: Math.round(duration || 0) });
  }

  const title = String((info && info.title) || 'Compilation').trim();
  const duration = Math.round(Number(info && info.duration) || 0);
  const categories = Array.isArray(info && info.categories) ? info.categories.join(' ') : '';
  const musicCategory = /\b(music|musique)\b/i.test(categories);
  const titleLooksLikeCompilation = COMPILATION_TITLE.test(title);
  const canSplit = all.length >= 2 && (musicCategory || titleLooksLikeCompilation);
  const isCompilation = canSplit
    || duration > 1800
    || (duration >= 900 && titleLooksLikeCompilation);

  return {
    title,
    duration,
    isCompilation,
    canSplit,
    entries: all.slice(0, max),
    truncated: all.length > max,
    chapterCount: all.length,
  };
}

async function inspectMediaUrl(url, opts = {}) {
  const safeUrl = validatePublicMediaUrl(url);
  const log = opts.onLog || (() => {});
  log('Analyse de la vidéo et de ses chapitres...');
  if (MOBILE_HOST) {
    const info = await youtubeAndroid.getInfo(safeUrl);
    return {info, ...compilationFromInfo(info, opts.limite)};
  }
  const args = [safeUrl, '--dump-single-json', '--skip-download', '--no-playlist',
    '--no-warnings', '--ignore-config', '--socket-timeout', '20'];
  const { stdout } = await runYtDlp(args);
  const info = JSON.parse(stdout.split(/\r?\n/).find((line) => line.trim().startsWith('{')));
  return { info, ...compilationFromInfo(info, opts.limite) };
}

// ---------------------------------------------------------------- nommage

/** Nom de fichier sûr sous Windows, sans casser les accents. */
function safeFileName(str) {
  return String(str)
    .replace(/[<>:"/\\|?* -]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\.+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim() || 'sans-titre';
}

/**
 * Cherche un morceau déjà présent qui serait le même que celui qu'on s'apprête
 * à télécharger — même si le fichier porte un tout autre nom.
 * On compare le titre affiché, le titre d'origine et l'artiste, normalisés.
 */
function findSimilar(candidate) {
  return dupes.chercherDoublon(candidate);
}

function findExistingByVideoId(videoId) {
  const tracks = store.load(true).tracks;
  for (const [fileName, entry] of Object.entries(tracks)) {
    if (entry.videoId === videoId && fs.existsSync(path.join(MUSIC_DIR, fileName))) {
      return { fileName, entry };
    }
  }
  try {
    const hit = fs.readdirSync(MUSIC_DIR).find((f) => f.includes(`[${videoId}]`));
    if (hit) return { fileName: hit, entry: tracks[hit] || null };
  } catch (_) { /* dossier absent */ }
  return null;
}

// ---------------------------------------------------------------- téléchargement

/**
 * Télécharge un morceau et l'ajoute à la bibliothèque.
 *
 * @param {string} query        titre à chercher, ou URL directe
 * @param {object} opts         { genre, title, artist, force, onLog }
 * @returns {Promise<object>}   l'entrée ajoutée
 */
async function downloadTrack(query, opts = {}) {
  const { genre = null, artist = null, force = false } = opts;
  const log = opts.onLog || (() => {});

  const tools = checkTools();
  if (!tools.ok) {
    throw new Error(`Outil manquant : ${tools.missing.join(', ')}`);
  }

  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // 1. Trouver la vidéo
  const isUrl = /^https?:\/\//i.test(query.trim());
  log(isUrl ? 'Lecture de l\'URL...' : `Recherche de « ${query} »...`);
  const target = isUrl ? validatePublicMediaUrl(query) : await searchBest(query, log);
  if (!target) throw new Error(`Aucun résultat pour « ${query} »`);

  // 2. Métadonnées avant téléchargement (permet de détecter un doublon tout de suite)
  let info = opts.prefetchedInfo && typeof opts.prefetchedInfo === 'object'
    ? opts.prefetchedInfo : null;
  if (!info) {
    if (MOBILE_HOST) {
      info = await youtubeAndroid.getInfo(target);
    } else {
      const infoArgs = [target, '--dump-json', '--no-playlist', '--no-warnings',
        '--ignore-config', '--socket-timeout', '20'];
      const { stdout: infoRaw } = await runYtDlp(infoArgs);
      info = JSON.parse(infoRaw.split(/\r?\n/).find((l) => l.trim().startsWith('{')));
    }
  }

  const videoId = info.id;
  const existing = findExistingByVideoId(videoId);
  if (existing && !force) {
    log('Déjà dans la bibliothèque (même vidéo).');
    return { ...(existing.entry || {}), fileName: existing.fileName, alreadyPresent: true };
  }

  if ((info.duration || 0) > 1800) {
    throw new Error(`Ce média dure ${Math.round(info.duration / 60)} min : ce n'est pas un titre isolé.`);
  }

  // 2 bis. On calcule la fiche avant de télécharger : ça permet de repérer un
  // morceau déjà présent sous un autre nom de fichier, et d'éviter le doublon.
  const entry = buildEntry(info, { artist, genre });
  entry.unofficialVariant = automaticMetadata.estVersionNonOfficielle(entry);

  const appliquerSecoursYoutube = () => Object.assign(entry, automaticMetadata.proposition(entry, {
    source: 'youtube-unofficial',
    videoId: entry.videoId,
    genre: entry.genre && entry.genre !== 'Autre' ? entry.genre : null,
    genreSource: entry.genreSource,
    genreConfidence: entry.genreConfidence,
  }));

  // Chaque futur téléchargement est vérifié sur le morceau lui-même. Les
  // informations YouTube restent un secours : une date de mise en ligne n'est
  // pas confondue avec l'année de première sortie.
  if (entry.unofficialVariant) {
    appliquerSecoursYoutube();
  } else {
    log('Vérification du titre, de l’artiste et de l’année...');
    try {
      const artisteRecherche = automaticMetadata.artisteManquant(entry.artist)
        ? '' : entry.artist;
      const titreRecherche = entry.metadataLookupTitle || entry.title;
      let resultat = await musicbrainz.enregistrement(titreRecherche, artisteRecherche);
      if (!resultat && artisteRecherche
        && !['high', 'medium'].includes(entry.artistConfidence)
        && musicbrainz.enregistrementDansCache(titreRecherche, artisteRecherche)) {
        resultat = await musicbrainz.enregistrement(titreRecherche, '');
      }
      const rechercheTerminee = musicbrainz.enregistrementDansCache(
        titreRecherche, artisteRecherche
      ) && (!artisteRecherche
        || ['high', 'medium'].includes(entry.artistConfidence)
        || musicbrainz.enregistrementDansCache(titreRecherche, ''));
      if (resultat) {
        Object.assign(entry, automaticMetadata.proposition(entry, resultat));
      } else if (rechercheTerminee) {
        appliquerSecoursYoutube();
      }
    } catch (_) {
      /* hors ligne : les informations YouTube restent, une relance les rattrapera */
    }
  }

  // Même traitement que le reste de la bibliothèque : quand le genre ne vient
  // ni de toi ni de la table des titres connus, MusicBrainz a le dernier mot.
  // Il est plus fiable que les tags YouTube, où « tiktok » classerait Kina en
  // meme alors que c'est de l'électro.
  const genreIncertain = ['youtube', 'filename', 'unknown'].includes(entry.genreSource);
  if (!entry.unofficialVariant && genreIncertain && entry.artist) {
    log('Recherche du genre...');
    try {
      const fiche = await musicbrainz.genreArtiste(entry.artist);
      if (fiche && fiche.genre) {
        entry.genre = fiche.genre;
        entry.genreSource = 'musicbrainz';
        entry.genreConfidence = 'medium';
      }
    } catch (_) {
      /* pas de réseau : on garde ce qu'on a, rattrapable via tools/enrich.js */
    }
  }

  if (!force) {
    const twin = findSimilar(entry);
    if (twin) {
      log(`Déjà dans la bibliothèque : « ${twin.entry.title} » (${twin.fileName})`);
      return { ...twin.entry, fileName: twin.fileName, alreadyPresent: true };
    }
  }

  // 3. Téléchargement. Android conserve le M4A fourni par YouTube : aucune
  // conversion, aucun Python et aucun binaire exécutable supplémentaire.
  log('Téléchargement...');
  const extension = MOBILE_HOST ? '.m4a' : '.mp3';
  const tmpFile = path.join(TMP_DIR, `${videoId}${extension}`);
  if (MOBILE_HOST) {
    await youtubeAndroid.downloadAudio(videoId, tmpFile, {
      onProgress: (received, total) => {
        const percent = Math.min(100, Math.round(received * 100 / total));
        log(`Téléchargement ${percent} %`);
      },
    });
  } else {
    const tmpTemplate = path.join(TMP_DIR, `${videoId}.%(ext)s`);
    const ffmpegDir = findFfmpeg();
    const dlArgs = [
      target,
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3', '--audio-quality', '192K',
      '-o', tmpTemplate,
      '--no-playlist', '--no-warnings', '--ignore-config',
      '--newline', '--progress',
      '--socket-timeout', '20', '--retries', '3',
    ];
    if (ffmpegDir) dlArgs.push('--ffmpeg-location', ffmpegDir);

    await runYtDlp(dlArgs, (line) => {
      const m = line.match(/\[download\]\s+([\d.]+)%/);
      if (m) log(`Téléchargement ${Math.round(parseFloat(m[1]))} %`);
      else if (/\[ExtractAudio\]/.test(line)) log('Conversion en MP3...');
    });
  }

  if (!fs.existsSync(tmpFile)) {
    const leftover = fs.readdirSync(TMP_DIR).find((f) => f.startsWith(videoId));
    throw new Error(leftover
      ? `Le traitement audio a échoué (fichier ${path.extname(leftover)} obtenu).`
      : 'Fichier audio introuvable après téléchargement.');
  }

  // Le résultat de yt-dlp reste en quarantaine jusqu'à l'analyse. On analyse
  // le fichier réellement produit, pas seulement l'URL fournie au téléphone.
  log(`Analyse antivirus ${antivirus.status().name}...`);
  try {
    await antivirus.scan(tmpFile);
  } catch (error) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    throw error;
  }

  // 4. Nom de fichier définitif
  const sourceStem = safeFileName(info.title || info.track || entry.title);
  let fileName = `${sourceStem}${extension}`;
  let finalPath = path.join(MUSIC_DIR, fileName);
  if (fs.existsSync(finalPath) && (!existing || existing.fileName !== fileName)) {
    fileName = `${sourceStem} [${videoId}]${extension}`;
    finalPath = path.join(MUSIC_DIR, fileName);
  }

  if (existing && existing.fileName !== fileName) {
    try { fs.unlinkSync(path.join(MUSIC_DIR, existing.fileName)); } catch (_) { /* déjà parti */ }
    store.remove(existing.fileName);
  }
  fs.renameSync(tmpFile, finalPath);

  entry.fileName = fileName;
  store.set(fileName, entry);

  log('Fichier sain — ajouté à la bibliothèque.');
  return entry;
}

/** Construit l'entrée de métadonnées à partir de la fiche yt-dlp. */
function buildEntry(info, override = {}) {
  const overrides = T.loadOverrides();

  // Le titre source reste exactement celui fourni par YouTube. Les nettoyages,
  // découpages et translittérations servent uniquement aux recherches et aux
  // réponses acceptées ; seul le crayon peut changer le titre affiché.
  const rawTitle = String(info.track || info.title || '').trim();
  let rawArtist = info.artist || info.creator || info.uploader || '';
  let artistSource = info.artist || info.creator ? 'youtube' : 'youtube-upload';
  let artistConfidence = info.artist || info.creator ? 'medium' : 'low';
  let workTitle = T.cleanTitle(rawTitle);

  // "Artiste - Titre" dans le titre de la vidéo quand yt-dlp n'a pas les champs musicaux
  if (!info.track) {
    const split = T.splitArtistTitle(workTitle);
    if (split.artist) {
      if (!info.artist) rawArtist = split.artist;
      if (!info.artist) {
        artistSource = 'filename';
        artistConfidence = 'low';
      }
      workTitle = split.title;
    }
  }
  rawArtist = T.cleanTitle(String(rawArtist).replace(/\s*-\s*Topic$/i, ''));

  const searchableTitle = workTitle;
  const title = rawTitle || searchableTitle;
  let originalTitle = '';
  let genre = null;
  let aliases = [];
  let needsReview = false;

  // Nom réellement connu (Polish Cow, Coffin Dance, ...)
  const ov = T.matchOverride(overrides, workTitle, info.title, info.track);
  if (ov) {
    if (ov.genre) genre = ov.genre;
    if (ov.artist) rawArtist = ov.artist;
    if (ov.artist) {
      artistSource = 'manual';
      artistConfidence = 'high';
    }
    aliases = [ov.title, ov.originalTitle, ...(ov.aliases || [])].filter(Boolean);
  } else if (T.detectScript(workTitle) !== 'latin') {
    const translated = T.cleanTitle(T.translit(workTitle));
    if (T.isReadableLatin(translated) && T.norm(translated)) aliases.push(translated);
  }

  // Un titre d'origine identique au titre affiché n'apprend rien : on l'efface.
  if (T.norm(originalTitle) === T.norm(title)) originalTitle = '';

  const artist = T.cleanTitle(override.artist || rawArtist);
  if (override.artist) {
    artistSource = 'manual';
    artistConfidence = 'high';
  }

  // Provenance du genre : elle décide si MusicBrainz a son mot à dire ensuite.
  // Les tags YouTube sont bruyants (« tiktok », « meme »…), donc peu fiables.
  let finalGenre = T.resolveGenre(override.genre);
  let genreSource = finalGenre ? 'manual' : null;
  let genreConfidence = finalGenre ? 'high' : 'unknown';

  if (!finalGenre && genre) {
    finalGenre = genre;
    genreSource = 'manual';
    genreConfidence = 'high';
  }
  if (!finalGenre) {
    const parTag = T.resolveGenre(info.genre);
    if (parTag) {
      finalGenre = parTag;
      genreSource = 'youtube';
      genreConfidence = 'medium';
    }
  }
  if (!finalGenre) {
    const devine = pickGenre(info, title, artist);
    if (devine) {
      finalGenre = devine;
      genreSource = 'filename';
      genreConfidence = 'low';
    }
  }
  if (!finalGenre) {
    finalGenre = 'Autre';
    genreSource = 'unknown';
    genreConfidence = 'unknown';
  }

  const releaseYear = Number(info.release_year) || null;
  const uploadYear = !releaseYear && info.upload_date
    ? Number(String(info.upload_date).slice(0, 4)) || null : null;

  return {
    videoId: info.id,
    title: title.trim(),
    metadataLookupTitle: searchableTitle.trim(),
    originalTitle: originalTitle.trim(),
    artist: artist.trim(),
    artistSource,
    artistConfidence,
    genre: finalGenre,
    genreSource,
    genreConfidence,
    duration: Math.round(info.duration || 0),
    year: releaseYear || uploadYear,
    yearSource: releaseYear ? 'youtube' : (uploadYear ? 'youtube-upload' : 'unknown'),
    yearConfidence: releaseYear ? 'medium' : (uploadYear ? 'low' : 'unknown'),
    source: info.webpage_url || null,
    aliases: T.buildAliases(
      title, searchableTitle, originalTitle, aliases,
      artist && searchableTitle ? `${artist} ${searchableTitle}` : ''
    ),
    needsReview,
    reviewed: false,
    addedAt: new Date().toISOString(),
  };
}

function pickGenre(info, title, artist) {
  const g = T.guessGenre([
    (info.categories || []).join(' '),
    (info.tags || []).slice(0, 25).join(' '),
    info.title || '',
    title,
    artist,
  ]);
  return g === 'Autre' ? null : g;
}

module.exports = {
  checkTools,
  findYtDlp,
  findFfmpeg,
  downloadTrack,
  listPlaylist,
  inspectMediaUrl,
  compilationFromInfo,
  cleanChapterTitle,
  searchBest,
  searchMetadata,
  buildEntry,
  safeFileName,
  validatePublicMediaUrl,
  MUSIC_DIR,
};
