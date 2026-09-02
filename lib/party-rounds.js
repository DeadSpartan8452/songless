'use strict';

const crypto = require('crypto');

function roundOffset(party, track) {
  const duration = Math.max(0, Number(track.duration) || 0);
  if (party.settings.start === 'debut' || duration <= 20) return 0;
  if (party.settings.start === 'refrain') {
    return Math.max(0, Math.min(duration - 15, duration * 0.45));
  }
  const digest = crypto.createHash('sha256')
    .update(`${party.seed}:${party.round + 1}:${track.id}`)
    .digest();
  const maximum = Math.max(0, Math.floor(duration - 20));
  return maximum ? digest.readUInt32BE(0) % (maximum + 1) : 0;
}

async function startNextPartyRound(party, dependencies) {
  if (!party.trackIds.length) {
    throw new Error('La playlist serveur de cette partie est vide.');
  }
  const finalDuelActive = Boolean(party.finalDuel && party.finalDuel.active);
  if (!party.infinite && !finalDuelActive && party.round >= party.totalRounds) {
    throw new Error('Toutes les manches prévues ont déjà été jouées.');
  }
  const index = party.infinite || finalDuelActive
    ? party.round % party.trackIds.length : party.round;
  const trackId = party.trackIds[index];
  const data = await dependencies.loadTrack(trackId);
  data.answer.mode = party.settings.answer;
  dependencies.command(party, party.hostToken, 'start-round', {
    round: party.round + 1,
    trackId,
    playback: { offset: roundOffset(party, data.track) },
    answer: data.answer,
    easterEgg: data.track.easterEgg,
  });
}

async function revealCurrentPartyRound(party, requested, dependencies) {
  if (!party.currentTrackId) throw new Error('Aucune manche à révéler.');
  const data = await dependencies.loadTrack(party.currentTrackId);
  dependencies.command(party, party.hostToken, 'reveal', {
    track: {
      title: data.track.title,
      originalTitle: data.track.originalTitle,
      artist: data.track.artist,
      genre: data.track.genre,
    },
    highlightOffset: Number(party.playback && party.playback.offset) || 0,
    highlightDuration: 5,
    autoNext: Boolean(requested && requested.autoNext),
    reason: requested && ['correct', 'skip'].includes(requested.reason)
      ? requested.reason : 'manual',
  });
}

module.exports = { revealCurrentPartyRound, roundOffset, startNextPartyRound };
