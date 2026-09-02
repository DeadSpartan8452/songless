'use strict';

const fs = require('fs');
const path = require('path');
const blacklist = require('./blacklist');

const CUSTOM_DATA_FILE = process.env.SONGLESS_DATA_FILE;
const DATA_FILE = CUSTOM_DATA_FILE
  ? path.resolve(CUSTOM_DATA_FILE)
  : path.join(__dirname, '..', 'songless-data.json');
const BACKUP_DIR = process.env.SONGLESS_BACKUP_DIR
  ? path.resolve(process.env.SONGLESS_BACKUP_DIR)
  : CUSTOM_DATA_FILE
    ? path.join(path.dirname(DATA_FILE), 'metadata-backups')
    : path.join(__dirname, '..', 'metadata-backups');
const HISTORY_MAX = 3000;

function emptyData() {
  return {
    version: 2,
    profiles: [],
    collections: [],
    challenges: [],
    partyHistory: [],
    blacklist: [],
    updatedAt: new Date().toISOString(),
  };
}

let cache = null;
const TEAM_COLOR_FALLBACK = '#8b5cf6';

function sanitizeTeamColor(value, fallback = TEAM_COLOR_FALLBACK) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function cleanText(value, max = 80) {
  return String(value || '').trim().slice(0, max);
}

