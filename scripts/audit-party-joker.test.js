'use strict';

const assert = require('assert');
const joker = require('../lib/party-joker');
const partyStore = require('../lib/party');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function activeParty() {
  const created = partyStore.create({
    mode: 'joker', totalRounds: 4, seed: 'joker-audit',
    settings: { answer: 'titre', points: 1000, paliers: [1, 3, 6, 10] },
  });
  const player = partyStore.join(created.party.code, {
    id: 'joker-p1', nom: 'Joueur Joker', emoji: '🃏', multiplayer: {},
  }).player;
  partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: 'joker-track', playback: { offset: 5 },
    answer: { title: 'Bonne réponse', artist: 'Artiste', mode: 'titre' },
  });
  created.party.roundStartedAt = Date.now() - 1;
  created.party.playback.startedAt = Date.now() - 1;
  return { ...created, player };
}

test('chaque joueur reçoit exactement les mêmes trois jokers limités', () => {
  const first = {};
  const second = {};
  joker.initializePlayer(first);
  joker.initializePlayer(second);
  assert.deepStrictEqual(first.jokers, second.jokers);
  assert.deepStrictEqual(Object.keys(first.jokers), ['replay', 'extension', 'double']);
});

test('la seconde écoute relance le serveur et ne peut servir qu’une fois', () => {
  const context = activeParty();
  const before = context.party.playback.startedAt;
  partyStore.playerAction(context.party, context.player.token, 'joker-use', { jokerId: 'replay' });
  assert.ok(context.party.playback.startedAt > before);
  assert.throws(() => partyStore.playerAction(
    context.party, context.player.token, 'joker-use', { jokerId: 'replay' }), /déjà été utilisé/i);
});

test('la rallonge ajoute exactement trois secondes avec une borne', () => {
  const context = activeParty();
  const before = context.party.playback.duration;
  partyStore.playerAction(context.party, context.player.token, 'joker-use', { jokerId: 'extension' });
  assert.strictEqual(context.party.playback.duration, before + 3);
  context.party.playback.duration = 29;
  context.player.jokers.extension = 1;
  joker.use(context.party, context.player, 'extension');
  assert.strictEqual(context.party.playback.duration, 30);
});

test('le multiplicateur double uniquement les points calculés par le serveur', () => {
  const context = activeParty();
  partyStore.playerAction(context.party, context.player.token, 'joker-use', { jokerId: 'double' });
  partyStore.playerAction(context.party, context.player.token, 'answer', {
    answer: 'Bonne réponse', points: 999999,
  });
  assert.ok(context.player.earnedPoints >= 2000);
  assert.ok(context.player.earnedPoints < 3000);
  assert.strictEqual(context.player.score, context.player.earnedPoints);
});

test('un joker inconnu, épuisé ou utilisé après la manche est refusé', () => {
  const context = activeParty();
  assert.throws(() => partyStore.playerAction(
    context.party, context.player.token, 'joker-use', { jokerId: 'triche' }), /inconnu/i);
  context.player.finished = true;
  assert.throws(() => partyStore.playerAction(
    context.party, context.player.token, 'joker-use', { jokerId: 'double' }), /terminée/i);
});

console.log(`\n${passed} tests Joker réussis.`);
