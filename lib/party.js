'use strict';

const crypto = require('crypto');

const parties = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BUZZER_ANSWER_MS = 10_000;
const BUZZER_PENALTY_MS = 3_000;
const ROUND_START_DELAY_MS = 1_000;
const VOTE_EXTRA_SECONDS = 5;
const REVEAL_SECONDS = 5;

const PALIERS_PRESETS = {
  facile:   [1, 3, 6, 10, 20, 30],
  normal:   [0.2, 0.7, 2.5, 5, 9, 15],
  hardcore: [0.1, 0.3, 0.8, 2, 4, 7],
};

const TEAM_PRESETS = [
  { id: 'team_red', name: 'Les Diables Rouges', color: '#ef4444', emoji: '🔴' },
  { id: 'team_blue', name: 'Les Faucons Bleus', color: '#3b82f6', emoji: '🔵' },
  { id: 'team_green', name: 'Les Vipères Vertes', color: '#10b981', emoji: '🟢' },
  { id: 'team_yellow', name: 'Les Éclairs Dorés', color: '#f59e0b', emoji: '🟡' },
  { id: 'team_purple', name: 'Les Ombres Violettes', color: '#8b5cf6', emoji: '🟣' },
  { id: 'team_orange', name: 'Les Tigres Orange', color: '#f97316', emoji: '🟠' },
  { id: 'team_pink', name: 'Les Flamants Roses', color: '#ec4899', emoji: '💖' },
  { id: 'team_cyan', name: 'Les Sirènes Cyan', color: '#06b6d4', emoji: '🩵' },
  { id: 'team_gold', name: 'L’Ordre d’Or', color: '#eab308', emoji: '🪙' },
  { id: 'team_silver', name: 'Les Loups d’Argent', color: '#94a3b8', emoji: '⚪' },
  { id: 'team_forest', name: 'Les Gardiens de la Forêt', color: '#15803d', emoji: '🌲' },
  { id: 'team_ocean', name: 'Les Abysses', color: '#0284c7', emoji: '🌊' },
  { id: 'team_magma', name: 'Le Volcan', color: '#dc2626', emoji: '🌋' },
  { id: 'team_galaxy', name: 'La Nébuleuse', color: '#6366f1', emoji: '🌌' },
  { id: 'team_lightning', name: 'Les Foudroyants', color: '#818cf8', emoji: '⚡' },
  { id: 'team_retro', name: 'Les Rétro 80s', color: '#d946ef', emoji: '🕹️' },
];
const TEAM_COLOR_FALLBACK = '#8b5cf6';
const TEAM_COLOR_PRESETS = new Set(TEAM_PRESETS.map(p => p.color.toLowerCase()));

const MYSTERY_MODIFIERS = [
  { id: 'mirror', name: '🔄 Manche Miroir', desc: 'Le morceau est joué à l’envers !', speed: 1, direction: 'inverse', multiplier: 1.5 },
  { id: 'turbo', name: '⚡ Manche Turbo', desc: 'Vitesse accélérée à ×1.35 !', speed: 1.35, direction: 'normal', multiplier: 1.25 },
  { id: 'slow', name: '🐢 Manche Basses Lourdes', desc: 'Vitesse ralentie à ×0.85.', speed: 0.85, direction: 'normal', multiplier: 1.25 },
  { id: 'jackpot', name: '💰 Double Jackpot', desc: 'Points doublés (×2) pour cette manche !', speed: 1, direction: 'normal', multiplier: 2.0 },
  { id: 'clutch_only', name: '🎯 Mort Subite', desc: 'Un seul extrait de 1,5s — aucune deuxième chance !', singleAttempt: true, multiplier: 2.5 },
  { id: 'hard_penalty', name: '💣 Champ de Mines', desc: 'Mauvaise réponse = −200 pts de pénalité !', penaltyHeavy: 200, multiplier: 1.5 },
  { id: 'ghost_jump', name: '👻 Intro Fantôme', desc: 'L’extrait démarre 12 secondes plus loin !', offsetBoost: 12, multiplier: 1.5 },
  { id: 'fast_clock', name: '⏳ Chrono Express', desc: 'Rythme effréné, trouve avant les autres !', speed: 1.15, direction: 'normal', multiplier: 1.3 },
];

const PARTY_AUDIO_FX = ['none', '8bit', 'radio', 'underwater', 'nightcore', 'slowed', 'bass'];

function audioFxSpeedMultiplier(fx) {
  return String(fx || 'none') === 'nightcore' ? 1.25 : 1;
}

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

