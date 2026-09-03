'use strict';

const titles = require('./titles');
const trackMetadata = require('./track-metadata');

function canonicalGenre(value) {
  const genre = titles.resolveGenre(String(value || '').trim());
  return genre && genre !== 'Autre' ? genre : '';
}

function proposalFor(track = {}, candidateGenre = '', source = 'tag') {
  if (trackMetadata.isTrusted(track, 'genre')) return null;
  if (!['tag', 'musicbrainz'].includes(source)) return null;
  const proposed = canonicalGenre(candidateGenre);
  if (!proposed) return null;

  const current = canonicalGenre(track.genre);
  if (current && current !== proposed) return null;
  return {
    genre: proposed,
    genreSource: source,
    genreConfidence: 'medium',
  };
}

function validatePlan(plan, tracks, presentFiles, source = 'tag') {
  const changes = plan && typeof plan === 'object' ? plan.changes : null;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('Aperçu invalide : objet changes absent.');
  }

  const valid = {};
  for (const [fileName, entry] of Object.entries(changes).slice(0, 5000)) {
    if (!Object.hasOwn(tracks, fileName) || !presentFiles.has(fileName)) continue;
    const proposal = proposalFor(tracks[fileName], entry && entry.genre, source);
    if (proposal) valid[fileName] = proposal;
  }
  return valid;
}

module.exports = { canonicalGenre, proposalFor, validatePlan };
