'use strict';

const YEAR_SOURCES = new Set(['manual', 'musicbrainz', 'tag', 'filename', 'unknown']);
const GENRE_SOURCES = new Set(['manual', 'musicbrainz', 'tag', 'filename', 'unknown']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low', 'unknown']);

function clean(value, max = 80) {
  return String(value || '').trim().slice(0, max);
}

function booleanValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function validYear(value) {
  const year = Math.floor(Number(value));
  const maximum = new Date().getFullYear() + 1;
  return year >= 1900 && year <= maximum ? year : null;
}

function confidenceFromSource(source, value, field) {
  if (Object.hasOwn(source, field) && CONFIDENCE_LEVELS.has(source[field])) {
    return source[field];
  }
  if (value === 'manual') return 'high';
  if (value === 'musicbrainz' || value === 'tag') return 'medium';
  if (value === 'filename') return 'low';
  return 'unknown';
}

function readClassification(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const favorite = Object.hasOwn(source, 'favorite')
    ? booleanValue(source.favorite)
    : booleanValue(source.favori) || booleanValue(source.coupDeCoeur);
  const year = validYear(source.year);
  const genreSource = GENRE_SOURCES.has(source.genreSource) ? source.genreSource : 'unknown';
  const yearSource = YEAR_SOURCES.has(source.yearSource) ? source.yearSource : 'unknown';
  const yearConfidence = confidenceFromSource(
    source,
    yearSource,
    'yearConfidence'
  );
  return {
    favorite,
    genreDetail: clean(source.genreDetail, 80),
    genreSource,
    genreConfidence: confidenceFromSource(
      source,
      genreSource,
      'genreConfidence'
    ),
    year,
    yearSource: year ? yearSource : 'unknown',
    yearConfidence: year ? yearConfidence : 'unknown',
  };
}

function classificationPatch(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const patch = {};
  if (Object.hasOwn(source, 'favorite')) patch.favorite = booleanValue(source.favorite);
  if (Object.hasOwn(source, 'genreDetail')) patch.genreDetail = clean(source.genreDetail, 80);
  if (Object.hasOwn(source, 'genreSource')) {
    patch.genreSource = GENRE_SOURCES.has(source.genreSource) ? source.genreSource : 'unknown';
  }
  if (Object.hasOwn(source, 'genreConfidence')) {
    patch.genreConfidence = CONFIDENCE_LEVELS.has(source.genreConfidence)
      ? source.genreConfidence : 'unknown';
  }
  if (Object.hasOwn(source, 'year')) patch.year = validYear(source.year);
  if (Object.hasOwn(source, 'yearSource')) {
    patch.yearSource = YEAR_SOURCES.has(source.yearSource) ? source.yearSource : 'unknown';
  }
  if (Object.hasOwn(source, 'yearConfidence')) {
    patch.yearConfidence = CONFIDENCE_LEVELS.has(source.yearConfidence)
      ? source.yearConfidence : 'unknown';
  }
  if (Object.hasOwn(patch, 'year') && patch.year === null) {
    patch.yearSource = 'unknown';
    patch.yearConfidence = 'unknown';
  }
  return patch;
}

function reviewStatus(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const classification = readClassification(source);
  const genre = clean(source.genre, 80);
  const artist = clean(source.artist, 160);
  const genreMissing = !genre || genre === 'Autre';
  const yearMissing = !classification.year;
  const artistMissing = !artist || artist === 'Artiste inconnu';
  const genreUncertain = !genreMissing
    && !['high', 'medium'].includes(classification.genreConfidence);
  const yearUncertain = !yearMissing
    && !['high', 'medium'].includes(classification.yearConfidence);

  return {
    any: genreMissing || genreUncertain || yearMissing || yearUncertain || artistMissing,
    genre: genreMissing || genreUncertain,
    year: yearMissing || yearUncertain,
    missing: genreMissing || yearMissing || artistMissing,
    genreMissing,
    genreUncertain,
    yearMissing,
    yearUncertain,
    artistMissing,
  };
}

module.exports = {
  CONFIDENCE_LEVELS,
  GENRE_SOURCES,
  YEAR_SOURCES,
  classificationPatch,
  readClassification,
  reviewStatus,
  validYear,
};
