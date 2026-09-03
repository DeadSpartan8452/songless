'use strict';

const crypto = require('crypto');
const modeRegistry = require('./mode-registry');
const {
  accessRole,
  issueAccessToken,
  purgeAccessTokens,
  revokeAccessToken,
} = require('./party-access');
const { answerIsCorrect, cleanAnswerSpec } = require('./party-answers');
const auction = require('./party-auction');
const buzzer = require('./party-buzzer');
const confidence = require('./party-confidence');
const cooperation = require('./party-cooperation');
const intruder = require('./party-intruder');
const joker = require('./party-joker');
const missions = require('./party-missions');
const handicap = require('./party-handicap');
const titles = require('./party-titles');
const duel = require('./party-duel');
const easterEggs = require('./party-easter-eggs');
const royale = require('./party-royale');
const teams = require('./party-teams');

const parties = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROUND_START_DELAY_MS = 1_000;
const VOTE_EXTRA_SECONDS = 5;
const REVEAL_SECONDS = 5;

const PALIERS_PRESETS = {
  facile:   [1, 3, 6, 10, 20, 30],
  normal:   [0.2, 0.7, 2.5, 5, 9, 15],
  hardcore: [0.1, 0.3, 0.8, 2, 4, 7],
};

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

function mysteryModifiersForMode(mode) {
  if (!modeRegistry.hasCapability(mode, 'mystery')) return [];
  if (mode === 'auction') {
    return MYSTERY_MODIFIERS.filter(modifier => modifier.id !== 'clutch_only');
  }
  return [...MYSTERY_MODIFIERS];
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

function create({ mode = 'classic', totalRounds = 10, seed = '', settings = {}, trackIds = [] }) {
  cleanup();
  const infinite = totalRounds === 'infinite' || totalRounds === 0 || totalRounds === '0';
  const normalizedMode = modeRegistry.normalizeModeId(mode);
  const party = {
    code: code(),
    hostToken: token(),
    inviteToken: token(),
    accessTokens: [],
    mode: normalizedMode,
    infinite,
    totalRounds: infinite ? null : Math.min(100, Math.max(1, Number(totalRounds) || 10)),
    seed: String(seed || '').slice(0, 40),
    settings: normalizePartySettings(settings, normalizedMode),
    status: 'lobby',
    duelScore: 0,
    round: 0,
    currentStep: 0,
    currentTrackId: null,
    trackIds: Array.isArray(trackIds)
      ? [...new Set(trackIds.map(value => String(value || '')).filter(Boolean))].slice(0, 5000)
      : [],
    roundStartedAt: null,
    playback: null,
    answerSpec: null,
    intruderChallenge: null,
    auction: null,
    easterEgg: null,
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
    finalDuel: null,
    finishReason: null,
    winnerProfileId: null,
    royalePeakSurvivors: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  parties.set(party.code, party);
  return { party, hostToken: party.hostToken };
}

function cleanPartySettings(input, mode = 'classic') {
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
    mystery: modeRegistry.hasCapability(mode, 'mystery') && Boolean(source.mystery),
    teamsMode: Boolean(source.teamsMode),
    smartHandicap: Boolean(source.smartHandicap),
  };
}

function normalizePartySettings(input, mode) {
  return cleanPartySettings(input, mode);
}

function confidencePotential(party, player) {
  const ratios = [1, 0.8, 0.6, 0.4, 0.25, 0.15];
  const ratio = ratios[Number(player.currentAttempt) || 0] || 0.15;
  const base = Math.round(party.settings.points * ratio);
  const speedBonus = Math.round(base * 0.15);
  const multiplier = Number(party.roundModifier && party.roundModifier.multiplier) || 1;
  return Math.round(Math.max(50, base + speedBonus) * multiplier);
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
    confidenceStake: 1,
    confidenceLocked: false,
    confidenceLastDelta: 0,
    confidenceStats: {
      answers: 0,
      correct: 0,
      totalStaked: 0,
      pointsWon: 0,
      pointsLost: 0,
    },
    lastChatAt: 0,
    lastReactionAt: 0,
    connected: true,
    updatedAt: Date.now(),
  };
  party.players.push(player);
  if (party.mode === 'cooperation') cooperation.joinPlayer(party, player);
  if (party.mode === 'joker') joker.joinPlayer(player);
  if (party.mode === 'missions') missions.joinPlayer(party, player);
  royale.notePeakSurvivors(party);
  party.updatedAt = Date.now();
  return player;
}

