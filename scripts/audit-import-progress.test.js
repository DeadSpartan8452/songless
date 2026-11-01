'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { writeSyntheticWav } = require('./test-audio-fixture');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-import-progress-'));
process.env.SONGLESS_MUSIC_DIR = path.join(root, 'musiques');
process.env.SONGLESS_METADATA_FILE = path.join(root, 'metadata.json');
process.env.SONGLESS_METADATA_BACKUP_DIR = path.join(root, 'metadata-backups');
process.env.SONGLESS_CACHE_DIR = path.join(root, 'cache');
fs.mkdirSync(path.dirname(process.env.SONGLESS_METADATA_FILE), { recursive: true });
fs.writeFileSync(process.env.SONGLESS_METADATA_FILE, JSON.stringify({ tracks: {} }));

const progress = require('../lib/import-progress');
const importer = require('../lib/importer');
const id = '12345678-1234-4abc-8abc-1234567890ab';

async function main() {
  assert.strictEqual(progress.validId(id), true);
  assert.strictEqual(progress.validId('not-an-id'), false);
  assert.strictEqual(importer.safeArchiveEntry('collection/track.wav'), true);
  assert.strictEqual(importer.safeArchiveEntry('../outside.wav'), false);
  assert.strictEqual(importer.safeArchiveEntry('C:/outside.wav'), false);

  progress.update(id, { phase: 'sort', current: 9, total: 4, label: 'Classement des morceaux' });
  assert.deepStrictEqual(progress.get(id), {
    phase: 'sort', current: 4, total: 4, label: 'Classement des morceaux', percent: 100,
  });

  const fixtureRoot = path.join(root, 'fixtures');
  const firstName = writeSyntheticWav(fixtureRoot, 'fixture-a.wav');
  const secondName = writeSyntheticWav(fixtureRoot, 'fixture-b.wav');
  const archivePath = path.join(root, 'synthetic.zip');
  const zip = new AdmZip();
  zip.addFile(firstName, fs.readFileSync(path.join(fixtureRoot, firstName)));
  zip.addFile(secondName, fs.readFileSync(path.join(fixtureRoot, secondName)));
  zip.writeZip(archivePath);

  const events = [];
  const report = await importer.importerArchive(archivePath, {
    reseau: false,
    onProgress: event => events.push({ ...event }),
  });
  assert.strictEqual(report.ajoutes.length, 2);
  assert.ok(events.some(event => event.phase === 'extract' && event.current === 2));
  assert.ok(events.some(event => event.phase === 'sort' && event.current === 1));
  assert.strictEqual(importer.listerAudio(process.env.SONGLESS_MUSIC_DIR).length, 2);

  console.log('OK  progression import : extraction et tri comptent les morceaux');
  console.log('OK  progression bornée et chemins dangereux du ZIP refusés');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
