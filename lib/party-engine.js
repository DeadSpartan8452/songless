'use strict';

const partyResults = require('./party-results');
const partyRounds = require('./party-rounds');

function requiredFunction(owner, name, label) {
  if (!owner || typeof owner[name] !== 'function') {
    throw new TypeError(`Contrat du moteur incomplet : ${label}.`);
  }
  return owner[name].bind(owner);
}

function create(dependencies = {}) {
  const command = requiredFunction(dependencies, 'command', 'command');
  const loadTrack = requiredFunction(dependencies, 'loadTrack', 'loadTrack');
  const buildIntruderChallenge = requiredFunction(
    dependencies,
    'buildIntruderChallenge',
    'buildIntruderChallenge'
  );
  const playerStore = dependencies.playerStore;
  requiredFunction(playerStore, 'recordPartySessions', 'playerStore.recordPartySessions');
  requiredFunction(playerStore, 'recordPartyHistory', 'playerStore.recordPartyHistory');

  const roundDependencies = Object.freeze({
    buildIntruderChallenge,
    command,
    loadTrack,
  });

  return Object.freeze({
    startNextRound(party) {
      return partyRounds.startNextPartyRound(party, roundDependencies);
    },
    revealCurrentRound(party, requested = {}) {
      return partyRounds.revealCurrentPartyRound(
        party,
        requested,
        roundDependencies
      );
    },
    commitFinished(party) {
      return partyResults.commitFinishedParty(party, playerStore);
    },
  });
}

module.exports = {create};
