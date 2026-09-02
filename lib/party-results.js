'use strict';

function orderedPlayers(party) {
  const winnerProfileId = party.winnerProfileId
    ? String(party.winnerProfileId) : null;
  return [...(party.players || [])].sort((left, right) => {
    if (winnerProfileId && String(left.profileId) === winnerProfileId) return -1;
    if (winnerProfileId && String(right.profileId) === winnerProfileId) return 1;
    return (Number(right.score) || 0) - (Number(left.score) || 0);
  });
}

function playerRank(player, ordered, winnerProfileId) {
  if (winnerProfileId) return ordered.indexOf(player) + 1;
  const score = Number(player.score) || 0;
  return 1 + ordered.filter(other => (Number(other.score) || 0) > score).length;
}

function partyHistoryEntry(party) {
  const players = orderedPlayers(party);
  const winnerProfileId = party.winnerProfileId
    ? String(party.winnerProfileId) : null;
  const winner = winnerProfileId
    ? players.find(player => String(player.profileId) === winnerProfileId)
    : players[0];
  const teams = (party.teams || []).map(team => {
    const members = players.filter(player => player.teamId === team.id);
    return {
      name: team.name,
      color: team.color,
      emoji: team.emoji,
      score: members.reduce((total, player) => total + (Number(player.score) || 0), 0),
    };
  }).sort((left, right) => right.score - left.score);

  return {
    code: party.code,
    mode: party.mode,
    totalRounds: party.round,
    winner: winner ? {
      nom: winner.nom,
      emoji: winner.emoji,
      score: Number(winner.score) || 0,
    } : null,
    winningTeam: teams[0] || null,
    playersCount: players.length,
    players: players.map(player => ({
      nom: player.nom,
      emoji: player.emoji,
      score: Number(player.score) || 0,
      rank: playerRank(player, players, winnerProfileId),
      teamId: player.teamId,
    })),
  };
}

function commitFinishedParty(party, playerStore) {
  if (!party || party.status !== 'finished' || party.statsCommitted) return false;
  const saved = playerStore.recordPartySessions(
    party.players,
    party.winnerProfileId
  );
  for (const result of saved) {
    const player = party.players.find(item => item.profileId === result.id);
    if (player) player.globalStats = result.multiplayer;
  }
  playerStore.recordPartyHistory(partyHistoryEntry(party));
  party.statsCommitted = true;
  return true;
}

module.exports = { commitFinishedParty, partyHistoryEntry };
