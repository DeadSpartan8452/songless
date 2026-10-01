'use strict';

function roundScores(party) {
  const teams = party.teams || [];
  if (teams.length >= 2) {
    return teams.slice(0, 2).map(team => (
      party.players
        .filter(player => player.teamId === team.id)
        .reduce((total, player) => total + (Number(player.earnedPoints) || 0), 0)
    ));
  }
  if ((party.players || []).length >= 2) {
    return party.players.slice(0, 2).map(player => Number(player.earnedPoints) || 0);
  }
  return null;
}

function scorePosition(party) {
  const scores = roundScores(party);
  if (!scores) return Number(party.duelScore) || 0;
  const delta = scores[0] - scores[1];
  const movement = delta > 0 ? -25 : delta < 0 ? 25 : 0;
  const start = Number.isFinite(Number(party.duelScoreAtRoundStart))
    ? Number(party.duelScoreAtRoundStart) : Number(party.duelScore) || 0;
  return Math.min(
    100,
    Math.max(-100, start + movement)
  );
}

function updateLiveScore(party) {
  if (party.mode !== 'duel') return false;
  party.duelScore = scorePosition(party);
  return true;
}

function resolveReveal(party) {
  if (!roundScores(party)) return false;
  updateLiveScore(party);
  return true;
}

module.exports = { resolveReveal, roundScores, scorePosition, updateLiveScore };
