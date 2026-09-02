'use strict';

const DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'replay', emoji: '🔁', label: 'Seconde écoute', description: 'Relance immédiatement le même extrait.' }),
  Object.freeze({ id: 'extension', emoji: '⏱️', label: 'Rallonge', description: 'Ajoute 3 secondes à l’extrait pour tout le monde.' }),
  Object.freeze({ id: 'double', emoji: '✨', label: 'Double mise', description: 'Double tes points sur une bonne réponse de cette manche.' }),
]);

function initializePlayer(player) {
  if (!player.jokers || typeof player.jokers !== 'object') {
    player.jokers = Object.fromEntries(DEFINITIONS.map(item => [item.id, 1]));
  }
  for (const item of DEFINITIONS) {
    player.jokers[item.id] = Math.min(1, Math.max(0, Number(player.jokers[item.id]) || 0));
  }
  player.jokerMultiplier = Number(player.jokerMultiplier) === 2 ? 2 : 1;
  player.jokerUses = Math.max(0, Number(player.jokerUses) || 0);
}

function joinPlayer(player) {
  initializePlayer(player);
}

function startRound(party) {
  party.jokerEvent = null;
  for (const player of party.players || []) {
    initializePlayer(player);
    player.jokerMultiplier = 1;
  }
}

function definition(id) {
  return DEFINITIONS.find(item => item.id === String(id || '')) || null;
}

function use(party, player, id, now = Date.now()) {
  initializePlayer(player);
  const item = definition(id);
  if (!item) throw new Error('Joker inconnu.');
  if (party.mode !== 'joker' || party.status !== 'round') {
    throw new Error('Aucun joker utilisable maintenant.');
  }
  if (player.finished || player.found) throw new Error('Ta manche est déjà terminée.');
  if (!player.jokers[item.id]) throw new Error('Ce joker a déjà été utilisé.');
  if (item.id !== 'double' && !party.playback) {
    throw new Error('Aucun extrait à modifier.');
  }
  player.jokers[item.id] = 0;
  player.jokerUses++;
  if (item.id === 'replay') {
    party.playback.startedAt = now + 250;
    party.playback.pausedAt = null;
  } else if (item.id === 'extension') {
    party.playback.duration = Math.min(30, Number(party.playback.duration) + 3);
    party.playback.startedAt = now + 250;
    party.playback.pausedAt = null;
    party.playback.loopDelay = Math.min(4.2, Math.max(2.2,
      2 + party.playback.duration * 0.15));
  } else {
    player.jokerMultiplier = 2;
  }
  party.jokerEvent = {
    profileId: player.profileId,
    id: item.id,
    emoji: item.emoji,
    label: item.label,
    createdAt: now,
  };
  return item;
}

function applyPoints(player, points) {
  initializePlayer(player);
  return Math.max(0, Math.round((Number(points) || 0) * player.jokerMultiplier));
}

function playerState(player) {
  initializePlayer(player);
  return {
    inventory: DEFINITIONS.map(item => ({
      ...item,
      remaining: Number(player.jokers[item.id]) || 0,
    })),
    multiplier: player.jokerMultiplier,
    uses: player.jokerUses,
  };
}

function publicState(party) {
  return {
    definitions: DEFINITIONS.map(item => ({ ...item })),
    event: party.jokerEvent ? { ...party.jokerEvent } : null,
  };
}

module.exports = {
  DEFINITIONS, applyPoints, initializePlayer, joinPlayer, playerState,
  publicState, startRound, use,
};