function sanitizeTeamColor(value, fallback = TEAM_COLOR_FALLBACK) {
  const color = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (TEAM_COLOR_PRESETS.has(color)) return color;
  return fallback;
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
  const infinite = totalRounds === 'infinite' || totalRounds === 0 || totalRounds === '0';
  const party = {
    code: code(),
    hostToken: token(),
    inviteToken: token(),
    mode: ['classic', 'buzzer', 'royale', 'duel'].includes(mode) ? mode : 'classic',
    infinite,
    totalRounds: infinite ? null : Math.min(100, Math.max(1, Number(totalRounds) || 10)),
    seed: String(seed || '').slice(0, 40),
    settings: normalizePartySettings(settings),
    status: 'lobby',
    duelScore: 0,
    round: 0,
    currentStep: 0,
    currentTrackId: null,
    roundStartedAt: null,
    playback: null,
    answerSpec: null,
    revealedTrack: null,
    players: [],
    teams: [],
    reactions: [],
    nextReactionId: 1,
    roundModifier: null,
    buzzOrder: [],
    activeBuzzerProfileId: null,
    buzzerDeadline: null,
    buzzerSolvedByProfileId: null,
    firstFoundThisRound: false,
    skipVotes: [],
    moreTimeVotes: [],
    moreTimeGranted: false,
    roundDecision: null,
    autoNextAt: null,
    revealReason: null,
    chatMessages: [],
    nextChatId: 1,
    statsCommitted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  parties.set(party.code, party);
  return { party, hostToken: party.hostToken };
}

function cleanPartySettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const difficulty = ['facile', 'normal', 'hardcore'].includes(source.difficulty)
    ? source.difficulty : 'normal';
  const paliers = Array.isArray(source.paliers) && source.paliers.length === 6
    ? source.paliers.map(Number)
    : (PALIERS_PRESETS[difficulty] || PALIERS_PRESETS.normal);
  return {
    answer: ['titre', 'artiste', 'annee'].includes(source.answer) ? source.answer : 'titre',
    speed: [0.75, 1, 1.25, 1.5].includes(Number(source.speed)) ? Number(source.speed) : 1,
    direction: source.direction === 'inverse' ? 'inverse' : 'normal',
    start: ['seed', 'refrain', 'debut'].includes(source.start) ? source.start : 'seed',
    difficulty,
    paliers,
    audioFx: PARTY_AUDIO_FX.includes(String(source.audioFx)) ? String(source.audioFx) : 'none',
    victory: ['immediate', 'all_steps'].includes(source.victory) ? source.victory : 'all_steps',
    excerpt: Math.min(60, Math.max(1, Number(source.excerpt) || paliers[paliers.length - 1] || 15)),
    points: Math.min(5000, Math.max(100, Math.round(Number(source.points) || 1000))),
    mystery: Boolean(source.mystery),
    teamsMode: Boolean(source.teamsMode),
  };
}