function get(codeValue) {
  cleanup();
  return parties.get(String(codeValue || '').toUpperCase()) || null;
}

function remove(codeValue) {
  return parties.delete(String(codeValue || '').toUpperCase());
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

function resetRoundVotes(party) {
  party.skipVotes = [];
  party.stepVotes = [];
  party.roundDecision = null;
}

function finishParty(party, reason = 'host', winnerProfileId = null) {
  if (party.mode === 'cooperation') cooperation.finish(party);
  if (party.mode === 'missions') missions.finish(party);
  party.status = 'finished';
  party.finishedAt = Date.now();
  party.finishReason = reason;
  party.winnerProfileId = winnerProfileId ? String(winnerProfileId) : null;
  titles.assign(party);
  party.currentTrackId = null;
  party.answerSpec = null;
  party.intruderChallenge = null;
  party.auction = null;
  party.easterEgg = null;
  party.playback = null;
  party.autoNextAt = null;
  party.revealReason = null;
  buzzer.reset(party);
  resetRoundVotes(party);
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

function command(party, hostToken, action, data = {}) {
  if (!isHost(party, hostToken)) throw new Error('Commande réservée à l’hôte.');
  auction.refresh(party);
  if (party.status === 'finished' && action !== 'finish' && action !== 'lobby') {
    throw new Error('Cette partie est terminée.');
  }
  if (action === 'start-round') {
    const minimum = Number((modeRegistry.getMode(party.mode) || {}).minPlayers) || 1;
    const connectedPlayers = party.players.filter(player => player.connected).length;
    if (connectedPlayers < minimum) {
      throw new Error(`Ce mode demande au moins ${minimum} joueurs connectés.`);
    }
    royale.activateFinalDuel(party);
    party.status = 'round';
    const nextRound = Math.max(1, Math.floor(Number(data.round) || party.round + 1));
    party.round = party.infinite || (party.finalDuel && party.finalDuel.active)
      ? Math.min(Number.MAX_SAFE_INTEGER, nextRound)
      : Math.min(party.totalRounds, nextRound);
    party.currentTrackId = String(data.trackId || '');
    const now = Date.now();
    const requestedOffset = Number(data.playback && data.playback.offset);
    const paliers = Array.isArray(party.settings.paliers) ? party.settings.paliers : PALIERS_PRESETS.normal;
    const initialDuration = party.mode === 'buzzer' ? party.settings.excerpt : paliers[0];
    const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + initialDuration * 0.15));

    if (party.settings.mystery) {
      const modifiers = mysteryModifiersForMode(party.mode);
      party.roundModifier = modifiers.length
        ? modifiers[crypto.randomInt(modifiers.length)] : null;
    } else {
      party.roundModifier = null;
    }

    const baseSpeed = Number((party.roundModifier && party.roundModifier.speed) || party.settings.speed) || 1;
    const effSpeed = baseSpeed * audioFxSpeedMultiplier(party.settings.audioFx);
    const effDir = (party.roundModifier && party.roundModifier.direction) || party.settings.direction;
    const boost = (party.roundModifier && party.roundModifier.offsetBoost) || 0;

    party.currentStep = 0;
    const preparedPlayback = {
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
    party.playback = ['intruder', 'auction'].includes(party.mode)
      ? null : preparedPlayback;
    party.roundStartedAt = party.playback ? party.playback.startedAt : now;
    party.answerSpec = party.mode === 'intruder' ? null : cleanAnswerSpec(data.answer);
    party.intruderChallenge = party.mode === 'intruder' && data.intruderChallenge
      ? data.intruderChallenge : null;
    party.easterEgg = easterEggs.sanitizeDefinition(data.easterEgg);
    party.revealedTrack = null;
    party.autoNextAt = null;
    party.revealReason = null;
    party.firstFoundThisRound = false;
    if (party.mode === 'cooperation') cooperation.startRound(party);
    buzzer.reset(party);
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
      confidence.resetPlayer(p);
    }
    if (party.mode === 'auction') auction.startRound(party, preparedPlayback, now);
    if (party.mode === 'joker') joker.startRound(party);
    handicap.startRound(party);
  } else if (action === 'reveal') {
    if (party.status !== 'round') throw new Error('Aucune manche n’est ouverte.');
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
      year: Number(data.track.year) || null,
    } : party.answerSpec ? {
      title: party.answerSpec.title,
      originalTitle: party.answerSpec.originalTitle,
      artist: party.answerSpec.artist,
      genre: '',
      year: Number(party.answerSpec.year) || null,
    } : null;
    party.revealReason = ['correct', 'skip', 'manual'].includes(data.reason)
      ? data.reason : 'manual';
    party.autoNextAt = data.autoNext
      ? (party.playback
        ? party.playback.startedAt + highlightDuration * 1000
        : now + REVEAL_SECONDS * 1000)
      : null;
    titles.recordRound(party);

    if (party.mode === 'royale') {
      royale.resolveReveal(party, finishParty);
    } else if (party.mode === 'duel') {
      duel.resolveReveal(party);
    } else if (party.mode === 'cooperation') {
      cooperation.resolveReveal(party);
    }
  } else if (action === 'score') {
    const player = party.players.find(p => p.profileId === String(data.profileId));
    if (player) {
      player.score = Math.max(0, player.score + Math.round(Number(data.points) || 0));
      if (typeof data.correct === 'boolean') player.correct = data.correct;
    }
  } else if (action === 'finish') {
    finishParty(party, 'host');
  } else if (action === 'lobby') {
    party.status = 'lobby';
    party.currentTrackId = null;
    party.answerSpec = null;
    party.intruderChallenge = null;
    party.auction = null;
    party.easterEgg = null;
    party.playback = null;
    party.autoNextAt = null;
    party.revealReason = null;
    buzzer.reset(party);
    resetRoundVotes(party);
  } else if (teams.HOST_ACTIONS.has(action)) {
    teams.hostCommand(party, action, data);
  } else {
    throw new Error('Commande de partie inconnue.');
  }
  party.updatedAt = Date.now();
  return party;
}

