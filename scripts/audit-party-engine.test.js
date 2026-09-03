'use strict';

const assert = require('assert');
const partyEngine = require('../lib/party-engine');

assert.throws(
  () => partyEngine.create({}),
  /Contrat du moteur incomplet : command/
);

const commands = [];
const histories = [];
const playerStore = {
  recordPartySessions() {
    return [];
  },
  recordPartyHistory(entry) {
    histories.push(entry);
  },
};
const engine = partyEngine.create({
  command(party, hostToken, action, data) {
    commands.push({party, hostToken, action, data});
  },
  async loadTrack(trackId) {
    return {
      track: {
        id: trackId,
        title: 'Titre test',
        originalTitle: 'Titre test',
        artist: 'Artiste test',
        genre: 'Pop',
        year: 2000,
        duration: 180,
      },
      answer: {mode: 'titre'},
    };
  },
  async buildIntruderChallenge() {
    throw new Error('Le mode classique ne doit pas demander un Intrus.');
  },
  playerStore,
});

const party = {
  code: 'ABCDE',
  currentTrackId: null,
  finalDuel: null,
  hostToken: 'host-test',
  infinite: false,
  mode: 'classic',
  players: [],
  round: 0,
  seed: 'seed-test',
  settings: {answer: 'titre', start: 'debut'},
  status: 'lobby',
  totalRounds: 1,
  trackIds: ['track-test'],
};

(async () => {
  await engine.startNextRound(party);
  assert.strictEqual(commands[0].action, 'start-round');
  assert.strictEqual(commands[0].data.trackId, 'track-test');

  party.currentTrackId = 'track-test';
  await engine.revealCurrentRound(party, {reason: 'correct'});
  assert.strictEqual(commands[1].action, 'reveal');
  assert.strictEqual(commands[1].data.reason, 'correct');

  party.status = 'finished';
  assert.strictEqual(engine.commitFinished(party), true);
  assert.strictEqual(histories.length, 1);
  assert.strictEqual(engine.commitFinished(party), false);
  assert.strictEqual(histories.length, 1);

  console.log('OK  contrats de manches et résultats centralisés dans le moteur');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
