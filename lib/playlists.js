'use strict';

const crypto = require('crypto');

const QUOTAS = new Set([0, 10, 20, 50]);
const STATUSES = new Set(['draft', 'collecting', 'locked', 'archived']);
const MAX_TRACKS = 5000;
const MAX_CONTRIBUTIONS = 10000;
const MAX_ACTIVITY = 500;

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function id(value, prefix = 'pl') {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function iso(value, fallback = new Date().toISOString()) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function cleanSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const themeType = ['none', 'genre', 'decade', 'mood'].includes(source.themeType)
    ? source.themeType : 'none';
  return {
    hideOthers: source.hideOthers !== false,
    fairOrder: source.fairOrder !== false,
    avoidSameArtist: source.avoidSameArtist !== false,
    explicitFilter: Boolean(source.explicitFilter),
    allowDuplicates: Boolean(source.allowDuplicates),
    timerMinutes: [0, 5, 10, 20].includes(Number(source.timerMinutes))
      ? Number(source.timerMinutes) : 0,
    themeType,
    themeValue: themeType === 'none' ? '' : text(source.themeValue, 60),
  };
}

function cleanContribution(input) {
  const source = input && typeof input === 'object' ? input : {};
  const trackId = text(source.trackId, 300);
  if (!trackId) return null;
  return {
    profileId: text(source.profileId, 64),
    profileName: text(source.profileName, 30) || 'Joueur',
    trackId,
    reserve: Boolean(source.reserve),
    addedAt: iso(source.addedAt),
  };
}

function cleanActivity(input) {
  const source = input && typeof input === 'object' ? input : {};
  const type = text(source.type, 40);
  if (!type) return null;
  return {
    id: id(source.id, 'act'),
    type,
    profileId: text(source.profileId, 64),
    profileName: text(source.profileName, 30),
    trackId: text(source.trackId, 300),
    label: text(source.label, 180),
    at: iso(source.at),
  };
}

function cleanPlaylist(input, { preserveUpdatedAt = true } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const now = new Date().toISOString();
  const trackIds = Array.isArray(source.trackIds)
    ? [...new Set(source.trackIds.map(value => text(value, 300)).filter(Boolean))].slice(0, MAX_TRACKS)
    : [];
  const contributions = Array.isArray(source.contributions)
    ? source.contributions.map(cleanContribution).filter(Boolean).slice(-MAX_CONTRIBUTIONS)
    : [];
  const allowed = new Set(trackIds);
  const filteredContributions = contributions.filter(item => allowed.has(item.trackId));
  const quota = QUOTAS.has(Number(source.quotaPerPlayer)) ? Number(source.quotaPerPlayer) : 0;
  const reserve = quota ? Math.min(10, Math.max(0, Number(source.reservePerPlayer) || 2)) : 0;
  const createdAt = iso(source.createdAt, now);
  const status = STATUSES.has(source.status) ? source.status : 'draft';
  return {
    id: id(source.id, 'pl'),
    nom: text(source.nom, 60) || 'Sans nom',
    description: text(source.description, 280),
    trackIds,
    collaborative: Boolean(source.collaborative),
    quotaPerPlayer: quota,
    reservePerPlayer: reserve,
    status,
    deadlineAt: source.deadlineAt ? iso(source.deadlineAt, null) : null,
    settings: cleanSettings(source.settings),
    contributions: filteredContributions,
    activity: Array.isArray(source.activity)
      ? source.activity.map(cleanActivity).filter(Boolean).slice(-MAX_ACTIVITY) : [],
    ratings: Array.isArray(source.ratings) ? source.ratings.slice(-10000).map(rating => ({
      profileId: text(rating && rating.profileId, 64),
      trackId: text(rating && rating.trackId, 300),
      value: Number(rating && rating.value) === -1 ? -1 : 1,
      at: iso(rating && rating.at),
    })).filter(rating => rating.profileId && trackIds.includes(rating.trackId)) : [],
    sessionsPlayed: Math.max(0, Math.floor(Number(source.sessionsPlayed) || 0)),
    lastPlayedAt: source.lastPlayedAt ? iso(source.lastPlayedAt, null) : null,
    createdAt,
    updatedAt: preserveUpdatedAt && source.updatedAt ? iso(source.updatedAt, now) : now,
  };
}

function rateTrack(playlist, input) {
  const profileId = text(input && input.profileId, 64);
  const trackId = text(input && input.trackId, 300);
  const value = Number(input && input.value) === -1 ? -1 : 1;
  if (!profileId || !playlist.trackIds.includes(trackId)) throw new Error('Vote de playlist invalide.');
  playlist.ratings = playlist.ratings.filter(item => !(
    item.profileId === profileId && item.trackId === trackId
  ));
  playlist.ratings.push({ profileId, trackId, value, at: new Date().toISOString() });
  playlist.updatedAt = new Date().toISOString();
  return playlist.ratings.filter(item => item.trackId === trackId)
    .reduce((sum, item) => sum + item.value, 0);
}

