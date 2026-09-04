'use strict';

const assert = require('assert');
const metadata = require('../lib/track-metadata');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

test('la file de validation distingue les champs absents et incertains', () => {
  const missing = metadata.reviewStatus({artist: '', genre: 'Autre'});
  assert.strictEqual(missing.genre, true);
  assert.strictEqual(missing.year, true);
  assert.strictEqual(missing.missing, true);

  const uncertain = metadata.reviewStatus({
    artist: 'Artiste test',
    genre: 'Rock',
    genreConfidence: 'low',
    year: 2000,
    yearConfidence: 'unknown',
  });
  assert.strictEqual(uncertain.genreUncertain, true);
  assert.strictEqual(uncertain.yearUncertain, true);
  assert.strictEqual(uncertain.artistUncertain, true);
  assert.strictEqual(uncertain.missing, false);

  const confirmed = metadata.reviewStatus({
    artist: 'Artiste test',
    artistConfidence: 'medium',
    genre: 'Rock',
    genreConfidence: 'medium',
    year: 2000,
    yearConfidence: 'high',
  });
  assert.strictEqual(confirmed.any, false);
});

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

test('les anciennes provenances retrouvent une confiance prudente', () => {
  const catalogue = metadata.readClassification({
    genreSource: 'musicbrainz',
    year: 2007,
    yearSource: 'musicbrainz',
  });
  assert.strictEqual(catalogue.genreConfidence, 'medium');
  assert.strictEqual(catalogue.yearConfidence, 'medium');

  const manual = metadata.readClassification({
    genreSource: 'manual',
    year: 2007,
    yearSource: 'manual',
  });
  assert.strictEqual(manual.genreConfidence, 'high');
  assert.strictEqual(manual.yearConfidence, 'high');

  const explicitReview = metadata.readClassification({
    genreSource: 'musicbrainz',
    genreConfidence: 'unknown',
    year: 2007,
    yearSource: 'musicbrainz',
    yearConfidence: 'low',
  });
  assert.strictEqual(explicitReview.genreConfidence, 'unknown');
  assert.strictEqual(explicitReview.yearConfidence, 'low');
});

test('seules les valeurs fiables peuvent alimenter les modes thématiques', () => {
  assert.strictEqual(metadata.isTrusted({
    genre: 'Rock', genreSource: 'musicbrainz',
  }, 'genre'), true);
  assert.strictEqual(metadata.isTrusted({
    genre: 'Rock', genreConfidence: 'low',
  }, 'genre'), false);
  assert.strictEqual(metadata.isTrusted({
    year: 2007, yearSource: 'musicbrainz',
  }, 'year'), true);
  assert.strictEqual(metadata.isTrusted({
    year: 2007, yearConfidence: 'unknown',
  }, 'year'), false);
});

test('le sous-genre est borné sans toucher au titre', () => {
  const patch = metadata.classificationPatch({
    genreDetail: 'Synthwave'.repeat(20), title: 'Ne doit pas passer',
  });
  assert.strictEqual(patch.genreDetail.length, 80);
  assert.strictEqual(Object.hasOwn(patch, 'title'), false);
});

test('une variante non officielle exige son genre mais pas artiste ni année', () => {
  const value = metadata.reviewStatus({
    title: 'Version accélérée',
    unofficialVariant: true,
    genre: 'Électro / EDM',
    genreSource: 'youtube',
    genreConfidence: 'medium',
  });
  assert.strictEqual(value.artistMissing, false);
  assert.strictEqual(value.artistUncertain, false);
  assert.strictEqual(value.yearMissing, false);
  assert.strictEqual(value.genre, false);
  assert.strictEqual(value.any, false);
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