function normalizePartySettings(input) {
  return cleanPartySettings(input);
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
    lives: 3,
    isGhost: false,
    teamId: null,
    teamLockedByHost: false,
    sessionRounds: party.status === 'round' ? 1 : 0,
    sessionAnswers: 0,
    sessionCorrect: 0,
    globalStats: profile.multiplayer && typeof profile.multiplayer === 'object'
      ? { ...profile.multiplayer } : {},
    currentAttempt: 0,
    attempts: [],
    found: false,
    finished: false,
    earnedPoints: 0,
    lightningWins: 0,
    clutchWins: 0,
    totalGuesses: 0,
    firstCorrectCount: 0,
    answer: null,
    lastAnswer: null,
    correct: null,
    buzzedAt: null,
    wrongAttempts: 0,
    buzzerBlockedUntil: null,
    roundPenaltyPoints: 0,
    lastPenaltyPoints: 0,
    lastChatAt: 0,
    lastReactionAt: 0,
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

function resetBuzzer(party) {
  party.buzzOrder = [];
  party.activeBuzzerProfileId = null;
  party.buzzerDeadline = null;
  party.buzzerSolvedByProfileId = null;
}

function resetRoundVotes(party) {
  party.skipVotes = [];
  party.moreTimeVotes = [];
  party.moreTimeGranted = false;
  party.roundDecision = null;
}

function voteThreshold(party) {
  const connected = party.players.filter(p => p.connected).length;
  return Math.max(1, Math.ceil(connected / 2));
}

function toggleVote(list, profileId) {
  const index = list.indexOf(profileId);
  if (index >= 0) list.splice(index, 1);
  else list.push(profileId);
}

function registerWrongBuzzer(party, player, now = Date.now()) {
  player.wrongAttempts++;
  player.roundPenaltyPoints += 100;
  player.lastPenaltyPoints = 100;
  player.score = Math.max(0, player.score - 100);
  player.buzzerBlockedUntil = now + BUZZER_PENALTY_MS;
  party.buzzOrder = party.buzzOrder.filter(id => id !== player.profileId);
}

function pausePlayback(party, now = Date.now()) {
  if (!party.playback || party.playback.pausedAt) return;
  party.playback.pausedAt = now;
}

function resumePlayback(party, now = Date.now()) {
  if (!party.playback || !party.playback.pausedAt) return;
  party.playback.startedAt += Math.max(0, now - party.playback.pausedAt);
  party.playback.pausedAt = null;
}

function refreshBuzzer(party, now = Date.now()) {
  if (party.mode !== 'buzzer') return;
  if (party.buzzerDeadline && party.buzzerDeadline <= now) {
    const player = party.players.find(p => p.profileId === party.activeBuzzerProfileId);
    if (party.activeBuzzerProfileId && player && player.answer === null) {
      player.lastAnswer = 'Temps écoulé';
      player.correct = false;
      player.sessionAnswers++;
      registerWrongBuzzer(party, player, now);
      player.updatedAt = now;
    }
    party.activeBuzzerProfileId = null;
    party.buzzerDeadline = null;
    resumePlayback(party, now);
    party.updatedAt = now;
  }
}

function command(party, hostToken, action, data = {}) {
  if (!isHost(party, hostToken)) throw new Error('Commande réservée à l’hôte.');
  if (action === 'start-round') {
    party.status = 'round';
    const nextRound = Math.max(1, Math.floor(Number(data.round) || party.round + 1));
    party.round = party.infinite
      ? Math.min(Number.MAX_SAFE_INTEGER, nextRound)
      : Math.min(party.totalRounds, nextRound);
    party.currentTrackId = String(data.trackId || '');
    const now = Date.now();
    const requestedOffset = Number(data.playback && data.playback.offset);
    const paliers = Array.isArray(party.settings.paliers) ? party.settings.paliers : PALIERS_PRESETS.normal;
    const initialDuration = party.mode === 'buzzer' ? party.settings.excerpt : paliers[0];
    const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + initialDuration * 0.15));

    if (party.settings.mystery) {
      party.roundModifier = MYSTERY_MODIFIERS[crypto.randomInt(MYSTERY_MODIFIERS.length)];
    } else {
      party.roundModifier = null;
    }

    const baseSpeed = Number((party.roundModifier && party.roundModifier.speed) || party.settings.speed) || 1;
    const effSpeed = baseSpeed * audioFxSpeedMultiplier(party.settings.audioFx);
    const effDir = (party.roundModifier && party.roundModifier.direction) || party.settings.direction;
    const boost = (party.roundModifier && party.roundModifier.offsetBoost) || 0;

    party.currentStep = 0;
    party.playback = {
      startedAt: now + ROUND_START_DELAY_MS,
      offset: Number.isFinite(requestedOffset)
        ? Math.min(24 * 60 * 60, Math.max(0, requestedOffset + boost)) : boost,
      duration: initialDuration,
      step: 0,
      loopDelay,
      speed: effSpeed,
      direction: effDir,
      pausedAt: null,
    };
    party.roundStartedAt = party.playback.startedAt;
    party.answerSpec = cleanAnswerSpec(data.answer);
    party.revealedTrack = null;
    party.autoNextAt = null;
    party.revealReason = null;
    party.firstFoundThisRound = false;
    resetBuzzer(party);
    resetRoundVotes(party);
    for (const p of party.players) {
      p.sessionRounds++;
      p.currentAttempt = 0;
      p.attempts = [];
      p.found = false;
      p.finished = false;
      p.earnedPoints = 0;
      p.answer = null;
      p.lastAnswer = null;
      p.correct = null;
      p.buzzedAt = null;
      p.wrongAttempts = 0;
      p.buzzerBlockedUntil = null;
      p.roundPenaltyPoints = 0;
      p.lastPenaltyPoints = 0;
    }
  } else if (action === 'reveal') {
    const now = Date.now();
    party.status = 'reveal';
    party.activeBuzzerProfileId = null;
    party.buzzerDeadline = null;
    const highlightOffset = Number(data.highlightOffset);
    const highlightDuration = Math.min(10, Math.max(1,
      Number(data.highlightDuration) || REVEAL_SECONDS));
    party.playback = Number.isFinite(highlightOffset) ? {
      startedAt: now + 250,
      offset: Math.min(24 * 60 * 60, Math.max(0, highlightOffset)),
      duration: highlightDuration,
      speed: 1,
      direction: 'normal',
      pausedAt: null,
      reveal: true,
    } : null;
    party.revealedTrack = data.track && typeof data.track === 'object' ? {
      title: String(data.track.title || '').slice(0, 200),
      originalTitle: String(data.track.originalTitle || '').slice(0, 200),
      artist: String(data.track.artist || '').slice(0, 200),
      genre: String(data.track.genre || '').slice(0, 80),
    } : party.answerSpec ? {
      title: party.answerSpec.title,
      originalTitle: party.answerSpec.originalTitle,
      artist: party.answerSpec.artist,
      genre: '',
    } : null;
    party.revealReason = ['correct', 'skip', 'manual'].includes(data.reason)
      ? data.reason : 'manual';
    party.autoNextAt = data.autoNext
      ? (party.playback
        ? party.playback.startedAt + highlightDuration * 1000
        : now + REVEAL_SECONDS * 1000)
      : null;

    if (party.mode === 'royale') {
      for (const p of party.players) {
        if (!p.isGhost) {
          if (!p.found) {
            p.lives = Math.max(0, (p.lives !== undefined ? p.lives : 3) - 1);
            if (p.lives === 0) p.isGhost = true;
          }
        }
      }
    } else if (party.mode === 'duel') {
      const teams = party.teams || [];
      if (teams.length >= 2) {
        const score0 = party.players.filter(p => p.teamId === teams[0].id).reduce((sum, p) => sum + (p.earnedPoints || 0), 0);
        const score1 = party.players.filter(p => p.teamId === teams[1].id).reduce((sum, p) => sum + (p.earnedPoints || 0), 0);
        const delta = score0 - score1;
        party.duelScore = Math.min(100, Math.max(-100, (party.duelScore || 0) + (delta > 0 ? -25 : delta < 0 ? 25 : 0)));
      } else if (party.players.length >= 2) {
        const p0 = party.players[0];
        const p1 = party.players[1];
        const delta = (p0.earnedPoints || 0) - (p1.earnedPoints || 0);
        party.duelScore = Math.min(100, Math.max(-100, (party.duelScore || 0) + (delta > 0 ? -25 : delta < 0 ? 25 : 0)));
      }
    }
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
    party.playback = null;
    party.autoNextAt = null;
    party.revealReason = null;
    resetBuzzer(party);
    resetRoundVotes(party);
  } else if (action === 'lobby') {
    party.status = 'lobby';
    party.currentTrackId = null;
    party.answerSpec = null;
    party.playback = null;
    party.autoNextAt = null;
    party.revealReason = null;
    resetBuzzer(party);
    resetRoundVotes(party);
  } else if (action === 'host-create-team') {
    if (!party.teams) party.teams = [];
    if (party.teams.length >= 16) throw new Error('Limite de 16 équipes atteinte.');
    const preset = TEAM_PRESETS.find(p => p.id === data.presetId) || TEAM_PRESETS[party.teams.length % TEAM_PRESETS.length];
    const teamId = `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const team = {
      id: teamId,
      name: String(data.name || preset.name).slice(0, 30),
      color: sanitizeTeamColor(data.color || preset.color),
      emoji: String(data.emoji || preset.emoji).slice(0, 4),
      captainProfileId: data.captainProfileId ? String(data.captainProfileId) : null,
      lockedByHost: Boolean(data.locked),
      joinRequests: [],
      invites: [],
    };
    party.teams.push(team);
    if (team.captainProfileId) {
      const cap = party.players.find(p => p.profileId === team.captainProfileId);
      if (cap) {
        cap.teamId = team.id;
        cap.teamLockedByHost = true;
      }
    }
  } else if (action === 'host-update-team') {
    const team = (party.teams || []).find(t => t.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    if (data.name) team.name = String(data.name).slice(0, 30);
    if (data.color) team.color = sanitizeTeamColor(data.color, team.color);
    if (data.emoji) team.emoji = String(data.emoji).slice(0, 4);
    if (data.captainProfileId !== undefined) {
      team.captainProfileId = data.captainProfileId ? String(data.captainProfileId) : null;
      if (team.captainProfileId) {
        const cap = party.players.find(p => p.profileId === team.captainProfileId);
        if (cap) {
          cap.teamId = team.id;
          cap.teamLockedByHost = true;
        }
      }
    }
  } else if (action === 'host-delete-team') {
    party.teams = (party.teams || []).filter(t => t.id !== data.teamId);
    for (const p of party.players) {
      if (p.teamId === data.teamId) {
        p.teamId = null;
        p.teamLockedByHost = false;
      }
    }
  } else if (action === 'host-assign-player') {
    const player = party.players.find(p => String(p.profileId) === String(data.profileId));
    if (!player) throw new Error('Joueur introuvable.');
    player.teamId = data.teamId ? String(data.teamId) : null;
    player.teamLockedByHost = Boolean(data.locked && data.teamId);

    // Mettre à jour les capitaines
    for (const team of party.teams || []) {
      const members = party.players.filter(p => p.teamId === team.id);
      if (!members.length) {
        team.captainProfileId = null;
      } else if (!team.captainProfileId || !members.some(m => String(m.profileId) === String(team.captainProfileId))) {
        team.captainProfileId = members[0].profileId;
      }
    }
  } else if (action === 'host-randomize-teams') {
    if (!party.players.length) throw new Error('Aucun joueur dans la partie.');
    const count = party.players.length;
    let numTeams = Math.min(16, Math.max(2, Number(data.numTeams) || (party.teams && party.teams.length ? party.teams.length : (count <= 4 ? 2 : count <= 8 ? 3 : 4))));
    if (!party.teams) party.teams = [];
    while (party.teams.length < numTeams && party.teams.length < 16) {
      const idx = party.teams.length;
      const preset = TEAM_PRESETS[idx % TEAM_PRESETS.length];
      party.teams.push({
        id: `team_${Date.now()}_${idx}`,
        name: preset.name,
        color: preset.color,
        emoji: preset.emoji,
        captainProfileId: null,
        lockedByHost: false,
        joinRequests: [],
        invites: [],
      });
    }
    const teamsToUse = party.teams.slice(0, numTeams);
    const eligiblePlayers = party.players.filter(p => !p.teamLockedByHost);
    for (let i = eligiblePlayers.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [eligiblePlayers[i], eligiblePlayers[j]] = [eligiblePlayers[j], eligiblePlayers[i]];
    }
    eligiblePlayers.forEach((p, index) => {
      const assignedTeam = teamsToUse[index % teamsToUse.length];
      p.teamId = assignedTeam.id;
    });
    for (const team of teamsToUse) {
      const members = party.players.filter(p => p.teamId === team.id);
      if (members.length && (!team.captainProfileId || !members.some(m => m.profileId === team.captainProfileId))) {
        team.captainProfileId = members[0].profileId;
      }
    }
  } else {
    throw new Error('Commande de partie inconnue.');
  }
  party.updatedAt = Date.now();
  return party;
}

function playerAction(party, playerToken, action, data = {}) {
  refreshBuzzer(party);
  const player = findPlayer(party, playerToken);
  if (!player) throw new Error('Joueur inconnu dans cette partie.');

  if (action === 'reaction') {
    const validEmojis = ['🔥', '👏', '😂', '💀', '😱', '🎉', '⚡', '❤️', '🏆', '🍕'];
    const emoji = String(data.emoji || '').slice(0, 4);
    if (!validEmojis.includes(emoji)) throw new Error('Emoji non reconnu.');
    const now = Date.now();
    if (now - Number(player.lastReactionAt || 0) < 600) {
      throw new Error('Patiente un instant avant de réagir à nouveau.');
    }
    player.lastReactionAt = now;
    if (!party.reactions) party.reactions = [];
    party.reactions.push({
      id: party.nextReactionId++,
      profileId: player.profileId,
      nom: player.nom,
      emoji,
      createdAt: now,
    });
    if (party.reactions.length > 30) party.reactions.splice(0, party.reactions.length - 30);
    party.updatedAt = now;
    return party;
  }

  if (action === 'create-team') {
    if (party.status === 'finished') throw new Error('Partie terminée.');
    if (!party.teams) party.teams = [];
    if (party.teams.length >= 16) throw new Error('Nombre maximal de 16 équipes atteint.');
    const preset = TEAM_PRESETS[party.teams.length % TEAM_PRESETS.length];
    const teamId = `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newTeam = {
      id: teamId,
      name: String(data.name || preset.name).slice(0, 30),
      color: sanitizeTeamColor(data.color || preset.color),
      emoji: String(data.emoji || preset.emoji).slice(0, 4),
      captainProfileId: player.profileId,
      lockedByHost: false,
      joinRequests: [],
      invites: [],
    };
    party.teams.push(newTeam);
    player.teamId = teamId;
    player.teamLockedByHost = false;
    party.updatedAt = Date.now();
    return party;
  }

  if (action === 'request-join-team') {
    const team = (party.teams || []).find(t => t.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    if (!team.joinRequests) team.joinRequests = [];
    if (!team.joinRequests.includes(player.profileId)) team.joinRequests.push(player.profileId);
    party.updatedAt = Date.now();
    return party;
  }

  if (action === 'accept-team-request') {
    const team = (party.teams || []).find(t => t.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    if (team.captainProfileId !== player.profileId && !player.host) {
      throw new Error('Seul le capitaine de l’équipe peut accepter des joueurs.');
    }
    const target = party.players.find(p => p.profileId === data.profileId);
    if (target) {
      target.teamId = team.id;
      team.joinRequests = (team.joinRequests || []).filter(id => id !== target.profileId);
    }
    party.updatedAt = Date.now();
    return party;
  }

  if (action === 'refuse-team-request') {
    const team = (party.teams || []).find(t => t.id === data.teamId);
    if (team) team.joinRequests = (team.joinRequests || []).filter(id => id !== data.profileId);
    party.updatedAt = Date.now();
    return party;
  }

  if (action === 'kick-team-member') {
    const team = (party.teams || []).find(t => t.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    if (team.captainProfileId !== player.profileId && !player.host) {
      throw new Error('Seul le capitaine ou l’hôte peut exclure un membre.');
    }
    const target = party.players.find(p => p.profileId === data.profileId);
    if (target) {
      if (target.teamLockedByHost && !player.host) {
        throw new Error('Ce joueur a été assigné par l’hôte et ne peut être exclu par le capitaine.');
      }
      target.teamId = null;
      target.teamLockedByHost = false;
    }
    party.updatedAt = Date.now();
    return party;
  }

  if (action === 'leave-team') {
    if (player.teamLockedByHost) throw new Error('Tu as été assigné par l’hôte et ne peux pas quitter cette équipe.');
    const team = (party.teams || []).find(t => t.id === player.teamId);
    player.teamId = null;
    if (team && team.captainProfileId === player.profileId) {
      const otherMembers = party.players.filter(p => p.teamId === team.id && p.profileId !== player.profileId);
      if (otherMembers.length) {
        team.captainProfileId = otherMembers[0].profileId;
      } else {
        party.teams = party.teams.filter(t => t.id !== team.id);
      }
    }
    party.updatedAt = Date.now();
    return party;
  }

  if (action === 'chat') {
    if (party.status === 'finished') throw new Error('Cette partie est terminée.');
    const now = Date.now();
    const message = String(data.message || '').trim().replace(/\s+/g, ' ').slice(0, 240);
    if (!message) throw new Error('Écris un message.');
    if (now - Number(player.lastChatAt || 0) < 700) {
      throw new Error('Attends un instant avant de renvoyer un message.');
    }
    player.lastChatAt = now;
    party.chatMessages.push({
      id: party.nextChatId++,
      profileId: player.profileId,
      message,
      createdAt: now,
    });
    if (party.chatMessages.length > 80) party.chatMessages.splice(0, party.chatMessages.length - 80);
    party.updatedAt = now;
    return party;
  }
  if (party.status !== 'round') throw new Error('Aucune manche n’est ouverte.');
  if (party.roundStartedAt && Date.now() < party.roundStartedAt) {
    throw new Error('La musique va démarrer : attends le top !');
  }
  if (action === 'skip') {
    if (party.mode !== 'classic') throw new Error('Le bouton Passer n’est actif qu’en réponses simultanées.');
    if (player.finished || player.found) throw new Error('Manche déjà terminée pour toi.');
    const paliers = party.settings.paliers || PALIERS_PRESETS.normal;
    player.attempts.push({ type: 'skipped', step: player.currentAttempt, text: 'Passé ↷' });
    if (player.currentAttempt < paliers.length - 1) {
      player.currentAttempt++;
      const maxUnlocked = Math.max(...party.players.map(p => p.currentAttempt));
      if (maxUnlocked > party.currentStep) {
        party.currentStep = maxUnlocked;
        party.playback.duration = paliers[maxUnlocked];
        party.playback.step = maxUnlocked;
        party.playback.loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + party.playback.duration * 0.15));
      }
    } else {
      player.finished = true;
      player.lastAnswer = 'Passé (dernier extrait)';
    }
    if (party.players.every(p => p.finished || p.found)) {
      party.roundDecision = 'all_finished';
    }
  } else if (action === 'vote-skip') {
    toggleVote(party.skipVotes, player.profileId);
    if (player.host || party.skipVotes.length >= voteThreshold(party)) {
      party.roundDecision = 'skip';
    }
  } else if (action === 'vote-more') {
    if (party.moreTimeGranted) throw new Error('Les 5 secondes bonus ont déjà été ajoutées.');
    toggleVote(party.moreTimeVotes, player.profileId);
    if (player.host || party.moreTimeVotes.length >= voteThreshold(party)) {
      party.moreTimeGranted = true;
      const previousDuration = Number(party.playback.duration) || 0;
      const speed = Number(party.playback.speed) || 1;
      const clockNow = party.playback.pausedAt || Date.now();
      const elapsed = Math.max(0,
        (clockNow - Number(party.playback.startedAt)) / 1000 * speed);
      if (elapsed > previousDuration) {
        party.playback.startedAt += (elapsed - previousDuration) / speed * 1000;
      }
      party.playback.duration = Math.min(120,
        previousDuration + VOTE_EXTRA_SECONDS);
      party.playback.loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + party.playback.duration * 0.15));
    }
  } else if (action === 'answer') {
    if (player.finished || player.found) throw new Error('Réponse déjà envoyée ou essais terminés pour cette manche.');
    if (party.mode === 'buzzer' && party.activeBuzzerProfileId !== player.profileId) {
      throw new Error('Ce n’est pas à toi de répondre au buzzer.');
    }
    const guess = String(data.answer || '').trim().slice(0, 200);
    if (!guess) throw new Error('Écris une réponse.');
    player.sessionAnswers++;
    player.totalGuesses = (player.totalGuesses || 0) + 1;
    const correct = answerIsCorrect(guess, party.answerSpec);

    if (party.mode === 'buzzer') {
      player.answer = guess;
      player.correct = correct;
      if (player.correct) {
        player.sessionCorrect++;
        if (!party.firstFoundThisRound) {
          party.firstFoundThisRound = true;
          player.firstCorrectCount = (player.firstCorrectCount || 0) + 1;
        }
        const mult = (party.roundModifier && party.roundModifier.multiplier) || 1.0;
        const pts = Math.round(party.settings.points * mult);
        player.score += pts;
        party.activeBuzzerProfileId = null;
        party.buzzerSolvedByProfileId = player.profileId;
      } else {
        party.activeBuzzerProfileId = null;
        party.buzzerDeadline = null;
        player.lastAnswer = player.answer;
        player.answer = null;
        registerWrongBuzzer(party, player);
        resumePlayback(party);
      }
    } else {
      const paliers = party.settings.paliers || PALIERS_PRESETS.normal;
      if (correct) {
        player.found = true;
        player.finished = true;
        player.correct = true;
        player.sessionCorrect++;
        if (player.currentAttempt === 0) player.lightningWins = (player.lightningWins || 0) + 1;
        if (player.currentAttempt === paliers.length - 1) player.clutchWins = (player.clutchWins || 0) + 1;
        if (!party.firstFoundThisRound) {
          party.firstFoundThisRound = true;
          player.firstCorrectCount = (player.firstCorrectCount || 0) + 1;
        }
        player.answer = guess;
        player.attempts.push({ type: 'success', step: player.currentAttempt, text: guess });
        const stepRatios = [1, 0.8, 0.6, 0.4, 0.25, 0.15];
        const ratio = stepRatios[player.currentAttempt] !== undefined ? stepRatios[player.currentAttempt] : 0.15;
        const baseEarned = Math.round(party.settings.points * ratio);
        const elapsed = Math.max(0, Date.now() - (party.roundStartedAt || Date.now()));
        const speedBonus = Math.max(0, Math.round(baseEarned * 0.15 * Math.pow(0.5, elapsed / 8000)));
        const mult = (party.roundModifier && party.roundModifier.multiplier) || 1.0;
        const earned = Math.round(Math.max(50, baseEarned + speedBonus) * mult);
        player.earnedPoints = earned;
        player.score += earned;

        if (party.settings.victory === 'immediate') {
          party.roundDecision = 'solved';
        } else {
          if (party.players.every(p => p.finished || p.found)) {
            party.roundDecision = 'all_finished';
          }
        }
      } else {
        player.wrongAttempts++;
        player.attempts.push({ type: 'failed', step: player.currentAttempt, text: guess });
        player.lastAnswer = guess;
        const extraPenalty = (party.roundModifier && party.roundModifier.penaltyHeavy) || 0;
        if (extraPenalty) {
          player.score = Math.max(0, player.score - extraPenalty);
          player.roundPenaltyPoints = (player.roundPenaltyPoints || 0) + extraPenalty;
        }
        const singleAttempt = Boolean(party.roundModifier && party.roundModifier.singleAttempt);

        if (!singleAttempt && player.currentAttempt < paliers.length - 1) {
          player.currentAttempt++;
          const maxUnlocked = Math.max(...party.players.map(p => p.currentAttempt));
          if (maxUnlocked > party.currentStep) {
            party.currentStep = maxUnlocked;
            party.playback.duration = paliers[maxUnlocked];
            party.playback.step = maxUnlocked;
            party.playback.loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + party.playback.duration * 0.15));
          }
        } else {
          player.finished = true;
          player.correct = false;
        }
        if (party.players.every(p => p.finished || p.found)) {
          party.roundDecision = 'all_finished';
        }
      }
    }
    player.updatedAt = Date.now();
  } else if (action === 'buzz') {
    if (party.mode !== 'buzzer') throw new Error('Le buzzer n’est pas actif dans ce mode.');
    if (party.buzzerSolvedByProfileId) throw new Error('La bonne réponse a déjà été trouvée.');
    if (player.answer !== null) throw new Error('Tu as déjà tenté une réponse pour cette manche.');
    if (party.activeBuzzerProfileId) throw new Error('Un joueur répond déjà.');
    const now = Date.now();
    if (player.buzzerBlockedUntil && player.buzzerBlockedUntil > now) {
      const seconds = Math.ceil((player.buzzerBlockedUntil - now) / 1000);
      throw new Error(`Ta pénalité est encore active pendant ${seconds} s.`);
    }
    player.buzzedAt = now;
    party.buzzOrder.push(player.profileId);
    party.activeBuzzerProfileId = player.profileId;
    party.buzzerDeadline = now + BUZZER_ANSWER_MS;
    pausePlayback(party, now);
  } else {
    throw new Error('Action de joueur inconnue.');
  }
  party.updatedAt = Date.now();
  return party;
}

