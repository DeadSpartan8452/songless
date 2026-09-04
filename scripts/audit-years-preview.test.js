'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validerPlan } = require('../tools/years');

const tracks = {
  'alpha.mp3': { title: 'Alpha' },
  'beta.mp3': { title: 'Beta', year: 2001 },
};
const presents = new Set(['alpha.mp3', 'beta.mp3']);

const result = validerPlan({
  changes: {
    'alpha.mp3': { year: 1987, title: 'Ne doit jamais passer' },
    'beta.mp3': { year: 1999 },
    'absent.mp3': { year: 1999 },
  },
}, tracks, presents);

assert.deepStrictEqual(result, {
  'alpha.mp3': {
    year: 1987,
    yearSource: 'musicbrainz',
    yearConfidence: 'medium',
  },
});
assert.strictEqual(Object.hasOwn(result['alpha.mp3'], 'title'), false);
assert.throws(() => validerPlan({}, tracks, presents), /changes absent/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-years-'));
try {
  const musicDir = path.join(temp, 'musiques');
  const metadataFile = path.join(temp, 'metadata.json');
  const planFile = path.join(temp, 'preview.json');
  fs.mkdirSync(musicDir);
  fs.writeFileSync(path.join(musicDir, 'alpha.mp3'), 'audit');
  fs.writeFileSync(metadataFile, JSON.stringify({
    version: 1,
    tracks: { 'alpha.mp3': { title: 'Alpha', artist: 'Artiste' } },
  }));
  fs.writeFileSync(planFile, JSON.stringify({
    changes: { 'alpha.mp3': { year: 1987, title: 'Titre interdit' } },
  }));
  const run = spawnSync(process.execPath, ['tools/years.js', '--apply', planFile], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      SONGLESS_MUSIC_DIR: musicDir,
      SONGLESS_METADATA_FILE: metadataFile,
      SONGLESS_METADATA_BACKUP_DIR: path.join(temp, 'backups'),
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.strictEqual(run.status, 0, run.stderr);
  const saved = JSON.parse(fs.readFileSync(metadataFile, 'utf8')).tracks['alpha.mp3'];
  assert.strictEqual(saved.title, 'Alpha');
  assert.strictEqual(saved.year, 1987);
  assert.strictEqual(saved.yearSource, 'musicbrainz');
  assert.strictEqual(saved.yearConfidence, 'medium');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('OK  l’aperçu des années est borné et ne peut jamais renommer un morceau');
