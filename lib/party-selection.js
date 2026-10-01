'use strict';

const crypto = require('crypto');
const trackMetadata = require('./track-metadata');

const DRAW_COUNTS = new Set([
  5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200,
]);
const MAX_PARTY_TRACK_IDS = 20000;
const MAX_GENRE_DRAWS = 20;

const FIELD_RULES = {
  genre: track => trackMetadata.isTrusted(track, 'genre'),
  genreDetail: track => trackMetadata.isTrusted(track, 'genre')
    && Boolean(String(track.genreDetail || '').trim()),
  artist: track => {
    const value = String(track.artist || '').trim();
    return Boolean(value && !/^artiste inconnu(?:e)?$/i.test(value));
  },
  language: track => Boolean(String(track.language || '').trim()
    && ['high', 'medium'].includes(track.languageConfidence)),
  year: track => trackMetadata.isTrusted(track, 'year'),
};

function normalizeSelection(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const rawFilters = source.filters && typeof source.filters === 'object' && !Array.isArray(source.filters)
    ? source.filters : {};
  const filters = {};

  for (const key of Object.keys(FIELD_RULES)) {
    const rule = rawFilters[key] && typeof rawFilters[key] === 'object'
      ? rawFilters[key] : {};
    filters[key] = {
      value: typeof rule.value === 'string' ? rule.value.trim().slice(0, 200) : '',
      exclude: rule.exclude === true,
    };
  }

  const count = source.count === undefined || source.count === null || source.count === ''
    ? 0 : Number(source.count);
  if (!Number.isInteger(count) || count < 0 || (count !== 0 && !DRAW_COUNTS.has(count))) {
    throw new Error('La quantité de morceaux tirés n’est pas valide.');
  }
  const rawGenreDraws = Array.isArray(source.genreDraws)
    ? source.genreDraws.slice(0, MAX_GENRE_DRAWS) : [];
  const genreDraws = [];
  const usedGenres = new Set();
  for (const item of rawGenreDraws) {
    if (!item || typeof item !== 'object') continue;
    const genre = typeof item.genre === 'string' ? item.genre.trim().slice(0, 120) : '';
    const drawCount = Number(item.count);
    if (!genre) continue;
    if (!Number.isInteger(drawCount) || !DRAW_COUNTS.has(drawCount)) {
      throw new Error('Chaque genre doit avoir une quantité de pioche valide.');
    }
    const key = genre.toLocaleLowerCase('fr-FR');
    if (usedGenres.has(key)) throw new Error('Un genre ne peut apparaître qu’une fois dans la pioche.');
    usedGenres.add(key);
    genreDraws.push({ genre, count: drawCount });
  }
  return { filters, count, genreDraws };
}

function sameValue(left, right) {
  return String(left || '').trim().localeCompare(
    String(right || '').trim(), 'fr-FR', { sensitivity: 'base' }
  ) === 0;
}

function filterTracks(tracks, selection) {
  return tracks.filter(track => Object.entries(selection.filters).every(([key, rule]) => {
    if (!rule.value) return true;
    if (key === 'genre' && selection.genreDraws && selection.genreDraws.length && !rule.exclude) {
      return true;
    }
    const trusted = FIELD_RULES[key] && FIELD_RULES[key](track);
    const matches = trusted && sameValue(track[key], rule.value);
    return rule.exclude ? !matches : Boolean(matches);
  }));
}

function drawTracksByGenre(tracks, genreDraws, seed = 'songless') {
  const selected = [];
  for (const [index, draw] of genreDraws.entries()) {
    const group = tracks.filter(track => FIELD_RULES.genre(track) && sameValue(track.genre, draw.genre));
    selected.push(...drawTracks(group, draw.count, `${seed}|genre:${index}:${draw.genre}`));
  }
  return selected;
}

function drawTracks(tracks, count, seed = 'songless') {
  if (!count || tracks.length <= count) return tracks;
  return tracks.map((track, index) => ({
    track,
    index,
    score: crypto.createHash('sha256')
      .update(`${String(seed || 'songless')}|${String(track.id || '')}`)
      .digest('hex'),
  }))
    .sort((left, right) => left.score.localeCompare(right.score) || left.index - right.index)
    .slice(0, count)
    .map(item => item.track);
}

module.exports = {
  MAX_PARTY_TRACK_IDS,
  drawTracks,
  drawTracksByGenre,
  filterTracks,
  normalizeSelection,
};
