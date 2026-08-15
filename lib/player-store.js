'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.SONGLESS_DATA_FILE
  ? path.resolve(process.env.SONGLESS_DATA_FILE)
  : path.join(__dirname, '..', 'songless-data.json');
const BACKUP_DIR = path.join(__dirname, '..', 'metadata-backups');
const HISTORY_MAX = 3000;

function emptyData() {
  return {
    version: 1,
    profiles: [],
    collections: [],
    challenges: [],
    updatedAt: new Date().toISOString(),
  };
}

let cache = null;

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
  base.collections = Array.isArray(data.collections) ? data.collections : [];
  base.challenges = Array.isArray(data.challenges) ? data.challenges : [];
  base.updatedAt = data.updatedAt || base.updatedAt;
  return base;
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
  return JSON.parse(JSON.stringify(load()));
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

function recordPartySessions(players) {
  const data = load();
  const source = Array.isArray(players) ? players : [];
  const best = Math.max(0, ...source.map(player => Number(player.score) || 0));
  const now = new Date().toISOString();
  const updated = [];
  for (const player of source) {
    const profile = data.profiles.find(item => item.id === String(player.profileId || ''));
    if (!profile) continue;
    const current = cleanMultiplayer(profile.multiplayer);
    const sessionScore = Math.max(0, Math.floor(Number(player.score) || 0));
    profile.multiplayer = {
      sessions: current.sessions + 1,
      wins: current.wins + Number(best > 0 && sessionScore === best),
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

function cleanNamedList(items, prefix) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 200).map(item => ({
    ...item,
    id: cleanId(item.id, prefix),
    nom: cleanText(item.nom, 60) || 'Sans nom',
    trackIds: Array.isArray(item.trackIds)
      ? [...new Set(item.trackIds.map(v => cleanText(v, 300)).filter(Boolean))].slice(0, 5000)
      : [],
    updatedAt: new Date().toISOString(),
  }));
}

function replaceLists({ collections, challenges }) {
  const data = load();
  if (collections !== undefined) data.collections = cleanNamedList(collections, 'c');
  if (challenges !== undefined) data.challenges = cleanNamedList(challenges, 'd');
  save();
  return publicState();
}

function replaceAll(input) {
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
  publicState,
  createProfile,
  upsertProfile,
  updateProfile,
  deleteProfile,
  recordPartySessions,
  replaceLists,
  replaceAll,
  backup,
};
