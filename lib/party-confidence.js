'use strict';

const LEVELS = Object.freeze([
  Object.freeze({ multiplier: 1, label: 'Sûr', emoji: '🛟', lossRate: 0 }),
  Object.freeze({ multiplier: 2, label: 'Audacieux', emoji: '🔥', lossRate: 0.25 }),
  Object.freeze({ multiplier: 3, label: 'Panache', emoji: '⚡', lossRate: 0.5 }),
]);

function level(value) {
  const multiplier = Number(value);
  return LEVELS.find(item => item.multiplier === multiplier) || null;
}

function resetPlayer(player) {
  player.confidenceStake = 1;
  player.confidenceLocked = false;
  player.confidenceLastDelta = 0;
  if (!player.confidenceStats) {
    player.confidenceStats = {
      answers: 0, correct: 0, totalStaked: 0, pointsWon: 0, pointsLost: 0,
    };
  }
}

function select(player, value) {
  const selected = level(value);
  if (!selected) throw new Error('Mise de confiance invalide.');
  if (player.confidenceLocked) throw new Error('Cette mise est déjà verrouillée.');
  player.confidenceStake = selected.multiplier;
  return selected;
}

function maximumLoss(score, basePoints, multiplier) {
  const selected = level(multiplier) || LEVELS[0];
  if (!selected.lossRate) return 0;
  const bank = Math.max(0, Math.round(Number(score) || 0));
  const nominal = Math.round(Math.max(0, Number(basePoints) || 0) * selected.lossRate);
  return Math.min(nominal, Math.floor(bank * 0.3));
}

function preview(player, basePoints, normalPotentialGain) {
  const selected = level(player.confidenceStake) || LEVELS[0];
  return {
    multiplier: selected.multiplier,
    label: selected.label,
    emoji: selected.emoji,
    potentialGain: Math.round(Math.max(0, Number(normalPotentialGain) || 0)
      * selected.multiplier),
    maximumLoss: maximumLoss(player.score, basePoints, selected.multiplier),
    locked: Boolean(player.confidenceLocked),
  };
}

function resolve(player, { correct, normalEarned, basePoints }) {
  const selected = level(player.confidenceStake) || LEVELS[0];
  player.confidenceLocked = true;
  const stats = player.confidenceStats || (player.confidenceStats = {
    answers: 0, correct: 0, totalStaked: 0, pointsWon: 0, pointsLost: 0,
  });
  stats.answers++;
  stats.totalStaked += selected.multiplier;

  let delta;
  if (correct) {
    delta = Math.round(Math.max(0, Number(normalEarned) || 0) * selected.multiplier);
    stats.correct++;
    stats.pointsWon += delta;
  } else {
    delta = -maximumLoss(player.score, basePoints, selected.multiplier);
    stats.pointsLost += Math.abs(delta);
  }
  player.score = Math.max(0, Math.round(Number(player.score) || 0) + delta);
  player.confidenceLastDelta = delta;
  return delta;
}

function unlockNextAttempt(player) {
  player.confidenceLocked = false;
  player.confidenceStake = 1;
}

function publicStats(player) {
  const stats = player.confidenceStats || {};
  const answers = Number(stats.answers) || 0;
  const correct = Number(stats.correct) || 0;
  const won = Number(stats.pointsWon) || 0;
  const lost = Number(stats.pointsLost) || 0;
  const totalStaked = Number(stats.totalStaked) || 0;
  return {
    answers, correct, totalStaked, pointsWon: won, pointsLost: lost,
    audacity: answers ? Math.round((totalStaked / answers) * 100) / 100 : 0,
    precision: answers ? Math.round((correct / answers) * 100) : 0,
    profitability: won - lost,
  };
}

module.exports = {
  LEVELS, maximumLoss, preview, publicStats, resetPlayer, resolve, select,
  unlockNextAttempt,
};
