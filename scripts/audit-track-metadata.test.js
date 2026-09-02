'use strict';

const assert = require('assert');
const metadata = require('../lib/track-metadata');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

test('les anciens favoris convergent vers un booléen unique', () => {
  assert.strictEqual(metadata.readClassification({ favori: true }).favorite, true);
  assert.strictEqual(metadata.readClassification({ coupDeCoeur: 1 }).favorite, true);
  assert.strictEqual(metadata.readClassification({ favorite: false, favori: true }).favorite, false);
});

test('une chaîne false ne devient pas favorite par accident', () => {
  assert.strictEqual(metadata.readClassification({ favorite: 'false' }).favorite, false);
});

test('les années impossibles sont neutralisées avec leur provenance', () => {
  const value = metadata.readClassification({
    year: 1200, yearSource: 'musicbrainz', yearConfidence: 'high',
  });
  assert.strictEqual(value.year, null);
  assert.strictEqual(value.yearSource, 'unknown');
  assert.strictEqual(value.yearConfidence, 'unknown');
});

test('une année valide conserve provenance et confiance', () => {
  const value = metadata.readClassification({
    year: 2007, yearSource: 'musicbrainz', yearConfidence: 'medium',
  });
  assert.deepStrictEqual(value, {
    favorite: false, genreDetail: '', genreSource: 'unknown',
    genreConfidence: 'unknown', year: 2007,
    yearSource: 'musicbrainz', yearConfidence: 'medium',
  });
});

test('le sous-genre est borné sans toucher au titre', () => {
  const patch = metadata.classificationPatch({
    genreDetail: 'Synthwave'.repeat(20), title: 'Ne doit pas passer',
  });
  assert.strictEqual(patch.genreDetail.length, 80);
  assert.strictEqual(Object.hasOwn(patch, 'title'), false);
});

test('vider une année efface aussi ses qualificatifs', () => {
  const patch = metadata.classificationPatch({
    year: '', yearSource: 'manual', yearConfidence: 'high',
  });
  assert.deepStrictEqual(patch, {
    year: null, yearSource: 'unknown', yearConfidence: 'unknown',
  });
});

console.log(`\n${passed} tests de métadonnées réussis.`);