function cleanId(value, prefix = 'p') {
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return id || `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function cleanStats(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  const n = (value) => Math.max(0, Math.floor(Number(value) || 0));
  const distribution = Array.isArray(source.distribution)
    ? source.distribution.slice(0, 6).map(n)
    : [0, 0, 0, 0, 0, 0];
  while (distribution.length < 6) distribution.push(0);
  return {
    played: n(source.played),
    wins: n(source.wins),
    abandons: n(source.abandons),
    streak: n(source.streak),
    maxStreak: n(source.maxStreak),
    distribution,
    startedAt: source.startedAt ? String(source.startedAt) : new Date().toISOString(),
  };
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-HISTORY_MAX).map((entry) => ({
    id: cleanText(entry.id, 300),
    titre: cleanText(entry.titre, 200),
    artiste: cleanText(entry.artiste, 200),
    genre: cleanText(entry.genre, 80) || 'Autre',
    annee: Number(entry.annee) || null,
    issue: ['win', 'lose', 'abandon'].includes(entry.issue) ? entry.issue : 'lose',
    essai: Number(entry.essai) || null,
    essais: Array.isArray(entry.essais) ? entry.essais.slice(0, 6).map(v => cleanText(v, 20)) : [],
    mode: cleanText(entry.mode, 20) || 'titre',
    seed: cleanText(entry.seed, 40),
    ts: Number(entry.ts) || Date.now(),
  }));
}

function cleanSettings(settings) {
  if (!settings || typeof settings !== 'object') return {};
  const allowed = ['reponse', 'vitesse', 'sens', 'depart', 'preset', 'paliers'];
  return Object.fromEntries(allowed
    .filter(key => Object.prototype.hasOwnProperty.call(settings, key))
    .map(key => [key, settings[key]]));
}

function cleanMultiplayer(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  const n = value => Math.max(0, Math.floor(Number(value) || 0));
  return {
    sessions: n(source.sessions),
    wins: n(source.wins),
    rounds: n(source.rounds),
    answers: n(source.answers),
    correct: n(source.correct),
    score: n(source.score),
    bestScore: n(source.bestScore),
    lastPlayedAt: source.lastPlayedAt ? String(source.lastPlayedAt) : null,
  };
}

function cleanPartyHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(0, 200).map(entry => ({
    id: cleanText(entry.id, 80),
    date: entry.date ? String(entry.date) : new Date().toISOString(),
    code: cleanText(entry.code, 10),
    mode: cleanText(entry.mode, 20),
    totalRounds: Math.max(0, Number(entry.totalRounds) || 0),
    winner: entry.winner ? {
      nom: cleanText(entry.winner.nom, 30),
      emoji: cleanText(entry.winner.emoji, 4),
      score: Number(entry.winner.score) || 0,
    } : null,
    winningTeam: entry.winningTeam ? {
      name: cleanText(entry.winningTeam.name, 40),
      color: sanitizeTeamColor(entry.winningTeam.color),
      emoji: cleanText(entry.winningTeam.emoji, 4),
      score: Number(entry.winningTeam.score) || 0,
    } : null,
    playersCount: Math.max(0, Number(entry.playersCount) || 0),
    players: Array.isArray(entry.players) ? entry.players.slice(0, 32).map(player => ({
      nom: cleanText(player.nom, 30),
      emoji: cleanText(player.emoji, 4),
      score: Number(player.score) || 0,
      rank: Math.max(0, Number(player.rank) || 0),
      teamId: cleanText(player.teamId, 40),
    })) : [],
  }));
}

function cleanProfile(profile, previous = null) {
  const now = new Date().toISOString();
  return {
    id: previous ? previous.id : cleanId(profile.id, 'p'),
    nom: cleanText(profile.nom, 20) || (previous && previous.nom) || 'Joueur',
    emoji: cleanText(profile.emoji, 4) || (previous && previous.emoji) || '🎧',
    stats: profile.stats ? cleanStats(profile.stats) : (previous && previous.stats) || cleanStats(),
    history: profile.history ? cleanHistory(profile.history) : (previous && previous.history) || [],
    settings: profile.settings ? cleanSettings(profile.settings) : (previous && previous.settings) || {},
    multiplayer: profile.multiplayer
      ? cleanMultiplayer(profile.multiplayer)
      : (previous && previous.multiplayer) || cleanMultiplayer(),
    createdAt: (previous && previous.createdAt) || now,
    updatedAt: now,
  };
}

function normalize(data) {
  const base = emptyData();
  if (!data || typeof data !== 'object') return base;
  base.profiles = Array.isArray(data.profiles) ? data.profiles.map(p => cleanProfile(p)) : [];
  base.collections = cleanNamedList(data.collections, 'c', { preserveUpdatedAt: true });
  base.challenges = cleanNamedList(data.challenges, 'd', { preserveUpdatedAt: true });
  base.partyHistory = cleanPartyHistory(data.partyHistory);
  base.blacklist = cleanBlacklist(data.blacklist);
  base.updatedAt = data.updatedAt || base.updatedAt;
  return base;
}

function cleanBlacklist(items) {
  if (!Array.isArray(items)) return [];
  const cleaned = [];
  for (const item of items.slice(0, 500)) {
    try {
      cleaned.push(blacklist.normalizeRule(item, null, item && item.updatedAt || new Date()));
    } catch (_) { /* une ancienne règle illisible ne doit pas bloquer Songless */ }
  }
  return blacklist.purgeExpired(cleaned);
}

function load() {
  if (cache) return cache;
  try {
    cache = normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (_) {
    cache = emptyData();
  }
  return cache;
}

function save() {
  const data = load();
  data.updatedAt = new Date().toISOString();
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, DATA_FILE);
  return data;
}

function publicState() {
  purgeBlacklist();
  return JSON.parse(JSON.stringify(load()));
}

function purgeBlacklist(now = new Date()) {
  const data = load();
  const active = blacklist.purgeExpired(data.blacklist, now);
  if (active.length === data.blacklist.length) return false;
  data.blacklist = active;
  save();
  return true;
}

function blacklistRules() {
  purgeBlacklist();
  return JSON.parse(JSON.stringify(load().blacklist));
}

function createBlacklistRule(input) {
  const data = load();
  const rule = blacklist.normalizeRule(input);
  data.blacklist.push(rule);
  save();
  return JSON.parse(JSON.stringify(rule));
}

function updateBlacklistRule(id, patch) {
  const data = load();
  const index = data.blacklist.findIndex(rule => rule.id === String(id || ''));
  if (index < 0) return null;
  data.blacklist[index] = blacklist.normalizeRule(patch, data.blacklist[index]);
  save();
  return JSON.parse(JSON.stringify(data.blacklist[index]));
}

function deleteBlacklistRule(id) {
  const data = load();
  const before = data.blacklist.length;
  data.blacklist = data.blacklist.filter(rule => rule.id !== String(id || ''));
  if (data.blacklist.length === before) return false;
  save();
  return true;
}

function consumeBlacklistParty(mode, now = new Date()) {
  const data = load();
  data.blacklist = blacklist.consumeParty(data.blacklist, mode, now);
  save();
  return blacklistRules();
}

function upsertProfile(input) {
  const data = load();
  const requestedId = cleanId(input && input.id, 'p');
  const index = data.profiles.findIndex(p => p.id === requestedId);
  const profile = cleanProfile({ ...input, id: requestedId }, index >= 0 ? data.profiles[index] : null);
  if (index >= 0) data.profiles[index] = profile;
  else data.profiles.push(profile);
  save();
  return profile;
}

function createProfile(input) {
  const data = load();
  const profile = cleanProfile({
    nom: input && input.nom,
    emoji: input && input.emoji,
  });
  data.profiles.push(profile);
  save();
  return profile;
}

function updateProfile(id, patch) {
  const data = load();
  const index = data.profiles.findIndex(p => p.id === id);
  if (index < 0) return null;
  data.profiles[index] = cleanProfile({ ...data.profiles[index], ...patch }, data.profiles[index]);
  save();
  return data.profiles[index];
}

function deleteProfile(id) {
  const data = load();
  const before = data.profiles.length;
  data.profiles = data.profiles.filter(p => p.id !== id);
  if (data.profiles.length === before) return false;
  save();
  return true;
}

function recordPartySessions(players, winnerProfileId = null) {
  const data = load();
  const source = Array.isArray(players) ? players : [];
  const registered = source.filter(player => (
    data.profiles.some(item => item.id === String(player.profileId || ''))
  ));
  const best = Math.max(0, ...registered.map(player => Number(player.score) || 0));
  const now = new Date().toISOString();
  const updated = [];
  for (const player of registered) {
    const profile = data.profiles.find(item => item.id === String(player.profileId || ''));
    if (!profile) continue;
    const current = cleanMultiplayer(profile.multiplayer);
    const sessionScore = Math.max(0, Math.floor(Number(player.score) || 0));
    profile.multiplayer = {
      sessions: current.sessions + 1,
      wins: current.wins + Number(winnerProfileId
        ? String(player.profileId) === String(winnerProfileId)
        : best > 0 && sessionScore === best),
      rounds: current.rounds + Math.max(0, Math.floor(Number(player.sessionRounds) || 0)),
      answers: current.answers + Math.max(0, Math.floor(Number(player.sessionAnswers) || 0)),
      correct: current.correct + Math.max(0, Math.floor(Number(player.sessionCorrect) || 0)),
      score: current.score + sessionScore,
      bestScore: Math.max(current.bestScore, sessionScore),
      lastPlayedAt: now,
    };
    profile.updatedAt = now;
    updated.push({ id: profile.id, multiplayer: { ...profile.multiplayer } });
  }
  if (updated.length) save();
  return updated;
}

function cleanNamedList(items, prefix, { preserveUpdatedAt = false } = {}) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 200).map(item => {
    const source = item && typeof item === 'object' ? item : {};
    return ({
      ...source,
      id: cleanId(source.id, prefix),
      nom: cleanText(source.nom, 60) || 'Sans nom',
      trackIds: Array.isArray(source.trackIds)
        ? [...new Set(source.trackIds.map(v => cleanText(v, 300)).filter(Boolean))].slice(0, 5000)
        : [],
      updatedAt: preserveUpdatedAt && source.updatedAt
        ? String(source.updatedAt)
        : new Date().toISOString(),
    });
  });
}

function recordPartyHistory(entry) {
  const data = load();
  if (!Array.isArray(data.partyHistory)) data.partyHistory = [];
  data.partyHistory.unshift({
    id: `ph_${Date.now()}`,
    date: new Date().toISOString(),
    code: cleanText(entry.code, 10),
    mode: cleanText(entry.mode, 20),
    totalRounds: Number(entry.totalRounds) || 0,
    winner: entry.winner ? {
      nom: cleanText(entry.winner.nom, 30),
      emoji: cleanText(entry.winner.emoji, 4),
      score: Number(entry.winner.score) || 0,
    } : null,
    winningTeam: entry.winningTeam ? {
      name: cleanText(entry.winningTeam.name, 40),
      color: sanitizeTeamColor(entry.winningTeam.color),
      emoji: cleanText(entry.winningTeam.emoji, 4),
      score: Number(entry.winningTeam.score) || 0,
    } : null,
    playersCount: Number(entry.playersCount) || 0,
    players: Array.isArray(entry.players) ? entry.players.slice(0, 32).map(p => ({
      nom: cleanText(p.nom, 30),
      emoji: cleanText(p.emoji, 4),
      score: Number(p.score) || 0,
      rank: Number(p.rank) || 0,
      teamId: cleanText(p.teamId, 40),
    })) : [],
  });
  if (data.partyHistory.length > 200) data.partyHistory.splice(200);
  save();
  return data.partyHistory;
}

function partyHistory() {
  const data = load();
  return Array.isArray(data.partyHistory) ? data.partyHistory : [];
}

function replaceLists({ collections, challenges }) {
  const data = load();
  if (collections !== undefined) data.collections = cleanNamedList(collections, 'c');
  if (challenges !== undefined) data.challenges = cleanNamedList(challenges, 'd');
  save();
  return publicState();
}

function replaceAll(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('le contenu doit être un objet JSON');
  }
  if (!Array.isArray(input.profiles)) {
    throw new Error('la liste des profils est absente ou invalide');
  }
  for (const key of ['collections', 'challenges', 'partyHistory', 'blacklist']) {
    if (input[key] !== undefined && !Array.isArray(input[key])) {
      throw new Error(`la liste « ${key} » est invalide`);
    }
  }
  cache = normalize(input);
  save();
  return publicState();
}

function backup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `songless-data-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(load(), null, 2)}\n`, 'utf8');
  return file;
}

module.exports = {
  DATA_FILE,
  BACKUP_DIR,
  publicState,
  createProfile,
  upsertProfile,
  updateProfile,
  deleteProfile,
  recordPartySessions,
  recordPartyHistory,
  partyHistory,
  blacklistRules,
  createBlacklistRule,
  updateBlacklistRule,
  deleteBlacklistRule,
  consumeBlacklistParty,
  purgeBlacklist,
  replaceLists,
  replaceAll,
  backup,
};
