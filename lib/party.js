'use strict';

const crypto = require('crypto');

const parties = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function code() {
  for (let essai = 0; essai < 100; essai++) {
    let value = '';
    for (let i = 0; i < 5; i++) value += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!parties.has(value)) return value;
  }
  throw new Error('Impossible de créer un code de partie.');
}

function cleanup() {
  const limit = Date.now() - 12 * 60 * 60 * 1000;
  for (const [key, party] of parties) {
    if (party.updatedAt < limit) parties.delete(key);
  }
}

function cleanAnswer(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function cleanAnswerSpec(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    mode: ['titre', 'artiste', 'annee'].includes(source.mode) ? source.mode : 'titre',
    title: String(source.title || '').slice(0, 200),
    originalTitle: String(source.originalTitle || '').slice(0, 200),
    artist: String(source.artist || '').slice(0, 200),
    year: Number(source.year) || null,
    aliases: Array.isArray(source.aliases) ? source.aliases.slice(0, 30).map(v => String(v).slice(0, 200)) : [],
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
      .filter(v => v.length >= 2);
    return artists.includes(value) || cleanAnswer(spec.artist) === value;
  }

  const accepted = [spec.title, spec.originalTitle, ...spec.aliases]
    .map(cleanAnswer)
    .filter(v => v.length > 2);
  const title = cleanAnswer(spec.title);
  const artist = cleanAnswer(spec.artist);
  return accepted.includes(value)
    || value === `${artist}${title}`
    || value === `${title}${artist}`
    || Boolean(artist && title && value.includes(title) && value.includes(artist));
}

function create({ mode = 'classic', totalRounds = 10, seed = '', settings = {} }) {
  cleanup();
  const party = {
    code: code(),
    hostToken: token(),
    inviteToken: token(),
    mode: mode === 'buzzer' ? 'buzzer' : 'classic',
    totalRounds: Math.min(100, Math.max(1, Number(totalRounds) || 10)),
    seed: String(seed || '').slice(0, 40),
    settings: cleanPartySettings(settings),
    status: 'lobby',
    round: 0,
    currentTrackId: null,
    roundStartedAt: null,
    answerSpec: null,
    revealedTrack: null,
    players: [],
    buzzOrder: [],
    statsCommitted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  parties.set(party.code, party);
  return { party, hostToken: party.hostToken };
}

function cleanPartySettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    answer: ['titre', 'artiste', 'annee'].includes(source.answer) ? source.answer : 'titre',
    speed: [0.75, 1, 1.25, 1.5].includes(Number(source.speed)) ? Number(source.speed) : 1,
    direction: source.direction === 'inverse' ? 'inverse' : 'normal',
    start: ['seed', 'refrain', 'debut'].includes(source.start) ? source.start : 'seed',
    excerpt: Math.min(60, Math.max(1, Number(source.excerpt) || 15)),
    points: Math.min(5000, Math.max(100, Math.round(Number(source.points) || 1000))),
  };
}

function joinParty(party, profile) {
  const existing = party.players.find(p => p.profileId === profile.id);
  if (existing) {
    existing.nom = String(profile.nom || existing.nom).slice(0, 20);
    existing.emoji = String(profile.emoji || existing.emoji).slice(0, 4);
    existing.globalStats = profile.multiplayer && typeof profile.multiplayer === 'object'
      ? { ...profile.multiplayer } : existing.globalStats;
    existing.connected = true;
    existing.updatedAt = Date.now();
    return existing;
  }
  const player = {
    token: token(),
    profileId: String(profile.id),
    nom: String(profile.nom || 'Joueur').slice(0, 20),
    emoji: String(profile.emoji || '🎧').slice(0, 4),
    host: false,
    score: 0,
    sessionRounds: party.status === 'round' ? 1 : 0,
    sessionAnswers: 0,
    sessionCorrect: 0,
    globalStats: profile.multiplayer && typeof profile.multiplayer === 'object'
      ? { ...profile.multiplayer } : {},
    answer: null,
    correct: null,
    buzzedAt: null,
    connected: true,
    updatedAt: Date.now(),
  };
  party.players.push(player);
  party.updatedAt = Date.now();
  return player;
}

function get(codeValue) {
  cleanup();
  return parties.get(String(codeValue || '').toUpperCase()) || null;
}

function join(codeValue, profile) {
  const party = get(codeValue);
  if (!party) return null;
  if (party.status === 'finished') throw new Error('Cette partie est terminée.');
  return { party, player: joinParty(party, profile) };
}

function isHost(party, hostToken) {
  return Boolean(party && hostToken && party.hostToken === hostToken);
}

