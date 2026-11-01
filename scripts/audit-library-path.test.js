'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'tools', 'Resolve-LibraryPath.ps1');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-library-path-'));

function run(dataRoot, legacyRoot) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const command = [
    `$result = & ${quote(helper)} -DataRoot ${quote(dataRoot)} -LegacyRoot ${quote(legacyRoot)}`,
    '[Console]::Out.Write($result.LibraryRoot)',
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return path.resolve(result.stdout.trim());
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function assertSamePath(actual, expected) {
  const canonical = value => fs.realpathSync.native(path.resolve(value)).toLowerCase();
  assert.strictEqual(canonical(actual), canonical(expected));
}

try {
  const currentData = path.join(process.env.LOCALAPPDATA, 'Songless-Data');
  const currentLegacy = path.join(process.env.USERPROFILE, 'Codex', 'Songless');
  assertSamePath(run(currentData, currentLegacy), currentData);

  const migrationData = path.join(sandbox, 'migration-data');
  const migrationLegacy = path.join(sandbox, 'migration-legacy');
  const legacyMetadata = path.join(migrationLegacy, 'metadata.json');
  write(legacyMetadata, '{"tracks":{"synthetic":{"title":"Fictional"}}}');
  fs.mkdirSync(path.join(migrationLegacy, 'musiques'), { recursive: true });
  assertSamePath(run(migrationData, migrationLegacy), migrationData);
  const migrated = fs.readFileSync(path.join(migrationData, 'metadata.json'));
  assert.deepStrictEqual(migrated, fs.readFileSync(legacyMetadata));
  const backups = fs.readdirSync(path.join(migrationData, 'metadata-backups'));
  assert.strictEqual(backups.length, 1);
  assert.deepStrictEqual(
    fs.readFileSync(path.join(migrationData, 'metadata-backups', backups[0])),
    fs.readFileSync(legacyMetadata),
  );

  const legacyData = path.join(sandbox, 'legacy-data');
  const legacyAudio = path.join(sandbox, 'legacy-audio');
  write(path.join(legacyAudio, 'metadata.json'), '{}');
  write(path.join(legacyAudio, 'musiques', 'synthetic.mp3'), 'synthetic audio');
  assertSamePath(run(legacyData, legacyAudio), legacyAudio);

  const preferredData = path.join(sandbox, 'preferred-data');
  write(path.join(preferredData, 'metadata.json'), '{}');
  assertSamePath(run(preferredData, legacyAudio), preferredData);

  console.log('OK  Songless privilégie le stockage local canonique');
  console.log('OK  les anciennes métadonnées sans audio sont sauvegardées puis migrées');
  console.log('OK  une ancienne bibliothèque avec audio reste accessible');
  console.log('OK  une bibliothèque déjà migrée n’est pas remplacée');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
