#!/usr/bin/env node
'use strict';

/**
 * Remet en revue les artistes issus de l'ancien repli MusicBrainz « titre seul ».
 *
 * Par défaut, produit uniquement un aperçu. L'application est séparée, vérifie
 * que chaque fiche est restée identique et laisse store.js créer une sauvegarde.
 */

const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const titles = require('../lib/titles');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = process.env.SONGLESS_CACHE_DIR
  ? path.resolve(process.env.SONGLESS_CACHE_DIR) : path.join(ROOT, '.cache');
const AUTO_PREVIEW = path.join(CACHE_DIR, 'metadata-auto-preview.json');
const RECORDING_CACHE = path.join(CACHE_DIR, 'musicbrainz-recordings-v3.json');
const REVIEW_PREVIEW = path.join(CACHE_DIR, 'metadata-title-only-review-preview.json');
const args = process.argv.slice(2);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clean(value) {
  return String(value || '').replace(/["\\]/g, ' ').trim();
}

function recordingKey(title, artist = '') {
  const raw = `${clean(title)}\u0000${clean(artist)}`;
  return titles.norm(raw) || raw.normalize('NFKC').toLocaleLowerCase();
}

function expectedState(track) {
  return {
    artist: String(track.artist || ''),
    artistSource: String(track.artistSource || ''),
    artistConfidence: String(track.artistConfidence || ''),
    musicbrainzRecordingId: String(track.musicbrainzRecordingId || ''),
    metadataCheckedAt: String(track.metadataCheckedAt || ''),
  };
}

function sameState(track, expected) {
  return Object.entries(expected).every(([key, value]) => String(track[key] || '') === value);
}

function buildPreview() {
  const automatic = readJson(AUTO_PREVIEW);
  const recordings = readJson(RECORDING_CACHE);
  const tracks = store.load(true).tracks;
  const changes = {};

  for (const [fileName, item] of Object.entries(automatic.changes || {})) {
    const before = item && item.expected;
    const patch = item && item.patch;
    const current = tracks[fileName];
    if (!before || !patch || !current || !before.artist || !patch.artist) continue;
    if (titles.norm(before.artist) === titles.norm(patch.artist)) continue;

    const exactKey = recordingKey(before.title, before.artist);
    const titleOnlyKey = recordingKey(before.title, '');
    if (!Object.prototype.hasOwnProperty.call(recordings, exactKey)) continue;
    if (recordings[exactKey] !== null) continue;
    const titleOnly = recordings[titleOnlyKey];
    if (!titleOnly || String(titleOnly.id || '') !== String(patch.musicbrainzRecordingId || '')) {
      continue;
    }
    if (String(current.artist || '') !== String(patch.artist)
      || current.artistSource !== 'musicbrainz'
      || current.artistConfidence !== 'medium'
      || String(current.musicbrainzRecordingId || '') !== String(patch.musicbrainzRecordingId || '')) {
      continue;
    }

    changes[fileName] = {
      expected: expectedState(current),
      patch: {
        artistConfidence: 'low',
        artistReviewReason: 'musicbrainz-title-only',
      },
      evidence: {
        searchedArtist: before.artist,
        proposedArtist: patch.artist,
        title: before.title,
      },
    };
  }

  const preview = {
    version: 1,
    source: 'musicbrainz-title-only-remediation',
    createdAt: new Date().toISOString(),
    complete: true,
    total: Object.keys(changes).length,
    changes,
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(REVIEW_PREVIEW, JSON.stringify(preview, null, 2), 'utf8');
  console.log(`${preview.total} artiste(s) remis en revue dans l'aperçu.`);
  console.log(`Aucune fiche modifiée. Aperçu : ${REVIEW_PREVIEW}`);
  console.log(`Après contrôle : node tools/review-title-only-artists.js --apply "${REVIEW_PREVIEW}"`);
  return preview;
}

function applyPreview(filePath) {
  const preview = readJson(filePath);
  if (preview.version !== 1 || preview.source !== 'musicbrainz-title-only-remediation'
    || preview.complete !== true || !preview.changes
    || preview.total !== Object.keys(preview.changes).length) {
    throw new Error('Aperçu de remise en revue invalide.');
  }
  const tracks = store.load(true).tracks;
  const changes = {};
  let stale = 0;
  for (const [fileName, item] of Object.entries(preview.changes)) {
    const track = tracks[fileName];
    if (!track || !sameState(track, item.expected)) {
      stale++;
      continue;
    }
    changes[fileName] = {
      artistConfidence: 'low',
      artistReviewReason: 'musicbrainz-title-only',
    };
  }
  if (!Object.keys(changes).length) throw new Error('Aucune proposition encore applicable.');
  store.setMany(changes);
  console.log(`${Object.keys(changes).length} artiste(s) remis en revue.`);
  if (stale) console.log(`${stale} fiche(s) modifiée(s) depuis l'aperçu ont été ignorées.`);
}

if (require.main === module) {
  try {
    const applyIndex = args.indexOf('--apply');
    if (args.includes('--help') || args.includes('-h')) {
      console.log('Usage : node tools/review-title-only-artists.js');
      console.log('        node tools/review-title-only-artists.js --apply aperçu.json');
    } else if (applyIndex >= 0) {
      applyPreview(path.resolve(args[applyIndex + 1] || REVIEW_PREVIEW));
    } else {
      buildPreview();
    }
  } catch (error) {
    console.error(`Échec : ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildPreview, applyPreview, recordingKey, sameState };
