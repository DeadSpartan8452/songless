'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const titles = require('../lib/titles');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-title-only-'));
const cacheDir = path.join(root, 'cache');
const metadataFile = path.join(root, 'metadata.json');
const backupDir = path.join(root, 'backups');
fs.mkdirSync(cacheDir);

const fileName = 'morceau-test.mp3';
const title = 'Titre partagé';
const previousArtist = 'Artiste attendu';
const proposedArtist = 'Homonyme sans rapport';
const recordingId = 'recording-title-only';
const norm = (value) => titles.norm(`${value.title}\u0000${value.artist}`);

fs.writeFileSync(metadataFile, JSON.stringify({
  version: 1,
  tracks: {
    [fileName]: {
      title,
      artist: proposedArtist,
      artistSource: 'musicbrainz',
      artistConfidence: 'medium',
      musicbrainzRecordingId: recordingId,
      metadataCheckedAt: '2026-09-04T00:00:00.000Z',
    },
  },
}));
fs.writeFileSync(path.join(cacheDir, 'metadata-auto-preview.json'), JSON.stringify({
  changes: {
    [fileName]: {
      expected: { title, artist: previousArtist },
      patch: { artist: proposedArtist, musicbrainzRecordingId: recordingId },
    },
  },
}));
fs.writeFileSync(path.join(cacheDir, 'musicbrainz-recordings-v3.json'), JSON.stringify({
  [norm({ title, artist: previousArtist })]: null,
  [norm({ title, artist: '' })]: { id: recordingId, artist: proposedArtist },
}));

const env = {
  ...process.env,
  SONGLESS_CACHE_DIR: cacheDir,
  SONGLESS_METADATA_FILE: metadataFile,
  SONGLESS_METADATA_BACKUP_DIR: backupDir,
};
const tool = path.join(__dirname, '..', 'tools', 'review-title-only-artists.js');
const previewRun = spawnSync(process.execPath, [tool], { encoding: 'utf8', env });
assert.strictEqual(previewRun.status, 0, previewRun.stderr);
assert.match(previewRun.stdout, /1 artiste\(s\) remis en revue dans l'aperçu/);
let saved = JSON.parse(fs.readFileSync(metadataFile, 'utf8')).tracks[fileName];
assert.strictEqual(saved.artistConfidence, 'medium');

const previewFile = path.join(cacheDir, 'metadata-title-only-review-preview.json');
const preview = JSON.parse(fs.readFileSync(previewFile, 'utf8'));
assert.strictEqual(preview.total, 1);
assert.strictEqual(preview.changes[fileName].evidence.searchedArtist, previousArtist);

const applyRun = spawnSync(process.execPath, [tool, '--apply', previewFile], {
  encoding: 'utf8', env,
});
assert.strictEqual(applyRun.status, 0, applyRun.stderr);
saved = JSON.parse(fs.readFileSync(metadataFile, 'utf8')).tracks[fileName];
assert.strictEqual(saved.artist, proposedArtist);
assert.strictEqual(saved.artistConfidence, 'low');
assert.strictEqual(saved.artistReviewReason, 'musicbrainz-title-only');
assert.ok(fs.readdirSync(backupDir).length >= 1);

const staleRun = spawnSync(process.execPath, [tool, '--apply', previewFile], {
  encoding: 'utf8', env,
});
assert.notStrictEqual(staleRun.status, 0);
assert.match(staleRun.stderr, /Aucune proposition encore applicable/);

fs.rmSync(root, { recursive: true, force: true });
console.log('OK  les artistes issus du titre seul repassent par une revue sûre');
