'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const antivirus = require('../lib/antivirus');
const database = require('../lib/clamav-database');

const sample = path.resolve('quarantaine', 'test.mp3');

assert.deepStrictEqual(
  antivirus.scanArguments({ id: 'defender' }, sample),
  ['-Scan', '-ScanType', '3', '-File', sample, '-DisableRemediation'],
);
assert.deepStrictEqual(
  antivirus.scanArguments({ id: 'clamav' }, sample),
  ['--no-summary', '--', sample],
);
assert.throws(
  () => antivirus.scanArguments({ id: 'inconnu' }, sample),
  /non pris en charge/,
);

const current = antivirus.status();
assert.strictEqual(typeof current.available, 'boolean');
assert.strictEqual(current.available, Boolean(current.name));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-clamav-test-'));
const db = path.join(temp, 'db');
const certs = path.join(temp, 'certs');
fs.mkdirSync(db);
fs.mkdirSync(certs);
const cvd = version => Buffer.from(`ClamAV-VDB:03 Sep 2026 00-00 +0000:${version}:1:1:1:x:y:z`);
fs.writeFileSync(path.join(db, 'main.cvd'), cvd(63));
fs.writeFileSync(path.join(db, 'daily.cvd'), cvd(28000));
fs.writeFileSync(path.join(certs, 'clamav.crt'), 'test certificate');

process.env.SONGLESS_CLAMAV_DB = db;
process.env.SONGLESS_CLAMAV_CERTS = certs;
process.env.SONGLESS_ANDROID_ABI = 'x86_64';
assert.strictEqual(database.status().ready, true);
assert.strictEqual(database.status().files.main.version, 63);
assert.match(database.userAgent(), /ClamAV\/1\.5\.4.*ARCH: x86_64/);
assert.deepStrictEqual(
  antivirus.scanArguments({id: 'clamav'}, sample),
  [`--cvdcertsdir=${certs}`, `--database=${db}`, '--no-summary', '--', sample],
);
delete process.env.SONGLESS_CLAMAV_DB;
delete process.env.SONGLESS_CLAMAV_CERTS;
delete process.env.SONGLESS_ANDROID_ABI;
fs.rmSync(temp, {recursive: true, force: true});

console.log('OK  moteurs, bases signées et arguments Android restent contrôlés');
