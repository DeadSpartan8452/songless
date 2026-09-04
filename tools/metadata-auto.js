#!/usr/bin/env node
'use strict';

/**
 * Recherche automatique des métadonnées de toute la bibliothèque.
 *
 * La première exécution produit seulement un aperçu dans .cache. Elle est
 * relançable : MusicBrainz est mis en cache après chaque morceau. L'application
 * est une seconde action explicite et refuse un aperçu devenu périmé.
 */

const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const musicbrainz = require('../lib/musicbrainz');
const automaticMetadata = require('../lib/automatic-metadata');
const downloader = require('../lib/downloader');
const titles = require('../lib/titles');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = process.env.SONGLESS_MUSIC_DIR
  ? path.resolve(process.env.SONGLESS_MUSIC_DIR) : path.join(ROOT, 'musiques');
const CACHE_DIR = process.env.SONGLESS_CACHE_DIR
  ? path.resolve(process.env.SONGLESS_CACHE_DIR) : path.join(ROOT, '.cache');
const PREVIEW_FILE = path.join(CACHE_DIR, 'metadata-auto-preview.json');
const YOUTUBE_CACHE_FILE = path.join(CACHE_DIR, 'youtube-unofficial-metadata.json');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus']);
const args = process.argv.slice(2);

function fichiersPresents() {
  if (!fs.existsSync(MUSIC_DIR)) return new Set();
  return new Set(fs.readdirSync(MUSIC_DIR)
    .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase())));
}

function attendu(track) {
  return {
    title: String(track.title || ''),
    artist: String(track.artist || ''),
    artistSource: String(track.artistSource || ''),
    artistConfidence: String(track.artistConfidence || ''),
    genre: String(track.genre || ''),
    genreSource: String(track.genreSource || ''),
    genreConfidence: String(track.genreConfidence || ''),
    year: String(track.year || ''),
    yearSource: String(track.yearSource || ''),
    yearConfidence: String(track.yearConfidence || ''),
    album: String(track.album || ''),
    albumSource: String(track.albumSource || ''),
    unofficialVariant: String(Boolean(track.unofficialVariant)),
  };
}

function memeEtat(track, expected) {
  return Object.entries(expected || {}).every(([key, value]) => {
    if (key === 'unofficialVariant') {
      return String(track.unofficialVariant === true) === value;
    }
    return String(track[key] ?? '') === value;
  });
}

function sauverApercu(plan) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(PREVIEW_FILE, JSON.stringify(plan, null, 2), 'utf8');
}

