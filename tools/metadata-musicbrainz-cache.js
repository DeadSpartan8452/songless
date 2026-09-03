#!/usr/bin/env node
'use strict';

/**
 * Prépare ou applique les genres déjà obtenus auprès de MusicBrainz.
 * Aucun appel réseau n'est effectué et les divergences sont laissées de côté.
 */

const fs = require('fs');
const path = require('path');
const titles = require('../lib/titles');
const store = require('../lib/store');
const upgrade = require('../lib/tag-metadata-upgrade');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = process.env.SONGLESS_MUSIC_DIR
  ? path.resolve(process.env.SONGLESS_MUSIC_DIR) : path.join(ROOT, 'musiques');
const CACHE_DIR = process.env.SONGLESS_CACHE_DIR
  ? path.resolve(process.env.SONGLESS_CACHE_DIR) : path.join(ROOT, '.cache');
const ARTIST_CACHE = path.join(CACHE_DIR, 'musicbrainz-artists.json');
const PREVIEW_FILE = path.join(CACHE_DIR, 'metadata-musicbrainz-preview.json');
const args = process.argv.slice(2);
const applyIndex = args.indexOf('--apply');
const applyFile = applyIndex !== -1 && args[applyIndex + 1]
  ? path.resolve(args[applyIndex + 1]) : '';

function filesOnDisk() {
  return new Set(fs.existsSync(MUSIC_DIR) ? fs.readdirSync(MUSIC_DIR) : []);
}

function applyPreview(filePath) {
  const tracks = store.load(true).tracks;
  const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const changes = upgrade.validatePlan(plan, tracks, filesOnDisk(), 'musicbrainz');
  const count = Object.keys(changes).length;
  if (!count) throw new Error('Aucun genre MusicBrainz fiable et applicable.');
  store.setMany(changes);
  console.log(`${count} genres appliqués depuis le cache MusicBrainz.`);
}

function buildPreview() {
  const tracks = store.load(true).tracks;
  const cache = JSON.parse(fs.readFileSync(ARTIST_CACHE, 'utf8'));
  const present = filesOnDisk();
  const changes = {};
  let conflicts = 0;

  for (const [fileName, track] of Object.entries(tracks)) {
    if (!present.has(fileName)) continue;
    const artist = cache[titles.norm(track.artist || '')];
    if (!artist || !artist.genre) continue;
    const proposal = upgrade.proposalFor(track, artist.genre, 'musicbrainz');
    if (proposal) {
      changes[fileName] = proposal;
    } else {
      const current = upgrade.canonicalGenre(track.genre);
      const candidate = upgrade.canonicalGenre(artist.genre);
      if (current && candidate && current !== candidate) conflicts++;
    }
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(PREVIEW_FILE, JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    source: 'musicbrainz',
    confidence: 'medium',
    changes,
  }, null, 2), 'utf8');
  console.log(`${Object.keys(changes).length} genres proposés, aucune fiche modifiée.`);
  console.log(`${conflicts} divergences laissées à la validation manuelle.`);
  console.log(`Aperçu : ${PREVIEW_FILE}`);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage : node tools/metadata-musicbrainz-cache.js [--apply aperçu.json]');
} else {
  try {
    if (applyFile) applyPreview(applyFile);
    else buildPreview();
  } catch (error) {
    console.error(`Échec : ${error.message}`);
    process.exitCode = 1;
  }
}
