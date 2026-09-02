'use strict';

const crypto = require('crypto');

function text(value, max = 160) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function key(value) {
  return text(value, 120).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function cleanTrack(track) {
  const year = Number(track && track.year);
  return {
    id: text(track && track.id, 300),
    title: text(track && track.title, 200),
    artist: text(track && track.artist, 160),
    year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    genre: text(track && track.genre, 100),
    theme: text(track && (track.theme || track.genreDetail), 100),
  };
}

function deterministicOrder(values, seed) {
  return [...values].sort((left, right) => {
    const hash = value => crypto.createHash('sha256')
      .update(`${seed}:${value.id}`).digest('hex');
    return hash(left).localeCompare(hash(right));
  });
}

function groups(tracks, read) {
  const map = new Map();
  for (const track of tracks) {
    const value = read(track);
    const normalized = key(value);
    if (!normalized) continue;
    if (!map.has(normalized)) map.set(normalized, { value, tracks: [] });
    map.get(normalized).tracks.push(track);
  }
  return [...map.values()].filter(group => group.tracks.length >= 3);
}

function dimensionCandidates(tracks, dimension) {
  if (dimension === 'artist') {
    return groups(tracks, track => track.artist).map(group => ({
      group, intruders: tracks.filter(track => key(track.artist) !== key(group.value)),
    }));
  }
  if (dimension === 'genre') {
    return groups(tracks, track => track.genre).map(group => ({
      group, intruders: tracks.filter(track => key(track.genre) && key(track.genre) !== key(group.value)),
    }));
  }
  if (dimension === 'theme') {
    return groups(tracks, track => track.theme).map(group => ({
      group, intruders: tracks.filter(track => key(track.theme) && key(track.theme) !== key(group.value)),
    }));
  }
  if (dimension === 'year') {
    return groups(tracks, track => track.year ? Math.floor(track.year / 10) * 10 : '').map(group => ({
      group,
      intruders: tracks.filter(track => track.year && Math.floor(track.year / 10) * 10 !== Number(group.value)),
    }));
  }
  return [];
}

function preferredDimensions(round, totalRounds) {
  const progress = Math.max(0, Number(round) - 1) / Math.max(1, Number(totalRounds) - 1);
  if (progress < 0.34) return { difficulty: 'easy', dimensions: ['genre', 'theme', 'artist', 'year'] };
  if (progress < 0.67) return { difficulty: 'medium', dimensions: ['artist', 'theme', 'genre', 'year'] };
  return { difficulty: 'hard', dimensions: ['year', 'artist', 'theme', 'genre'] };
}

function explanation(dimension, common, intruder) {
  if (dimension === 'artist') {
    return `Trois morceaux sont de « ${common} » ; « ${intruder.title} » est de « ${intruder.artist} ».`;
  }
  if (dimension === 'genre') {
    return `Trois morceaux sont classés « ${common} » ; « ${intruder.title} » est classé « ${intruder.genre} ».`;
  }
  if (dimension === 'theme') {
    return `Trois morceaux partagent le thème « ${common} » ; « ${intruder.title} » relève de « ${intruder.theme} ».`;
  }
  const decade = Number(common);
  return `Trois morceaux datent des années ${decade} ; « ${intruder.title} » date de ${intruder.year}.`;
}

function generate(source, { seed = '', round = 1, totalRounds = 10 } = {}) {
  const tracks = (Array.isArray(source) ? source : []).map(cleanTrack)
    .filter(track => track.id && track.title);
  if (tracks.length < 4) return null;
  const preference = preferredDimensions(round, totalRounds);
  for (const dimension of preference.dimensions) {
    const candidates = deterministicOrder(
      dimensionCandidates(tracks, dimension).filter(candidate => candidate.intruders.length),
      `${seed}:${round}:${dimension}:group`
    );
    if (!candidates.length) continue;
    const candidate = candidates[0];
    const commonTracks = deterministicOrder(candidate.group.tracks, `${seed}:${round}:common`).slice(0, 3);
    let intruders = deterministicOrder(candidate.intruders, `${seed}:${round}:intruder`);
    if (dimension === 'year' && preference.difficulty === 'hard') {
      const decade = Number(candidate.group.value);
      intruders = intruders.sort((left, right) => (
        Math.abs(left.year - decade - 5) - Math.abs(right.year - decade - 5)
      ));
    }
    const intruder = intruders[0];
    const options = deterministicOrder([...commonTracks, intruder], `${seed}:${round}:options`);
    return {
      id: crypto.createHash('sha256').update(`${seed}:${round}:${options.map(item => item.id).join('|')}`).digest('hex').slice(0, 16),
      dimension,
      difficulty: preference.difficulty,
      prompt: 'Quel est l’intrus ?',
      options,
      answerId: intruder.id,
      explanation: explanation(dimension, candidate.group.value, intruder),
    };
  }
  return null;
}

function publicChallenge(challenge, reveal = false) {
  if (!challenge) return null;
  return {
    id: challenge.id,
    dimension: challenge.dimension,
    difficulty: challenge.difficulty,
    prompt: challenge.prompt,
    options: challenge.options.map(option => ({ ...option })),
    answerId: reveal ? challenge.answerId : null,
    explanation: reveal ? challenge.explanation : null,
  };
}

module.exports = { cleanTrack, generate, preferredDimensions, publicChallenge };