function publicState(party, playerToken, hostToken) {
  refreshBuzzer(party);
  const viewer = findPlayer(party, playerToken);
  const host = isHost(party, hostToken);
  const now = Date.now();
  const normalizedSettings = normalizePartySettings(party.settings);

  const teams = (party.teams || []).map(team => {
    const members = party.players.filter(p => p.teamId === team.id);
    const score = members.reduce((sum, p) => sum + (Number(p.score) || 0), 0);
    const captain = party.players.find(p => p.profileId === team.captainProfileId);
    return {
      id: team.id,
      name: team.name,
      color: sanitizeTeamColor(team.color, TEAM_COLOR_FALLBACK),
      emoji: team.emoji,
      captainProfileId: team.captainProfileId,
      captainNom: captain ? captain.nom : 'Capitaine',
      lockedByHost: Boolean(team.lockedByHost),
      membersCount: members.length,
      members: members.map(m => ({
        profileId: m.profileId,
        nom: m.nom,
        emoji: m.emoji,
        score: m.score,
        host: m.host,
        locked: Boolean(m.teamLockedByHost),
      })),
      joinRequests: (team.joinRequests || []).map(pid => {
        const p = party.players.find(pl => pl.profileId === pid);
        return { profileId: pid, nom: p ? p.nom : 'Joueur', emoji: p ? p.emoji : '🎧' };
      }),
      score,
    };
  }).sort((a, b) => b.score - a.score);

  return {
    serverNow: now,
    code: party.code,
    mode: party.mode,
    infinite: party.infinite,
    totalRounds: party.totalRounds,
    seed: party.seed,
    settings: normalizePartySettings(party.settings),
    status: party.status,
    round: party.round,
    currentStep: party.currentStep || 0,
    paliers: normalizedSettings.paliers,
    victory: normalizedSettings.victory || 'all_steps',
    playback: party.playback ? { ...party.playback } : null,
    roundModifier: party.roundModifier || null,
    autoNextAt: party.autoNextAt,
    revealReason: party.revealReason,
    teams,
    teamPresets: TEAM_PRESETS,
    reactions: (party.reactions || []).slice(-30),
    chat: (party.chatMessages || []).slice(-50).map(message => {
      const author = party.players.find(p => p.profileId === message.profileId);
      return {
        id: message.id,
        profileId: message.profileId,
        nom: author ? author.nom : 'Joueur',
        emoji: author ? author.emoji : '🎧',
        message: message.message,
        createdAt: message.createdAt,
      };
    }),
    roundDecision: party.roundDecision,
    votes: {
      threshold: voteThreshold(party),
      skip: {
        count: party.skipVotes.length,
        voted: Boolean(viewer && party.skipVotes.includes(viewer.profileId)),
        passed: party.roundDecision === 'skip',
      },
      more: {
        count: party.moreTimeVotes.length,
        voted: Boolean(viewer && party.moreTimeVotes.includes(viewer.profileId)),
        granted: party.moreTimeGranted,
        seconds: VOTE_EXTRA_SECONDS,
      },
    },
    buzzer: {
      activeProfileId: party.activeBuzzerProfileId,
      answerSecondsRemaining: party.buzzerDeadline
        ? Math.max(0, Math.ceil((party.buzzerDeadline - now) / 1000)) : 0,
      solvedByProfileId: party.buzzerSolvedByProfileId,
    },
    currentTrackId: host ? party.currentTrackId : null,
    revealedTrack: party.revealedTrack,
    isHost: host,
    viewerProfileId: viewer ? viewer.profileId : null,
    duelScore: party.duelScore || 0,
    players: party.players.map(p => ({
      profileId: p.profileId,
      nom: p.nom,
      emoji: p.emoji,
      host: p.host,
      teamId: p.teamId || null,
      teamLockedByHost: Boolean(p.teamLockedByHost),
      score: p.score,
      lives: p.lives !== undefined ? p.lives : 3,
      isGhost: Boolean(p.isGhost),
      session: {
        rounds: p.sessionRounds,
        answers: p.sessionAnswers,
        correct: p.sessionCorrect,
      },
      globalStats: p.globalStats || {},
      currentAttempt: p.currentAttempt || 0,
      attempts: Array.isArray(p.attempts) ? p.attempts : [],
      found: Boolean(p.found),
      finished: Boolean(p.finished),
      earnedPoints: Number(p.earnedPoints) || 0,
      answer: host || p === viewer || party.status !== 'round'
        ? p.answer
        : (p.found ? 'Trouvé !' : (p.finished ? 'Essais terminés' : (p.attempts && p.attempts.length ? `${p.attempts.length} essai${p.attempts.length > 1 ? 's' : ''}` : null))),
      lastAnswer: host || p === viewer || party.status !== 'round'
        ? p.lastAnswer : (p.lastAnswer ? 'Tentative envoyée' : null),
      correct: host || p === viewer || party.status !== 'round' ? p.correct : null,
      buzzPosition: party.buzzOrder.indexOf(p.profileId) + 1 || null,
      wrongAttempts: p.wrongAttempts || 0,
      roundPenaltyPoints: p.roundPenaltyPoints || 0,
      lastPenaltyPoints: p.lastPenaltyPoints || 0,
      buzzerBlockedSeconds: p.buzzerBlockedUntil
        ? Math.max(0, Math.ceil((p.buzzerBlockedUntil - now) / 1000)) : 0,
      accolades: {
        lightningWins: Number(p.lightningWins) || 0,
        clutchWins: Number(p.clutchWins) || 0,
        totalGuesses: Number(p.totalGuesses) || 0,
        firstCorrectCount: Number(p.firstCorrectCount) || 0,
      },
    })),
  };
}

module.exports = {
  create, get, join, isInvited, findPlayer, command, playerAction, publicState, TEAM_PRESETS, MYSTERY_MODIFIERS,
};