function chargerYoutubeCache() {
  try { return JSON.parse(fs.readFileSync(YOUTUBE_CACHE_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function sauverYoutubeCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(YOUTUBE_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

async function chercherVarianteYoutube(track, cache) {
  const cle = titles.norm(`${track.title || ''}\u0000${track.artist || ''}`);
  if (Object.prototype.hasOwnProperty.call(cache, cle)) return cache[cle];
  const query = [track.artist, track.title].filter(Boolean).join(' ').trim();
  if (!query) return null;
  try {
    const info = await downloader.searchMetadata(query);
    if (!info) {
      const noMatch = {
        source: 'youtube-unofficial',
        videoId: null,
        genre: null,
        genreSource: 'unknown',
        genreConfidence: 'unknown',
        noMatch: true,
      };
      cache[cle] = noMatch;
      sauverYoutubeCache(cache);
      return noMatch;
    }
    const entry = downloader.buildEntry(info);
    const result = {
      source: 'youtube-unofficial',
      videoId: entry.videoId || null,
      genre: entry.genre && entry.genre !== 'Autre' ? entry.genre : null,
      genreSource: entry.genreSource,
      genreConfidence: entry.genreConfidence,
    };
    cache[cle] = result;
    sauverYoutubeCache(cache);
    return result;
  } catch (error) {
    console.warn(`YouTube temporairement indisponible : ${error.message}`);
    return null;
  }
}

async function construire() {
  const tracks = store.load(true).tracks;
  const presents = fichiersPresents();
  const limiteIndex = args.indexOf('--limit');
  const limite = limiteIndex >= 0 ? Math.max(1, Number(args[limiteIndex + 1]) || 1) : Infinity;
  const entrees = Object.entries(tracks)
    .filter(([fileName]) => presents.has(fileName))
    .slice(0, limite);
  const plan = {
    version: 2,
    createdAt: new Date().toISOString(),
    source: 'internet',
    total: entrees.length,
    inspected: 0,
    matched: 0,
    pending: 0,
    complete: false,
    changes: {},
  };
  const youtubeCache = chargerYoutubeCache();

  console.log(`${entrees.length} morceau(x) à vérifier sur MusicBrainz ou YouTube.`);
  for (let index = 0; index < entrees.length; index++) {
    const [fileName, track] = entrees[index];
    let unofficial = automaticMetadata.estVersionNonOfficielle(track, fileName);
    const artiste = automaticMetadata.artisteManquant(track.artist) ? '' : track.artist;
    const titreRecherche = String(track.metadataLookupTitle || track.title || '').trim();
    let result = unofficial
      ? await chercherVarianteYoutube(track, youtubeCache)
      : await musicbrainz.enregistrement(titreRecherche, artiste, { silencieux: false });
    const rechercheMusicBrainzTerminee = !unofficial
      && musicbrainz.enregistrementDansCache(titreRecherche, artiste);
    if (!unofficial && !result && rechercheMusicBrainzTerminee) {
      result = await chercherVarianteYoutube(track, youtubeCache);
      unofficial = true;
    }
    const attenteInternet = (!unofficial && !result && !rechercheMusicBrainzTerminee)
      || (unofficial && !result);
    if (attenteInternet) {
      plan.inspected++;
      plan.pending++;
      if ((index + 1) % 10 === 0 || index + 1 === entrees.length) {
        sauverApercu(plan);
        process.stdout.write(`\r  Vérifiés : ${index + 1}/${entrees.length}`
          + ` — correspondances : ${plan.matched} — à retenter : ${plan.pending}`);
      }
      continue;
    }
    const proposalResult = result || (unofficial ? { source: 'youtube-unofficial' } : null);
    const patch = automaticMetadata.proposition(track, proposalResult);

    if (!unofficial && result && !patch.genre && automaticMetadata.peutRemplacerGenre(track)) {
      const artistInfo = await musicbrainz.genreArtiste(result.artist || track.artist, {
        silencieux: false,
      });
      if (artistInfo && artistInfo.genre) {
        patch.genre = artistInfo.genre;
        patch.genreSource = 'musicbrainz';
        patch.genreConfidence = 'medium';
      }
    }

    plan.inspected++;
    if (result && !result.noMatch) plan.matched++;
    plan.changes[fileName] = { expected: attendu(track), patch };
    if ((index + 1) % 10 === 0 || index + 1 === entrees.length) {
      sauverApercu(plan);
      process.stdout.write(`\r  Vérifiés : ${index + 1}/${entrees.length}`
        + ` — correspondances : ${plan.matched} — à retenter : ${plan.pending}`);
    }
  }
  plan.complete = true;
  sauverApercu(plan);
  process.stdout.write('\n');
  console.log('Aucune fiche musicale n’a été modifiée.');
  if (plan.pending) {
    console.log(`${plan.pending} recherche(s) temporairement indisponible(s) seront retentées.`);
  }
  console.log(`Aperçu relançable : ${PREVIEW_FILE}`);
  console.log(`Après contrôle : node tools/metadata-auto.js --apply "${PREVIEW_FILE}"`);
}

function appliquer(filePath) {
  const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (plan.version !== 2 || !['musicbrainz', 'internet'].includes(plan.source)
    || !plan.changes || plan.complete !== true || plan.inspected !== plan.total) {
    throw new Error('Aperçu de métadonnées Internet invalide.');
  }
  if (plan.pending) {
    throw new Error(`${plan.pending} recherche(s) Internet doivent encore être retentées.`);
  }
  const tracks = store.load(true).tracks;
  const presents = fichiersPresents();
  const changes = {};
  let perimes = 0;
  for (const [fileName, item] of Object.entries(plan.changes)) {
    const track = tracks[fileName];
    if (!track || !presents.has(fileName) || !memeEtat(track, item.expected)) {
      perimes++;
      continue;
    }
    const safe = automaticMetadata.proposition(track, {
      source: item.patch.unofficialVariant ? 'youtube-unofficial' : 'musicbrainz',
      id: item.patch.musicbrainzRecordingId,
      videoId: item.patch.videoId,
      title: item.patch.title,
      artist: item.patch.artist,
      year: item.patch.year,
      album: item.patch.album,
      genre: item.patch.genre,
      genreSource: item.patch.genreSource,
      genreConfidence: item.patch.genreConfidence,
    }, item.patch.metadataCheckedAt);
    safe.metadataMatch = item.patch.metadataMatch || safe.metadataMatch;
    changes[fileName] = safe;
  }
  if (!Object.keys(changes).length) throw new Error('Aucune proposition encore applicable.');
  store.setMany(changes);
  console.log(`${Object.keys(changes).length} fiche(s) vérifiée(s) et enregistrée(s).`);
  if (perimes) console.log(`${perimes} fiche(s) modifiée(s) depuis l’aperçu ont été ignorées.`);
}

if (require.main === module) {
  const applyIndex = args.indexOf('--apply');
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage : node tools/metadata-auto.js [--limit 50]');
    console.log('        node tools/metadata-auto.js --apply aperçu.json');
  } else {
    Promise.resolve(applyIndex >= 0
      ? appliquer(path.resolve(args[applyIndex + 1] || PREVIEW_FILE))
      : construire())
      .catch((error) => {
        console.error(`Échec : ${error.message}`);
        process.exitCode = 1;
      });
  }
}

module.exports = { attendu, memeEtat };
