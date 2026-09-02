'use strict';

const assert = require('assert');
const dupes = require('../lib/dupes');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

function sig(title, artist = 'Artiste', duration = 180, fileName = '') {
  return dupes.signature({ title, artist, duration }, fileName || `${artist} - ${title}.mp3`);
}

test('deux fiches ordinaires identiques restent détectables', () => {
  assert.strictEqual(
    dupes.memeMorceau(sig('Même chanson'), sig('Même chanson', 'Artiste', 181)),
    true
  );
});

for (const variant of [
  'Parodie', 'Remix', 'Sped Up', 'Slowed + Reverb', 'Live',
  'Acoustic', 'Instrumental', 'Karaoke', 'Remastered', 'Cover', 'Nightcore',
]) {
  test(`la version « ${variant} » reste un morceau distinct`, () => {
    const original = sig('Même chanson');
    const alternate = sig(`Même chanson (${variant})`, 'Artiste', 180);
    assert.strictEqual(dupes.memeMorceau(original, alternate), false);
  });
}

test('deux artistes différents avec le même titre ne sont pas fusionnés', () => {
  assert.strictEqual(
    dupes.memeMorceau(sig('Hello', 'Artiste A'), sig('Hello', 'Artiste B')),
    false
  );
});

test('un nom de fichier suffit à protéger une variante mal étiquetée', () => {
  const original = sig('Même chanson', 'Artiste', 180, 'meme-chanson.mp3');
  const remix = sig('Même chanson', 'Artiste', 180, 'meme-chanson-remix.mp3');
  assert.strictEqual(dupes.memeMorceau(original, remix), false);
});

console.log(`\n${passed} tests de doublons réussis.`);