function log(playlist, activity) {
  const item = cleanActivity(activity);
  if (!item) return;
  playlist.activity.push(item);
  if (playlist.activity.length > MAX_ACTIVITY) {
    playlist.activity.splice(0, playlist.activity.length - MAX_ACTIVITY);
  }
}

function contributionCounts(playlist, profileId) {
  const mine = playlist.contributions.filter(item => item.profileId === String(profileId || ''));
  return {
    main: new Set(mine.filter(item => !item.reserve).map(item => item.trackId)).size,
    reserve: new Set(mine.filter(item => item.reserve).map(item => item.trackId)).size,
  };
}

function addTrack(playlist, input, { host = false } = {}) {
  if (!playlist || !input) throw new Error('Playlist ou morceau invalide.');
  if (!host && !playlist.collaborative) throw new Error('Cette playlist n’accepte pas de propositions.');
  if (!host && playlist.status !== 'collecting') throw new Error('La collecte de cette playlist est fermée.');
  if (!host && playlist.deadlineAt && new Date(playlist.deadlineAt).getTime() <= Date.now()) {
    throw new Error('Le temps de collecte est terminé.');
  }
  const contribution = cleanContribution(input);
  if (!contribution || !contribution.profileId) throw new Error('Contribution invalide.');
  const existing = playlist.contributions.find(item => (
    item.profileId === contribution.profileId && item.trackId === contribution.trackId
  ));
  if (existing) return { added: false, duplicate: true, contribution: existing };

  if (!host && playlist.quotaPerPlayer) {
    const counts = contributionCounts(playlist, contribution.profileId);
    const limit = contribution.reserve ? playlist.reservePerPlayer : playlist.quotaPerPlayer;
    const current = contribution.reserve ? counts.reserve : counts.main;
    if (current >= limit) {
      throw new Error(contribution.reserve
        ? `Tes ${limit} morceaux de réserve sont déjà prêts.`
        : `Tes ${limit} morceaux principaux sont déjà prêts.`);
    }
  }

  const alreadyInPlaylist = playlist.trackIds.includes(contribution.trackId);
  if (!alreadyInPlaylist) playlist.trackIds.push(contribution.trackId);
  playlist.contributions.push(contribution);
  log(playlist, {
    type: alreadyInPlaylist ? 'co-credit' : 'track-added',
    profileId: contribution.profileId,
    profileName: contribution.profileName,
    trackId: contribution.trackId,
    label: contribution.reserve ? 'Ajouté en réserve' : 'Ajouté à la playlist',
  });
  playlist.updatedAt = new Date().toISOString();
  return { added: !alreadyInPlaylist, duplicate: alreadyInPlaylist, contribution };
}

function removeTrack(playlist, trackId, actor = {}) {
  const value = text(trackId, 300);
  const before = playlist.trackIds.length;
  playlist.trackIds = playlist.trackIds.filter(item => item !== value);
  playlist.contributions = playlist.contributions.filter(item => item.trackId !== value);
  if (playlist.trackIds.length === before) return false;
  log(playlist, { type: 'track-removed', trackId: value, ...actor, label: 'Retiré de la playlist' });
  playlist.updatedAt = new Date().toISOString();
  return true;
}

function removeContribution(playlist, trackId, profileId) {
  const value = text(trackId, 300);
  const owner = String(profileId || '');
  const before = playlist.contributions.length;
  playlist.contributions = playlist.contributions.filter(item => !(
    item.trackId === value && item.profileId === owner
  ));
  if (playlist.contributions.length === before) return false;
  const stillCredited = playlist.contributions.some(item => item.trackId === value);
  if (!stillCredited) playlist.trackIds = playlist.trackIds.filter(item => item !== value);
  log(playlist, { type: 'contribution-removed', profileId: owner, trackId: value,
    label: 'Proposition retirée' });
  playlist.updatedAt = new Date().toISOString();
  return true;
}

function reorder(playlist, trackIds) {
  const wanted = Array.isArray(trackIds) ? trackIds.map(value => text(value, 300)) : [];
  if (wanted.length !== playlist.trackIds.length
    || new Set(wanted).size !== playlist.trackIds.length
    || wanted.some(value => !playlist.trackIds.includes(value))) {
    throw new Error('Le nouvel ordre ne correspond pas au contenu de la playlist.');
  }
  playlist.trackIds = wanted;
  log(playlist, { type: 'reordered', label: 'Ordre des morceaux modifié' });
  playlist.updatedAt = new Date().toISOString();
}

