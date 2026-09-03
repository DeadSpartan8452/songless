#!/usr/bin/env node
'use strict';

/**
 * Prépare puis applique séparément les genres fiables lus dans les tags audio.
 * Aucun titre, artiste, fichier audio ou champ d'année n'est modifié.
 *
 * Usage :
 *   node tools/metadata-tags.js
 *   node tools/metadata-tags.js --apply .cache/metadata-tags-preview.json
 */

const fs = require('fs');
const path = require('path');
const musicMetadata = require('../lib/music-metadata');
const store = require('../lib/store');
const upgrade = require('../lib/tag-metadata-upgrade');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = process.env.SONGLESS_MUSIC_DIR
  ? path.resolve(process.env.SONGLESS_MUSIC_DIR)
  : path.join(ROOT, 'musiques');
const CACHE_DIR = process.env.SONGLESS_CACHE_DIR
  ? path.resolve(process.env.SONGLESS_CACHE_DIR)
  : path.join(ROOT, '.cache');
const PREVIEW_FILE = path.join(CACHE_DIR, 'metadata-tags-preview.json');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus']);

const args = process.argv.slice(2);
const applyIndex = args.indexOf('--apply');
const applyFile = applyIndex !== -1 && args[applyIndex + 1]
  ? path.resolve(args[applyIndex + 1]) : '';

function presentFiles() {
  if (!fs.existsSync(MUSIC_DIR)) return new Set();
  return new Set(fs.readdirSync(MUSIC_DIR)
    .filter(file => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase())));
}

function applyPreview(filePath) {
  const tracks = store.load(true).tracks;
  const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const changes = upgrade.validatePlan(plan, tracks, presentFiles());
  const count = Object.keys(changes).length;
  if (!count) throw new Error('Aucun genre fiable et applicable dans cet aperçu.');
  store.setMany(changes);
  console.log(`${count} genres appliqués depuis les tags audio.`);
}

async function buildPreview() {
  const tracks = store.load(true).tracks;
  const files = presentFiles();
  const changes = {};
  let inspected = 0;

  for (const [fileName, track] of Object.entries(tracks)) {
    if (!files.has(fileName)) continue;
    inspected++;
    try {
      const parsed = await musicMetadata.parseFile(path.join(MUSIC_DIR, fileName));
      const tagGenre = ((parsed.common.genre || [])[0] || '').trim();
      const proposal = upgrade.proposalFor(track, tagGenre);
      if (proposal) changes[fileName] = proposal;
    } catch (_) {
      // Un tag illisible ne rend pas le morceau illisible : aucune proposition.
    }
    if (inspected % 100 === 0) {
      process.stdout.write(`\r  Tags contrôlés : ${inspected}/${files.size}`);
    }
  }
  process.stdout.write(`\r  Tags contrôlés : ${inspected}/${files.size}\n`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(PREVIEW_FILE, JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    source: 'tag',
    confidence: 'medium',
    changes,
  }, null, 2), 'utf8');
  console.log(`${Object.keys(changes).length} genres proposés, aucune fiche modifiée.`);
  console.log(`Aperçu : ${PREVIEW_FILE}`);
  console.log(`Après contrôle : node tools/metadata-tags.js --apply "${PREVIEW_FILE}"`);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage : node tools/metadata-tags.js [--apply fichier-apercu.json]');
} else {
  Promise.resolve(applyFile ? applyPreview(applyFile) : buildPreview())
    .catch(error => {
      console.error(`Échec : ${error.message}`);
      process.exitCode = 1;
    });
}
