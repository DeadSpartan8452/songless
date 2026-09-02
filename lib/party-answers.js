'use strict';

const unicode = require('./unicode');

function cleanAnswer(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return unicode.keepLettersAndNumbers(normalized);
}

function cleanAnswerSpec(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    mode: ['titre', 'artiste', 'annee'].includes(source.mode) ? source.mode : 'titre',
    title: String(source.title || '').slice(0, 200),
    originalTitle: String(source.originalTitle || '').slice(0, 200),
    artist: String(source.artist || '').slice(0, 200),
    year: Number(source.year) || null,
    aliases: Array.isArray(source.aliases)
      ? source.aliases.slice(0, 30).map(value => String(value).slice(0, 200))
      : [],
  };
}

function answerIsCorrect(answer, spec) {
  if (!spec) return false;
  if (spec.mode === 'annee') {
    const year = parseInt(String(answer).replace(/\D/g, ''), 10);
    return Boolean(year && spec.year && Math.abs(year - spec.year) <= 2);
  }

  const value = cleanAnswer(answer);
  if (!value) return false;
  if (spec.mode === 'artiste') {
    const artists = String(spec.artist || '')
      .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bavec\b|\bx\b|\/|\+/i)
      .map(cleanAnswer)
      .filter(candidate => candidate.length >= 2);
    return artists.includes(value) || cleanAnswer(spec.artist) === value;
  }

  const accepted = [spec.title, spec.originalTitle, ...(spec.aliases || [])]
    .map(cleanAnswer)
    .filter(candidate => candidate.length > 2);
  const title = cleanAnswer(spec.title);
  const artist = cleanAnswer(spec.artist);
  return accepted.includes(value)
    || value === `${artist}${title}`
    || value === `${title}${artist}`
    || Boolean(artist && title && value.includes(title) && value.includes(artist));
}

module.exports = { answerIsCorrect, cleanAnswer, cleanAnswerSpec };
