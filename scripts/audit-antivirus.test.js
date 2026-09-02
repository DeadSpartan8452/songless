'use strict';

const assert = require('assert');
const path = require('path');
const antivirus = require('../lib/antivirus');

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

console.log('OK  Defender et ClamAV utilisent des arguments sûrs sans shell');
