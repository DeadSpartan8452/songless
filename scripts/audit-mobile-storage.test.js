'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-mobile-storage-'));
const music = path.join(temp, 'Songless-Data', 'musiques');
const source = path.join(temp, 'morceau-test.mp3');

process.env.SONGLESS_MUSIC_DIR = music;
process.env.SONGLESS_METADATA_FILE = path.join(temp, 'Songless-Data', 'metadata.json');

const importer = require('../lib/importer');
const enricher = require('../lib/enricher');
const dupes = require('../lib/dupes');

try {
  assert.strictEqual(importer.MUSIC_DIR, music);
  assert.strictEqual(enricher.MUSIC_DIR, music);
  assert.strictEqual(dupes.MUSIC_DIR, music);
  assert.ok(dupes.CORBEILLE.startsWith(path.dirname(music) + path.sep));

  fs.writeFileSync(source, 'audio factice pour vérifier le chemin');
  const result = importer.installer([source], {deplacer: true});
  assert.deepStrictEqual(result.ecrits, ['morceau-test.mp3']);
  assert.strictEqual(fs.existsSync(path.join(music, 'morceau-test.mp3')), true);
  assert.strictEqual(fs.existsSync(source), false);
  console.log('OK  les imports Android restent dans le stockage persistant choisi');
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
