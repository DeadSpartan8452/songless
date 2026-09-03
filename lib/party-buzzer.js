'use strict';

const ANSWER_MS = 10_000;
const PENALTY_MS = 3_000;

function reset(party) {
  party.buzzOrder = [];
  party.activeBuzzerProfileId = null;
  party.buzzerDeadline = null;
  party.buzzerSolvedByProfileId = null;
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

function registerWrongAnswer(party, player, now = Date.now()) {
  const penalty = Math.max(0, Number(
    party.roundModifier && party.roundModifier.penaltyHeavy
  ) || 100);
  player.wrongAttempts++;
  player.roundPenaltyPoints += penalty;
  player.lastPenaltyPoints = penalty;
  player.score = Math.max(0, player.score - penalty);
  player.buzzerBlockedUntil = now + PENALTY_MS;
  party.buzzOrder = party.buzzOrder.filter(id => id !== player.profileId);
}

function refresh(party, now = Date.now()) {
  if (party.mode !== 'buzzer') return;
  if (party.buzzerDeadline && party.buzzerDeadline <= now) {
    const player = party.players.find(
      candidate => candidate.profileId === party.activeBuzzerProfileId
    );
    if (party.activeBuzzerProfileId && player && player.answer === null) {
      player.lastAnswer = 'Temps écoulé';
      player.correct = false;
      player.sessionAnswers++;
      registerWrongAnswer(party, player, now);
      player.updatedAt = now;
    }
    party.activeBuzzerProfileId = null;
    party.buzzerDeadline = null;
    resumePlayback(party, now);
    party.updatedAt = now;
  }
}

function begin(party, player, now = Date.now()) {
  if (party.mode !== 'buzzer') throw new Error('Le buzzer n’est pas actif dans ce mode.');
  if (party.buzzerSolvedByProfileId) throw new Error('La bonne réponse a déjà été trouvée.');
  if (player.finished) throw new Error('Tes essais sont terminés pour cette manche.');
  if (player.answer !== null) throw new Error('Tu as déjà tenté une réponse pour cette manche.');
  if (party.activeBuzzerProfileId) throw new Error('Un joueur répond déjà.');
  if (player.buzzerBlockedUntil && player.buzzerBlockedUntil > now) {
    const seconds = Math.ceil((player.buzzerBlockedUntil - now) / 1000);
    throw new Error(`Ta pénalité est encore active pendant ${seconds} s.`);
  }
  player.buzzedAt = now;
  party.buzzOrder.push(player.profileId);
  party.activeBuzzerProfileId = player.profileId;
  party.buzzerDeadline = now + ANSWER_MS;
  pausePlayback(party, now);
}

function submitAnswer(party, player, guess, correct, now = Date.now()) {
  player.answer = guess;
  player.correct = correct;
  if (correct) {
    player.sessionCorrect++;
    if (!party.firstFoundThisRound) {
      party.firstFoundThisRound = true;
      player.firstCorrectCount = (player.firstCorrectCount || 0) + 1;
    }
    const multiplier = (party.roundModifier && party.roundModifier.multiplier) || 1;
    player.score += Math.round(party.settings.points * multiplier);
    party.activeBuzzerProfileId = null;
    party.buzzerSolvedByProfileId = player.profileId;
    return;
  }
  party.activeBuzzerProfileId = null;
  party.buzzerDeadline = null;
  player.lastAnswer = player.answer;
  player.answer = null;
  registerWrongAnswer(party, player, now);
  if (party.roundModifier && party.roundModifier.singleAttempt) player.finished = true;
  resumePlayback(party, now);
}

module.exports = {
  begin,
  pausePlayback,
  refresh,
  registerWrongAnswer,
  reset,
  resumePlayback,
  submitAnswer,
};