function isInvited(codeValue, inviteToken) {
  const party = get(codeValue);
  if (!party || !inviteToken) return false;
  if (party.finishedAt && Date.now() - party.finishedAt > 30 * 60 * 1000) return false;
  const expected = Buffer.from(party.inviteToken);
  const received = Buffer.from(String(inviteToken));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function findPlayer(party, playerToken) {
  return party && party.players.find(p => p.token === playerToken);
}

function command(party, hostToken, action, data = {}) {
  if (!isHost(party, hostToken)) throw new Error('Commande réservée à l’hôte.');
  if (action === 'start-round') {
    party.status = 'round';
    party.round = Math.min(party.totalRounds, Math.max(1, Number(data.round) || party.round + 1));
    party.currentTrackId = String(data.trackId || '');
    party.roundStartedAt = Date.now();
    party.answerSpec = cleanAnswerSpec(data.answer);
    party.revealedTrack = null;
    party.buzzOrder = [];
    for (const p of party.players) {
      p.sessionRounds++;
      p.answer = null;
      p.correct = null;
      p.buzzedAt = null;
    }
  } else if (action === 'reveal') {
    party.status = 'reveal';
    party.revealedTrack = data.track && typeof data.track === 'object' ? {
      title: String(data.track.title || '').slice(0, 200),
      artist: String(data.track.artist || '').slice(0, 200),
      genre: String(data.track.genre || '').slice(0, 80),
    } : null;
  } else if (action === 'score') {
    const player = party.players.find(p => p.profileId === String(data.profileId));
    if (player) {
      player.score = Math.max(0, player.score + Math.round(Number(data.points) || 0));
      if (typeof data.correct === 'boolean') player.correct = data.correct;
    }
  } else if (action === 'finish') {
    party.status = 'finished';
    party.finishedAt = Date.now();
    party.currentTrackId = null;
    party.answerSpec = null;
  } else if (action === 'lobby') {
    party.status = 'lobby';
    party.currentTrackId = null;
    party.answerSpec = null;
  } else {
    throw new Error('Commande de partie inconnue.');
  }
  party.updatedAt = Date.now();
  return party;
}

function playerAction(party, playerToken, action, data = {}) {
  const player = findPlayer(party, playerToken);
  if (!player) throw new Error('Joueur inconnu dans cette partie.');
  if (party.status !== 'round') throw new Error('Aucune manche n’est ouverte.');
  if (action === 'answer') {
    if (player.answer !== null) throw new Error('Réponse déjà envoyée pour cette manche.');
    if (party.mode === 'buzzer' && party.buzzOrder[0] !== player.profileId) {
      throw new Error('Seul le premier joueur au buzzer peut répondre.');
    }
    player.answer = String(data.answer || '').trim().slice(0, 200);
    player.sessionAnswers++;
    player.correct = answerIsCorrect(player.answer, party.answerSpec);
    if (player.correct) {
      player.sessionCorrect++;
      const elapsed = Math.max(0, Date.now() - (party.roundStartedAt || Date.now()));
      const base = party.settings.points;
      const speedBonus = party.mode === 'buzzer'
        ? 0
        : Math.max(0, Math.round(base / 2) - Math.floor(elapsed / 100));
      player.score += base + speedBonus;
    }
    player.updatedAt = Date.now();
  } else if (action === 'buzz') {
    if (!player.buzzedAt) {
      player.buzzedAt = Date.now();
      party.buzzOrder.push(player.profileId);
    }
  } else {
    throw new Error('Action de joueur inconnue.');
  }
  party.updatedAt = Date.now();
  return party;
}

function publicState(party, playerToken, hostToken) {
  const viewer = findPlayer(party, playerToken);
  const host = isHost(party, hostToken);
  return {
    code: party.code,
    mode: party.mode,
    totalRounds: party.totalRounds,
    seed: party.seed,
    settings: party.settings,
    status: party.status,
    round: party.round,
    currentTrackId: host ? party.currentTrackId : null,
    revealedTrack: party.revealedTrack,
    isHost: host,
    viewerProfileId: viewer ? viewer.profileId : null,
    players: party.players.map(p => ({
      profileId: p.profileId,
      nom: p.nom,
      emoji: p.emoji,
      host: p.host,
      score: p.score,
      session: {
        rounds: p.sessionRounds,
        answers: p.sessionAnswers,
        correct: p.sessionCorrect,
      },
      globalStats: p.globalStats || {},
      answer: host || p === viewer || party.status !== 'round' ? p.answer : (p.answer ? 'Réponse envoyée' : null),
      correct: host || p === viewer || party.status !== 'round' ? p.correct : null,
      buzzPosition: party.buzzOrder.indexOf(p.profileId) + 1 || null,
    })),
  };
}

module.exports = { create, get, join, isInvited, command, playerAction, publicState };
