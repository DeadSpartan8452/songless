'use strict';

const assert = require('assert');
const comparisons = require('../lib/duplicate-comparison');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`OK  ${name}`);
}

const tracks = [
  {
    id: 'a', fileName: 'alpha-a.mp3', title: 'Même chanson', artist: 'Alpha',
    duration: 180, genre: 'Rock', year: 2001, size: 1000,
  },
  {
    id: 'b', fileName: 'alpha-b.mp3', title: 'Même chanson', artist: 'Alpha',
    duration: 181, genre: 'Rock', year: 2001, size: 999,
  },
  {
    id: 'c', fileName: 'beta.mp3', title: 'Même chanson', artist: 'Beta',
    duration: 180, genre: 'Pop', year: 2004, size: 800,
  },
  {
    id: 'd', fileName: 'alpha-live.mp3', title: 'Même chanson Live', artist: 'Alpha',
    duration: 180, genre: 'Rock', year: 2001, size: 1100,
  },
];

const found = comparisons.findComparisons(tracks);
assert.strictEqual(found.length, 1);
assert.deepStrictEqual(found[0].tracks.map(track => track.id), ['a', 'b']);
assert.strictEqual(found[0].confidence, 'high');
assert.match(found[0].reason, /titre.*artiste/i);
ok('une paire probable est expliquée sans rapprocher un autre artiste ou une version live');

const keyForward = comparisons.decisionKey(['alpha-a.mp3', 'alpha-b.mp3']);
const keyBackward = comparisons.decisionKey(['alpha-b.mp3', 'alpha-a.mp3']);
assert.strictEqual(keyForward, keyBackward);
assert.strictEqual(keyForward.length, 24);
assert.deepStrictEqual(comparisons.findComparisons(tracks, [keyForward]), []);
ok('une décision distincte reste stable quel que soit l’ordre des fichiers');

assert.strictEqual(comparisons.decisionKey(['seul.mp3']), '');
assert.strictEqual(comparisons.decisionKey(['a.mp3', 'a.mp3']), '');
ok('une décision exige exactement deux fichiers distincts');

const bounded = comparisons.findComparisons([
  ...tracks.slice(0, 2),
  { ...tracks[1], id: 'e', fileName: 'alpha-c.mp3' },
], [], 1);
assert.strictEqual(bounded.length, 1);
ok('le nombre de comparaisons retournées reste borné');

console.log(`\n${passed} tests de comparaison de doublons réussis.`);
