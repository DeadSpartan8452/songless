'use strict';

const FINAL_DUEL_TARGET_WINS = 2;

function livingPlayers(party) {
  return (party.players || []).filter(player => (
    !player.isGhost && Number(player.lives) > 0
  ));
}

function notePeakSurvivors(party) {
  if (party.mode !== 'royale') return 0;
  party.royalePeakSurvivors = Math.max(
    Number(party.royalePeakSurvivors) || 0,
    livingPlayers(party).length
  );
  return party.royalePeakSurvivors;
}

function activateFinalDuel(party, now = Date.now()) {
  if (party.mode !== 'royale' || party.finalDuel
      || Number(party.royalePeakSurvivors) <= 2) return false;
  const survivors = livingPlayers(party);
  if (survivors.length !== 2) return false;
  party.finalDuel = {
    active: true,
    startedAt: now,
    targetWins: FINAL_DUEL_TARGET_WINS,
    contenders: survivors.map(player => ({ profileId: player.profileId, wins: 0 })),
    tiedRounds: 0,
    roundResult: 'transition',
    winnerProfileId: null,
  };
  return true;
}

function resolveFinalDuelRound(party, finishParty) {
  const duel = party.finalDuel;
  if (!duel || !duel.active || duel.winnerProfileId) return false;
  const contenders = duel.contenders.map(entry => ({
    entry,
    player: party.players.find(player => player.profileId === entry.profileId),
  }));
  const successful = contenders.filter(item => item.player && item.player.found);
  if (successful.length !== 1) {
    duel.tiedRounds++;
    duel.roundResult = successful.length === 2 ? 'both_correct' : 'both_missed';
    return true;
  }
  const winner = successful[0];
  winner.entry.wins++;
  duel.roundResult = 'point';
  if (winner.entry.wins >= duel.targetWins) {
    duel.active = false;
    duel.winnerProfileId = winner.entry.profileId;
    finishParty(party, 'final_duel', winner.entry.profileId);
  }
  return true;
}

function resolveReveal(party, finishParty) {
  if (party.finalDuel && party.finalDuel.active) {
    resolveFinalDuelRound(party, finishParty);
    return;
  }
  for (const player of party.players || []) {
    if (!player.isGhost && !player.found) {
      player.lives = Math.max(
        0,
        (player.lives !== undefined ? player.lives : 3) - 1
      );
      if (player.lives === 0) player.isGhost = true;
    }
  }
  if (livingPlayers(party).length === 2) activateFinalDuel(party);
}

module.exports = {
  activateFinalDuel,
  livingPlayers,
  notePeakSurvivors,
  resolveFinalDuelRound,
  resolveReveal,
};
