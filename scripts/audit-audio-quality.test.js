'use strict';

const assert = require('assert');
const audioQuality = require('../lib/audio-quality');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`OK  ${name}`);
}

const unknown = audioQuality.inspect({ duration: 180 });
assert.strictEqual(unknown.known, false);
assert.deepStrictEqual(unknown.issues, []);
ok('une durée seule ne prétend pas mesurer la qualité d’encodage');

assert.strictEqual(audioQuality.inspect({ codec: 'MP3', container: 'MPEG' }).known, false);
ok('le nom d’un codec sans mesure ne suffit pas à noter sa qualité');

const standard = audioQuality.inspect({
  codec: 'MPEG 1 Layer 3', container: 'MPEG', bitrate: 192000,
  sampleRate: 44100, numberOfChannels: 2, lossless: false,
});
assert.strictEqual(standard.known, true);
assert.strictEqual(standard.bitrate, 192000);
assert.strictEqual(standard.sampleRate, 44100);
assert.deepStrictEqual(standard.issues, []);
ok('un MP3 standard est mesuré sans être signalé');

const crushed = audioQuality.inspect({
  codec: 'MP3', bitrate: 64000, sampleRate: 22050, numberOfChannels: 1,
});
assert.deepStrictEqual(crushed.issues.map(issue => issue.type), [
  'encodage-faible', 'echantillonnage-faible',
]);
assert.ok(crushed.issues.every(issue => issue.gravite === 'genant'));
ok('un encodage réellement faible produit des raisons techniques lisibles');

const medium = audioQuality.inspect({ codec: 'AAC', bitrate: 112000, sampleRate: 44100 });
assert.strictEqual(medium.issues[0].type, 'encodage-moyen');
assert.strictEqual(medium.issues[0].gravite, 'cosmetique');
ok('la zone intermédiaire reste un conseil et non un défaut bloquant');

const flac = audioQuality.inspect({
  codec: 'FLAC', lossless: true, bitrate: 70000,
  sampleRate: 48000, bitsPerSample: 24, numberOfChannels: 2,
});
assert.deepStrictEqual(flac.issues, []);
assert.strictEqual(flac.lossless, true);
ok('un codec sans perte n’est jamais jugé avec un seuil de débit lossy');

console.log(`\n${passed} tests de qualité d’encodage réussis.`);
