'use strict';

const crypto = require('crypto');

const parties = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BUZZER_ANSWER_MS = 10_000;
const BUZZER_PENALTY_MS = 3_000;
const ROUND_START_DELAY_MS = 1_000;
const VOTE_EXTRA_SECONDS = 5;
const REVEAL_SECONDS = 5;

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
  const infinite = totalRounds === 'infinite' || totalRounds === 0 || totalRounds === '0';
  const party = {
    code: code(),
    hostToken: token(),
    inviteToken: token(),
    mode: mode === 'buzzer' ? 'buzzer' : 'classic',
    infinite,
    totalRounds: infinite ? null : Math.min(100, Math.max(1, Number(totalRounds) || 10)),
    seed: String(seed || '').slice(0, 40),
    settings: cleanPartySettings(settings),
    status: 'lobby',
    round: 0,
    currentTrackId: null,
    roundStartedAt: null,
    playback: null,
    answerSpec: null,
    revealedTrack: null,
    players: [],
    buzzOrder: [],
    activeBuzzerProfileId: null,
    buzzerDeadline: null,
    buzzerSolvedByProfileId: null,
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
    lastAnswer: null,
    correct: null,
    buzzedAt: null,
    wrongAttempts: 0,
    buzzerBlockedUntil: null,
    roundPenaltyPoints: 0,
    lastPenaltyPoints: 0,
    lastChatAt: 0,
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
  return Math.max(1, Math.floor(party.players.length / 2) + 1);
}

function toggleVote(list, profileId) {
  const index = list.indexOf(profileId);
  if (index >= 0) list.splice(index, 1);
  else list.push(profileId);
}

function registerWrongBuzzer(party, player, now = Date.now()) {
  player.wrongAttempts++;
  player.buzzerBlockedUntil = now + BUZZER_PENALTY_MS;
  player.lastPenaltyPoints = 0;
  if (player.wrongAttempts >= 3) {
    const penalty = Math.max(1, Math.round(party.settings.points * 0.1));
    const deducted = Math.min(player.score, penalty);
    player.score -= deducted;
    player.roundPenaltyPoints += deducted;
    player.lastPenaltyPoints = deducted;
  }
}

function pausePlayback(party, now = Date.now()) {
  if (!party.playback || party.playback.pausedAt) return;
  party.playback.pausedAt = now;
}

function resumePlayback(party, now = Date.now()) {
  if (!party.playback || !party.playback.pausedAt) return;
  // En repoussant startedAt de la durée de pause, la position musicale reste
  // identique sur tous les appareils sans compter les secondes de réponse.
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
    party.playback = {
      // Une seconde suffit avec le rafraîchissement rapide des téléphones et
      // réduit nettement l'attente entre deux manches.
      startedAt: now + ROUND_START_DELAY_MS,
      offset: Number.isFinite(requestedOffset)
        ? Math.min(24 * 60 * 60, Math.max(0, requestedOffset)) : 0,
      duration: party.settings.excerpt,
      speed: party.settings.speed,
      direction: party.settings.direction,
      pausedAt: null,
    };
    party.roundStartedAt = party.playback.startedAt;
    party.answerSpec = cleanAnswerSpec(data.answer);
    party.revealedTrack = null;
    party.autoNextAt = null;
    party.revealReason = null;
    resetBuzzer(party);
    resetRoundVotes(party);
    for (const p of party.players) {
      p.sessionRounds++;
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
  if (action === 'vote-skip') {
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
      // Même si le vote aboutit juste après la fin de l'extrait, les joueurs
      // reçoivent bien cinq nouvelles secondes complètes.
      if (elapsed > previousDuration) {
        party.playback.startedAt += (elapsed - previousDuration) / speed * 1000;
      }
      party.playback.duration = Math.min(120,
        previousDuration + VOTE_EXTRA_SECONDS);
    }
  } else if (action === 'answer') {
    if (player.answer !== null) throw new Error('Réponse déjà envoyée pour cette manche.');
    if (party.mode === 'buzzer' && party.activeBuzzerProfileId !== player.profileId) {
      throw new Error('Ce n’est pas à toi de répondre au buzzer.');
    }
    player.answer = String(data.answer || '').trim().slice(0, 200);
    player.sessionAnswers++;
    player.correct = answerIsCorrect(player.answer, party.answerSpec);
    if (player.correct) {
      player.sessionCorrect++;
      const elapsed = Math.max(0, Date.now() - (party.roundStartedAt || Date.now()));
      const maximum = party.settings.points;
      const minimum = Math.round(maximum / 10);
      const earned = party.mode === 'buzzer'
        ? maximum
        : Math.max(minimum, Math.round(maximum * Math.pow(0.5, elapsed / 4000)));
      player.score += earned;
    }
    if (party.mode === 'buzzer') {
      party.activeBuzzerProfileId = null;
      if (player.correct) {
        // Le buzz ne supprime jamais l'unique écoute : même après une bonne
        // réponse, elle reprendra à la fin des dix secondes si l'hôte ne
        // révèle pas le morceau avant.
        party.buzzerSolvedByProfileId = player.profileId;
      } else {
        party.buzzerDeadline = null;
        player.lastAnswer = player.answer;
        player.answer = null;
        registerWrongBuzzer(party, player);
        resumePlayback(party);
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
  return {
    serverNow: now,
    code: party.code,
    mode: party.mode,
    infinite: party.infinite,
    totalRounds: party.totalRounds,
    seed: party.seed,
    settings: party.settings,
    status: party.status,
    round: party.round,
    playback: party.playback ? { ...party.playback } : null,
    autoNextAt: party.autoNextAt,
    revealReason: party.revealReason,
    chat: party.chatMessages.slice(-50).map(message => {
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
      lastAnswer: host || p === viewer || party.status !== 'round'
        ? p.lastAnswer : (p.lastAnswer ? 'Tentative envoyée' : null),
      correct: host || p === viewer || party.status !== 'round' ? p.correct : null,
      buzzPosition: party.buzzOrder.indexOf(p.profileId) + 1 || null,
      wrongAttempts: p.wrongAttempts || 0,
      roundPenaltyPoints: p.roundPenaltyPoints || 0,
      lastPenaltyPoints: p.lastPenaltyPoints || 0,
      buzzerBlockedSeconds: p.buzzerBlockedUntil
        ? Math.max(0, Math.ceil((p.buzzerBlockedUntil - now) / 1000)) : 0,
    })),
  };
}

module.exports = {
  create, get, join, isInvited, findPlayer, command, playerAction, publicState,
};