function playerAction(party, playerToken, action, data = {}) {
  buzzer.refresh(party);
  auction.refresh(party);
  const player = findPlayer(party, playerToken);
  if (!player) throw new Error('Joueur inconnu dans cette partie.');

  if (action === 'leave') {
    if (!player.connected) return party;
    player.connected = false;
    player.updatedAt = Date.now();
    party.skipVotes = (party.skipVotes || []).filter(id => id !== player.profileId);
    party.stepVotes = (party.stepVotes || []).filter(id => id !== player.profileId);
    party.moreTimeVotes = (party.moreTimeVotes || []).filter(id => id !== player.profileId);
    if (party.activeBuzzerProfileId === player.profileId) {
      party.activeBuzzerProfileId = null;
      party.buzzerDeadline = null;
      buzzer.resumePlayback(party);
    }
    party.buzzOrder = (party.buzzOrder || []).filter(id => id !== player.profileId);
    party.updatedAt = Date.now();
    return party;
  }

  if (!player.connected) {
    throw new Error('Tu as quitté cette partie. Rejoins-la pour continuer.');
  }
  if (party.status === 'finished') throw new Error('Cette partie est terminée.');

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

  if (teams.PLAYER_ACTIONS.has(action)) {
    teams.playerAction(party, player, action, data);
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
  if (action === 'typing') {
    player.lastTypingAt = Date.now();
    party.updatedAt = Date.now();
    return party;
  }
  if (party.mode === 'royale' && player.isGhost) {
    throw new Error('Tu es éliminé : tu peux regarder la suite comme spectateur.');
  }
  if (party.status !== 'round') throw new Error('Aucune manche n’est ouverte.');
  if (party.roundStartedAt && Date.now() < party.roundStartedAt) {
    throw new Error('La musique va démarrer : attends le top !');
  }
  if (action === 'auction-bid') {
    if (party.mode !== 'auction') throw new Error('Cette partie n’utilise pas les enchères.');
    auction.submitBid(party, player, data.seconds);
  } else if (action === 'joker-use') {
    if (party.mode !== 'joker') throw new Error('Cette partie n’utilise pas de jokers.');
    joker.use(party, player, data.jokerId);
  } else if (action === 'skip') {
    if (!['classic', 'confidence', 'cooperation', 'joker', 'missions'].includes(party.mode)) {
      throw new Error('Le bouton Passer n’est actif qu’en réponses simultanées.');
    }
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
        party.playback.startedAt = Date.now();
        party.playback.loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + party.playback.duration * 0.15));
      }
    } else {
      player.finished = true;
      player.lastAnswer = 'Passé (dernier extrait)';
    }
    if (party.players.every(p => p.finished || p.found)) {
      party.roundDecision = 'all_finished';
    }
  } else if (action === 'vote-next-step') {
    if (!['classic', 'confidence', 'cooperation', 'joker', 'missions'].includes(party.mode)) {
      throw new Error('Le vote de palier n’est actif qu’en réponses simultanées.');
    }
    if (!party.stepVotes) party.stepVotes = [];
    toggleVote(party.stepVotes, player.profileId);
    const paliers = party.settings.paliers || PALIERS_PRESETS.normal;
    if (player.host || party.stepVotes.length >= voteThreshold(party)) {
      if (party.currentStep < paliers.length - 1) {
        party.currentStep++;
        party.playback.duration = paliers[party.currentStep];
        party.playback.step = party.currentStep;
        party.playback.startedAt = Date.now();
        party.playback.loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + party.playback.duration * 0.15));
        party.stepVotes = [];
      }
    }
  } else if (action === 'vote-skip') {
    toggleVote(party.skipVotes, player.profileId);
    if (player.host || party.skipVotes.length >= voteThreshold(party)) {
      party.roundDecision = 'skip';
    }
  } else if (action === 'intruder-answer') {
    if (party.mode !== 'intruder' || party.status !== 'round' || !party.intruderChallenge) {
      throw new Error('Aucun défi Intrus actif.');
    }
    if (player.finished) throw new Error('Réponse Intrus déjà envoyée.');
    const selectedId = String(data.optionId || '');
    if (!party.intruderChallenge.options.some(option => option.id === selectedId)) {
      throw new Error('Choix Intrus invalide.');
    }
    const correct = selectedId === party.intruderChallenge.answerId;
    player.sessionAnswers++;
    player.totalGuesses = (player.totalGuesses || 0) + 1;
    player.finished = true;
    player.found = correct;
    player.correct = correct;
    player.answer = selectedId;
    player.attempts = [{ type: correct ? 'success' : 'failed', step: 0, optionId: selectedId }];
    if (correct) {
      player.sessionCorrect++;
      player.earnedPoints = handicap.applyPoints(player, party.settings.points);
      player.score += player.earnedPoints;
    }
    if (party.players.every(candidate => candidate.finished)) party.roundDecision = 'all_finished';
  } else if (action === 'set-confidence') {
    if (party.mode !== 'confidence') {
      throw new Error('Les mises sont réservées au mode Confiance.');
    }
    if (party.status !== 'round' || player.finished || player.found) {
      throw new Error('Aucune mise possible maintenant.');
    }
    confidence.select(player, data.multiplier);
  } else if (action === 'answer' && party.mode === 'auction') {
    if (!auction.canAnswer(party, player)) {
      throw new Error('Ce n’est pas à toi de répondre à cette enchère.');
    }
    const guess = String(data.answer || '').trim().slice(0, 200);
    if (!guess) throw new Error('Écris une réponse.');
    player.sessionAnswers++;
    player.totalGuesses = (player.totalGuesses || 0) + 1;
    const correct = answerIsCorrect(guess, party.answerSpec);
    player.answer = guess;
    player.finished = true;
    player.correct = correct;
    player.attempts.push({ type: correct ? 'success' : 'failed', step: 0, text: guess });
    if (correct) {
      player.found = true;
      player.sessionCorrect++;
      player.earnedPoints = handicap.applyPoints(
        player, auction.resolveCorrect(party, player));
      party.auction.points = player.earnedPoints;
      player.score += player.earnedPoints;
    } else {
      player.wrongAttempts++;
      player.lastAnswer = guess;
      const extraPenalty = (party.roundModifier && party.roundModifier.penaltyHeavy) || 0;
      if (extraPenalty) {
        player.score = Math.max(0, player.score - extraPenalty);
        player.roundPenaltyPoints = (player.roundPenaltyPoints || 0) + extraPenalty;
        player.lastPenaltyPoints = extraPenalty;
      }
      auction.resolveWrong(party);
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
      buzzer.submitAnswer(party, player, guess, correct);
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
        let earned = Math.round(Math.max(50, baseEarned + speedBonus) * mult);
        if (party.mode === 'joker') earned = joker.applyPoints(player, earned);
        earned = handicap.applyPoints(player, earned);
        if (party.mode === 'confidence') {
          const delta = confidence.resolve(player, {
            correct: true,
            normalEarned: earned,
            basePoints: party.settings.points,
          });
          player.earnedPoints = delta;
        } else {
          player.earnedPoints = earned;
          player.score += earned;
        }
        if (party.mode === 'cooperation') {
          cooperation.contribute(party, player, player.earnedPoints);
        }
        if (party.mode === 'missions') {
          missions.recordAnswer(party, player, { correct: true, attempt: player.currentAttempt });
        }

        if (party.settings.victory === 'immediate') {
          party.roundDecision = 'solved';
        } else {
          if (party.players.every(p => p.finished || p.found)) {
            party.roundDecision = 'all_finished';
          }
        }
      } else {
        if (party.mode === 'missions') {
          missions.recordAnswer(party, player, { correct: false, attempt: player.currentAttempt });
        }
        player.wrongAttempts++;
        player.attempts.push({ type: 'failed', step: player.currentAttempt, text: guess });
        player.lastAnswer = guess;
        if (party.mode === 'confidence') {
          const delta = confidence.resolve(player, {
            correct: false,
            normalEarned: 0,
            basePoints: party.settings.points,
          });
          player.roundPenaltyPoints = (player.roundPenaltyPoints || 0) + Math.abs(delta);
          player.lastPenaltyPoints = Math.abs(delta);
          confidence.unlockNextAttempt(player);
        }
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
            party.playback.startedAt = Date.now();
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
    buzzer.begin(party, player);
  } else {
    throw new Error('Action de joueur inconnue.');
  }
  party.updatedAt = Date.now();
  return party;
}

