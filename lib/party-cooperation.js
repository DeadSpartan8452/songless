'use strict';

const ROLES = Object.freeze([
  Object.freeze({ id: 'ear', emoji: '👂', label: 'Oreille fine', description: '+15 % sur les deux premiers extraits.' }),
  Object.freeze({ id: 'relay', emoji: '🔁', label: 'Relance', description: '+15 % à partir du troisième extrait.' }),
  Object.freeze({ id: 'anchor', emoji: '🛡️', label: 'Ancre', description: '+5 % et protège une vie commune une fois.' }),
]);

function ensure(party) {
  if (!party.cooperation) {
    party.cooperation = {
      targetPoints: 0, sharedPoints: 0, targetStreak: 0, streak: 0,
      bestStreak: 0, lives: 3, shieldUsed: false, roundResolved: false,
      result: null,
    };
  }
  return party.cooperation;
}

function joinPlayer(party, player) {
  const role = ROLES[(party.players.length - 1 + ROLES.length) % ROLES.length];
  player.cooperationRole = role.id;
  player.cooperationContribution = Number(player.cooperationContribution) || 0;
  player.cooperationCorrect = Number(player.cooperationCorrect) || 0;
}

function startRound(party) {
  const state = ensure(party);
  const players = Math.max(1, party.players.filter(player => player.connected).length);
  const rounds = party.infinite ? 10 : Math.max(1, Number(party.totalRounds) || 1);
  const rawTarget = (Number(party.settings.points) || 1000) * players * rounds * 0.65;
  if (!state.targetPoints) state.targetPoints = Math.ceil(rawTarget / 100) * 100;
  if (!state.targetStreak) state.targetStreak = Math.min(5, Math.max(2, Math.ceil(rounds / 3)));
  state.roundResolved = false;
  return state;
}

function roleBonus(player, points) {
  const attempt = Number(player.currentAttempt) || 0;
  if (player.cooperationRole === 'ear' && attempt <= 1) return Math.round(points * 0.15);
  if (player.cooperationRole === 'relay' && attempt >= 2) return Math.round(points * 0.15);
  if (player.cooperationRole === 'anchor') return Math.round(points * 0.05);
  return 0;
}

function contribute(party, player, earned) {
  const state = ensure(party);
  const base = Math.max(0, Math.round(Number(earned) || 0));
  const bonus = roleBonus(player, base);
  const contribution = base + bonus;
  state.sharedPoints += contribution;
  player.cooperationContribution = (Number(player.cooperationContribution) || 0) + contribution;
  player.cooperationCorrect = (Number(player.cooperationCorrect) || 0) + 1;
  return { base, bonus, contribution };
}

function resolveReveal(party) {
  const state = ensure(party);
  if (state.roundResolved) return state;
  state.roundResolved = true;
  const solved = party.players.some(player => player.found);
  if (solved) {
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
  } else {
    state.streak = 0;
    const anchor = party.players.find(player => player.connected && player.cooperationRole === 'anchor');
    if (anchor && !state.shieldUsed) state.shieldUsed = true;
    else state.lives = Math.max(0, state.lives - 1);
  }
  return state;
}

function finish(party) {
  const state = ensure(party);
  const reached = state.sharedPoints >= state.targetPoints || state.bestStreak >= state.targetStreak;
  state.result = state.lives > 0 && reached ? 'won' : 'lost';
  return state.result;
}

function playerState(player) {
  const role = ROLES.find(item => item.id === player.cooperationRole) || ROLES[0];
  return {
    role: { ...role },
    contribution: Number(player.cooperationContribution) || 0,
    correct: Number(player.cooperationCorrect) || 0,
  };
}

function publicState(party) {
  const state = ensure(party);
  return {
    ...state,
    progress: state.targetPoints ? Math.min(100, Math.round((state.sharedPoints / state.targetPoints) * 100)) : 0,
    roles: ROLES.map(role => ({ ...role })),
  };
}

module.exports = {
  ROLES, contribute, ensure, finish, joinPlayer, playerState, publicState,
  resolveReveal, roleBonus, startRound,
};
