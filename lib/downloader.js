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
const musicbrainz = require('./musicbrainz');
const antivirus = require('./antivirus');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = path.join(ROOT, 'musiques');
const TMP_DIR = path.join(ROOT, '.cache', 'dl');

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
function runYtDlp(args, onLine) {
  const tool = findYtDlp();
  if (!tool) return Promise.reject(new Error('yt-dlp introuvable. Installe-le : pip install yt-dlp'));

  return new Promise((resolve, reject) => {
    const child = spawn(tool.cmd, [...tool.prefixArgs, ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let buf = '';

    child.stdout.on('data', (d) => {
      stdout += d;
      if (!onLine) return;
      buf += d.toString();
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) onLine(l.trim());
    });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
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
  const args = [`ytsearch6:${query}`, '--flat-playlist', '--dump-json',
    '--no-warnings', '--ignore-config', '--socket-timeout', '20'];
  const { stdout } = await runYtDlp(args);

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
  const tracks = store.load(true).tracks;

  const cTitle = T.tightKey(candidate.title || '');
  const cOrig = T.tightKey(candidate.originalTitle || '');
  const cArtist = T.tightKey(candidate.artist || '');
  if (!cTitle) return null;

  for (const [fileName, e] of Object.entries(tracks)) {
    if (!fs.existsSync(path.join(MUSIC_DIR, fileName))) continue;

    const eTitle = T.tightKey(e.title || '');
    const eOrig = T.tightKey(e.originalTitle || '');
    const eArtist = T.tightKey(e.artist || '');

    // Titre d'origine identique : c'est le même morceau, quelle que soit la version.
    if (cOrig && (cOrig === eOrig || cOrig === eTitle)) return { fileName, entry: e };
    if (eOrig && eOrig === cTitle) return { fileName, entry: e };

    if (!eTitle) continue;

    // Même durée, et même titre à la mention des invités près :
    // « Get You The Moon » et « Get You The Moon ft. Snøw ».
    const memeDuree = candidate.duration && e.duration
      && Math.abs(candidate.duration - e.duration) <= Math.max(4, Math.min(candidate.duration, e.duration) * 0.05);
    if (memeDuree && memeTitreAuFeatPres(cTitle, eTitle)) {
      return { fileName, entry: e };
    }

    // Titre identique : on exige l'artiste pour éviter les homonymes
    // (« Hello » de Adele et « Hello » de OMFG sont deux morceaux).
    if (eTitle === cTitle) {
      if (!cArtist || !eArtist) return { fileName, entry: e };
      if (cArtist === eArtist) return { fileName, entry: e };
      // Artistes différents : l'un peut être inclus dans l'autre (feat., crédits)
      if (cArtist.includes(eArtist) || eArtist.includes(cArtist)) return { fileName, entry: e };
    }
  }
  return null;
}

const MARQUEUR_FEAT = /^(ft|feat|featuring|avec|with)/;

/** Deux titres identiques à la mention des invités près (« ... ft. X »). */
function memeTitreAuFeatPres(t1, t2) {
  if (!t1 || !t2 || t1 === t2) return false;
  const court = t1.length <= t2.length ? t1 : t2;
  const long = court === t1 ? t2 : t1;
  // Un titre court comme « Nightcore » rapprocherait n'importe quoi.
  if (court.length < 10 || !long.startsWith(court)) return false;
  return MARQUEUR_FEAT.test(long.slice(court.length));
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
  const { genre = null, title = null, artist = null, force = false } = opts;
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
  const infoArgs = [target, '--dump-json', '--no-playlist', '--no-warnings',
    '--ignore-config', '--socket-timeout', '20'];
  const { stdout: infoRaw } = await runYtDlp(infoArgs);
  const info = JSON.parse(infoRaw.split(/\r?\n/).find((l) => l.trim().startsWith('{')));

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
  const entry = buildEntry(info, { title, artist, genre });

  // Même traitement que le reste de la bibliothèque : quand le genre ne vient
  // ni de toi ni de la table des titres connus, MusicBrainz a le dernier mot.
  // Il est plus fiable que les tags YouTube, où « tiktok » classerait Kina en
  // meme alors que c'est de l'électro.
  const genreIncertain = ['tag', 'deviné', 'aucun'].includes(entry.genreSource);
  if (genreIncertain && entry.artist) {
    log('Recherche du genre...');
    try {
      const fiche = await musicbrainz.genreArtiste(entry.artist);
      if (fiche && fiche.genre) {
        entry.genre = fiche.genre;
        entry.genreSource = 'musicbrainz';
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

  // 3. Téléchargement + conversion MP3
  log('Téléchargement...');
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

  const tmpFile = path.join(TMP_DIR, `${videoId}.mp3`);
  if (!fs.existsSync(tmpFile)) {
    const leftover = fs.readdirSync(TMP_DIR).find((f) => f.startsWith(videoId));
    throw new Error(leftover
      ? `La conversion MP3 a échoué (fichier ${path.extname(leftover)} obtenu). ffmpeg est-il bien installé ?`
      : 'Fichier audio introuvable après téléchargement.');
  }

  // Le résultat de yt-dlp reste en quarantaine jusqu'à l'analyse. On analyse
  // le fichier réellement produit, pas seulement l'URL fournie au téléphone.
  log('Analyse antivirus Windows Defender...');
  try {
    await antivirus.scan(tmpFile);
  } catch (error) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    throw error;
  }

  // 4. Nom de fichier définitif
  const stem = entry.artist ? `${entry.artist} - ${entry.title}` : entry.title;
  const fileName = `${safeFileName(stem)} [${videoId}].mp3`;
  const finalPath = path.join(MUSIC_DIR, fileName);

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

  const rawTitle = info.track || info.title || '';
  let rawArtist = info.artist || info.creator || info.uploader || '';
  let workTitle = T.cleanTitle(rawTitle);

  // "Artiste - Titre" dans le titre de la vidéo quand yt-dlp n'a pas les champs musicaux
  if (!info.track) {
    const split = T.splitArtistTitle(workTitle);
    if (split.artist) {
      if (!info.artist) rawArtist = split.artist;
      workTitle = split.title;
    }
  }
  rawArtist = T.cleanTitle(String(rawArtist).replace(/\s*-\s*Topic$/i, ''));

  let title = workTitle;
  let originalTitle = '';
  let genre = null;
  let aliases = [];
  let needsReview = false;

  // Nom réellement connu (Polish Cow, Coffin Dance, ...)
  const ov = T.matchOverride(overrides, workTitle, info.title, info.track);
  if (ov) {
    originalTitle = ov.originalTitle || (T.norm(workTitle) !== T.norm(ov.title) ? workTitle : '');
    title = ov.title;
    if (ov.genre) genre = ov.genre;
    if (ov.artist) rawArtist = ov.artist;
    aliases = ov.aliases || [];
  } else if (T.detectScript(workTitle) !== 'latin') {
    const translated = T.cleanTitle(T.translit(workTitle));
    originalTitle = workTitle;
    needsReview = true;
    if (T.isReadableLatin(translated) && T.norm(translated)) title = translated;
  }

  // Un titre imposé par l'utilisateur gagne toujours.
  if (override.title) {
    if (T.norm(override.title) !== T.norm(title)) {
      originalTitle = originalTitle || (T.norm(workTitle) !== T.norm(override.title) ? workTitle : '');
    }
    title = override.title;
    needsReview = false;
  }

  // Un titre d'origine identique au titre affiché n'apprend rien : on l'efface.
  if (T.norm(originalTitle) === T.norm(title)) originalTitle = '';

  const artist = T.cleanTitle(override.artist || rawArtist);

  // Provenance du genre : elle décide si MusicBrainz a son mot à dire ensuite.
  // Les tags YouTube sont bruyants (« tiktok », « meme »…), donc peu fiables.
  let finalGenre = T.resolveGenre(override.genre);
  let genreSource = finalGenre ? 'utilisateur' : null;

  if (!finalGenre && genre) { finalGenre = genre; genreSource = 'table'; }
  if (!finalGenre) {
    const parTag = T.resolveGenre(info.genre);
    if (parTag) { finalGenre = parTag; genreSource = 'tag'; }
  }
  if (!finalGenre) {
    const devine = pickGenre(info, title, artist);
    if (devine) { finalGenre = devine; genreSource = 'deviné'; }
  }
  if (!finalGenre) { finalGenre = 'Autre'; genreSource = 'aucun'; }

  return {
    videoId: info.id,
    title: title.trim(),
    originalTitle: originalTitle.trim(),
    artist: artist.trim(),
    genre: finalGenre,
    genreSource,
    duration: Math.round(info.duration || 0),
    year: info.release_year || (info.upload_date ? Number(String(info.upload_date).slice(0, 4)) : null),
    source: info.webpage_url || null,
    aliases: T.buildAliases(title, originalTitle, aliases, artist && title ? `${artist} ${title}` : ''),
    needsReview,
    reviewed: !!override.title,
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
  searchBest,
  safeFileName,
  validatePublicMediaUrl,
  MUSIC_DIR,
};