function publicState(party, playerToken, hostToken, accessToken) {
  buzzer.refresh(party);
  auction.refresh(party);
  const viewer = findPlayer(party, playerToken);
  const host = isHost(party, hostToken);
  const role = host ? 'host' : (accessRole(party, accessToken) || (viewer ? 'player' : 'guest'));
  const now = Date.now();
  const normalizedSettings = normalizePartySettings(party.settings, party.mode);

  const publicTeams = teams.publicState(party);

  return {
    serverNow: now,
    code: party.code,
    mode: party.mode,
    modeDefinition: modeRegistry.getMode(party.mode),
    confidenceLevels: party.mode === 'confidence'
      ? confidence.LEVELS.map(item => ({ ...item })) : null,
    cooperation: party.mode === 'cooperation' ? cooperation.publicState(party) : null,
    auction: party.mode === 'auction' ? auction.publicState(party, viewer) : null,
    joker: party.mode === 'joker' ? joker.publicState(party) : null,
    intruderChallenge: party.mode === 'intruder'
      ? intruder.publicChallenge(party.intruderChallenge, party.status !== 'round') : null,
    infinite: party.infinite,
    totalRounds: party.totalRounds,
    seed: party.seed,
    settings: normalizePartySettings(party.settings, party.mode),
    status: party.status,
    round: party.round,
    currentStep: party.currentStep || 0,
    paliers: normalizedSettings.paliers,
    victory: normalizedSettings.victory || 'all_steps',
    playback: party.playback ? { ...party.playback } : null,
    roundModifier: party.roundModifier || null,
    autoNextAt: party.autoNextAt,
    revealReason: party.revealReason,
    easterEgg: easterEggs.publicState(party, viewer, role),
    teams: publicTeams,
    teamPresets: teams.TEAM_PRESETS,
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
    finishReason: party.finishReason,
    winnerProfileId: party.winnerProfileId,
    finalDuel: party.finalDuel ? {
      active: Boolean(party.finalDuel.active),
      targetWins: party.finalDuel.targetWins,
      contenders: party.finalDuel.contenders.map(entry => ({ ...entry })),
      tiedRounds: party.finalDuel.tiedRounds,
      roundResult: party.finalDuel.roundResult,
      winnerProfileId: party.finalDuel.winnerProfileId,
    } : null,
    votes: {
      threshold: voteThreshold(party),
      skip: {
        count: party.skipVotes.length,
        voted: Boolean(viewer && party.skipVotes.includes(viewer.profileId)),
        passed: party.roundDecision === 'skip',
      },
      nextStep: {
        count: (party.stepVotes || []).length,
        voted: Boolean(viewer && (party.stepVotes || []).includes(viewer.profileId)),
        currentStep: party.currentStep || 0,
        totalSteps: (normalizedSettings.paliers || []).length,
        nextDuration: (normalizedSettings.paliers || [])[(party.currentStep || 0) + 1] || null,
      },
    },
    typing: (party.players || [])
      .filter(p => p.profileId !== (viewer && viewer.profileId) && p.lastTypingAt && (now - p.lastTypingAt < 2500))
      .map(p => ({ profileId: p.profileId, nom: p.nom, emoji: p.emoji })),
    buzzer: {
      activeProfileId: party.activeBuzzerProfileId,
      answerSecondsRemaining: party.buzzerDeadline
        ? Math.max(0, Math.ceil((party.buzzerDeadline - now) / 1000)) : 0,
      solvedByProfileId: party.buzzerSolvedByProfileId,
    },
    // L'identifiant encode le nom du fichier et peut donc révéler titre/artiste.
    // Seul le PC hôte en a besoin pour synchroniser sa bibliothèque locale.
    currentTrackId: host ? party.currentTrackId : null,
    revealedTrack: party.revealedTrack,
    isHost: host,
    viewerRole: role,
    canControl: host || role === 'remote_admin',
    playlist: host || role === 'remote_admin'
      ? { count: party.trackIds.length, nextIndex: party.round % Math.max(1, party.trackIds.length) }
      : null,
    viewerProfileId: viewer ? viewer.profileId : null,
    duelScore: party.duelScore || 0,
    players: party.players.map(p => ({
      profileId: p.profileId,
      nom: p.nom,
      emoji: p.emoji,
      host: p.host,
      connected: Boolean(p.connected),
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
      attempts: host || p === viewer || party.status !== 'round'
        ? (Array.isArray(p.attempts) ? p.attempts : [])
        : (Array.isArray(p.attempts)
          ? p.attempts.map(attempt => ({
            type: attempt.type,
            step: attempt.step,
          }))
          : []),
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
      confidence: party.mode === 'confidence' ? {
        preview: confidence.preview(
          p,
          normalizedSettings.points,
          confidencePotential(party, p)
        ),
        lastDelta: Number(p.confidenceLastDelta) || 0,
        stats: confidence.publicStats(p),
      } : null,
      cooperation: party.mode === 'cooperation' ? cooperation.playerState(p) : null,
      joker: party.mode === 'joker' ? joker.playerState(p) : null,
      smartHandicap: handicap.playerState(party, p),
      portraitTitles: party.status === 'finished' && Array.isArray(p.portraitTitles)
        ? p.portraitTitles.map(item => ({ ...item })) : [],
      mission: party.mode === 'missions'
        ? missions.publicMission(party, p, viewer, party.status === 'finished') : null,
    })),
  };
}

module.exports = {
  create, get, remove, join, isInvited, findPlayer, command, playerAction, publicState,
  issueAccessToken, revokeAccessToken, accessRole,
  mysteryModifiersForMode,
  TEAM_PRESETS: teams.TEAM_PRESETS, MYSTERY_MODIFIERS,
};