function fairOrder(playlist, tracksById = new Map()) {
  const main = playlist.contributions.filter(item => !item.reserve);
  const credited = new Map();
  for (const item of main) {
    if (!playlist.trackIds.includes(item.trackId)) continue;
    const list = credited.get(item.profileId) || [];
    if (!list.includes(item.trackId)) list.push(item.trackId);
    credited.set(item.profileId, list);
  }
  const order = [];
  const lastArtist = () => {
    const track = tracksById.get(order[order.length - 1]);
    return text(track && track.artist, 200).toLocaleLowerCase('fr-FR');
  };
  while ([...credited.values()].some(list => list.length)) {
    for (const list of credited.values()) {
      if (!list.length) continue;
      let index = 0;
      if (playlist.settings.avoidSameArtist && lastArtist()) {
        const alternative = list.findIndex(trackId => {
          const artist = text(tracksById.get(trackId) && tracksById.get(trackId).artist, 200)
            .toLocaleLowerCase('fr-FR');
          return artist && artist !== lastArtist();
        });
        if (alternative >= 0) index = alternative;
      }
      const [next] = list.splice(index, 1);
      if (!order.includes(next)) order.push(next);
    }
  }
  for (const trackId of playlist.trackIds) if (!order.includes(trackId)) order.push(trackId);
  return order;
}

function summary(playlist, tracks = []) {
  const tracksById = new Map(tracks.map(track => [String(track.id), track]));
  const missing = playlist.trackIds.filter(trackId => !tracksById.has(trackId));
  const playable = playlist.trackIds.filter(trackId => tracksById.has(trackId));
  const durationSeconds = playable.reduce((sum, trackId) => (
    sum + Math.max(0, Number(tracksById.get(trackId).duration) || 0)
  ), 0);
  const contributors = new Map();
  for (const item of playlist.contributions) {
    const current = contributors.get(item.profileId) || {
      profileId: item.profileId,
      profileName: item.profileName,
      main: 0,
      reserve: 0,
    };
    if (item.reserve) current.reserve++;
    else current.main++;
    contributors.set(item.profileId, current);
  }
  const estimatedPartyMinutes = Math.max(1, Math.round(playable.length * 1.35));
  const scores = new Map();
  for (const rating of playlist.ratings || []) {
    scores.set(rating.trackId, (scores.get(rating.trackId) || 0) + rating.value);
  }
  const topRated = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([trackId, score]) => ({ trackId, score }));
  return {
    total: playlist.trackIds.length,
    playable: playable.length,
    missing,
    durationSeconds,
    estimatedPartyMinutes,
    contributors: [...contributors.values()],
    ready: playable.length > 0 && missing.length === 0,
    topRated,
  };
}

function normalizedSearch(value) {
  return text(value, 300).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, ' ').trim();
}

function searchLibrary(tracks, query, limit = 12) {
  const needle = normalizedSearch(query);
  if (!needle) return [];
  const words = needle.split(/\s+/).filter(Boolean);
  return tracks.map(track => {
    const title = normalizedSearch(track.title);
    const artist = normalizedSearch(track.artist);
    const haystack = `${title} ${artist}`.trim();
    let score = 0;
    if (title === needle) score += 100;
    if (haystack === needle) score += 120;
    if (title.startsWith(needle)) score += 55;
    if (haystack.includes(needle)) score += 35;
    score += words.filter(word => haystack.includes(word)).length * 12;
    return { track, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.track.title).localeCompare(String(b.track.title), 'fr'))
    .slice(0, Math.min(30, Math.max(1, Number(limit) || 12)))
    .map(item => ({ ...item.track, match: item.score >= 90 ? 'strong' : 'possible', score: item.score }));
}

function proposalLimit(playlist, hasAuthenticatedPlayer) {
  if (!hasAuthenticatedPlayer || !playlist || playlist.status !== 'collecting') return 10;
  return Math.max(10, Number(playlist.quotaPerPlayer) + Number(playlist.reservePerPlayer));
}

function balanceTeams(order, playlist, party) {
  if (!party || !party.settings || !party.settings.teamsMode) return [...order];
  const playerTeams = new Map((party.players || []).map(player => [
    player.profileId, player.teamId || player.profileId,
  ]));
  const trackTeam = new Map();
  for (const contribution of playlist.contributions || []) {
    if (!trackTeam.has(contribution.trackId)) {
      trackTeam.set(contribution.trackId,
        playerTeams.get(contribution.profileId) || contribution.profileId);
    }
  }
  const groups = new Map();
  const unassigned = [];
  for (const trackId of order) {
    const teamId = trackTeam.get(trackId);
    if (!teamId) unassigned.push(trackId);
    else {
      const list = groups.get(teamId) || [];
      list.push(trackId);
      groups.set(teamId, list);
    }
  }
  const result = [];
  while ([...groups.values()].some(list => list.length)) {
    for (const list of groups.values()) if (list.length) result.push(list.shift());
  }
  return [...result, ...unassigned];
}

module.exports = {
  QUOTAS,
  cleanPlaylist,
  cleanSettings,
  contributionCounts,
  addTrack,
  removeTrack,
  removeContribution,
  reorder,
  fairOrder,
  summary,
  searchLibrary,
  rateTrack,
  log,
  proposalLimit,
  balanceTeams,
};
