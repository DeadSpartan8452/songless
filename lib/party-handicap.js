'use strict';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function accuracy(stats) {
  const answers = Math.max(0, Number(stats && stats.answers) || 0);
  const correct = Math.max(0, Number(stats && stats.correct) || 0);
  return answers >= 5 ? clamp(correct / answers, 0, 1) : null;
}

function compute(party, player) {
  if (!party.settings || !party.settings.smartHandicap) {
    return { multiplier: 1, kind: 'neutral', explanation: 'Adaptation intelligente désactivée.' };
  }
  const globalAccuracy = accuracy(player.globalStats);
  const sessionAccuracy = Number(player.sessionAnswers) >= 2
    ? clamp(Number(player.sessionCorrect) / Number(player.sessionAnswers), 0, 1) : null;
  if (globalAccuracy === null && sessionAccuracy === null) {
    return {
      multiplier: 1,
      kind: 'neutral',
      explanation: 'Données encore insuffisantes : aucun ajustement pour cette manche.',
    };
  }
  const skill = globalAccuracy === null ? sessionAccuracy
      : sessionAccuracy === null ? globalAccuracy
        : globalAccuracy * 0.65 + sessionAccuracy * 0.35;
  let multiplier = skill <= 0.35 ? 1.12 : skill >= 0.75 ? 0.9 : 1;
  const scores = (party.players || []).map(item => Number(item.score) || 0);
  const leader = Math.max(0, ...scores);
  const gap = leader - (Number(player.score) || 0);
  if (gap >= 1000) multiplier += 0.05;
  if (gap === 0 && scores.some(score => leader - score >= 1000)) multiplier -= 0.03;
  multiplier = Math.round(clamp(multiplier, 0.85, 1.2) * 100) / 100;
  const kind = multiplier > 1 ? 'boost' : multiplier < 1 ? 'challenge' : 'neutral';
  const explanation = kind === 'boost'
    ? `Coup de pouce mesuré : points ×${multiplier.toFixed(2)} selon ta précision et l’écart actuel.`
    : kind === 'challenge'
      ? `Défi mesuré : points ×${multiplier.toFixed(2)} selon ta précision et l’avance actuelle.`
      : 'Niveau équilibré : aucun ajustement de points pour cette manche.';
  return { multiplier, kind, explanation };
}

function startRound(party) {
  for (const player of party.players || []) player.smartHandicap = compute(party, player);
}

function applyPoints(player, points) {
  const multiplier = Number(player.smartHandicap && player.smartHandicap.multiplier) || 1;
  return Math.max(0, Math.round((Number(points) || 0) * multiplier));
}

function playerState(party, player) {
  if (!party.settings || !party.settings.smartHandicap) return null;
  return player.smartHandicap ? { ...player.smartHandicap } : compute(party, player);
}

module.exports = { accuracy, applyPoints, compute, playerState, startRound };
