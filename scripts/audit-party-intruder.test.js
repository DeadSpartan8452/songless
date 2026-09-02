'use strict';

const assert = require('assert');
const intruder = require('../lib/party-intruder');
const partyStore = require('../lib/party');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

const tracks = [
  { id: 'a', title: 'Alpha', artist: 'Même artiste', year: 1991, genre: 'Pop', theme: 'Été' },
  { id: 'b', title: 'Bravo', artist: 'Même artiste', year: 1994, genre: 'Pop', theme: 'Été' },
  { id: 'c', title: 'Charlie', artist: 'Même artiste', year: 1998, genre: 'Pop', theme: 'Été' },
  { id: 'd', title: 'Delta', artist: 'Autre artiste', year: 2001, genre: 'Rock', theme: 'Hiver' },
  { id: 'e', title: 'Echo', artist: 'Encore ailleurs', year: 2003, genre: 'Jazz', theme: 'Nuit' },
];

function activeParty() {
  const created = partyStore.create({
    mode: 'intruder', totalRounds: 3, seed: 'intruder-party-audit',
    settings: { points: 700 },
  });
  const first = partyStore.join(created.party.code, {
    id: 'intruder-p1', nom: 'Joueur un', emoji: '🕵️', multiplayer: {},
  }).player;
  const second = partyStore.join(created.party.code, {
    id: 'intruder-p2', nom: 'Joueur deux', emoji: '🔎', multiplayer: {},
  }).player;
  const challenge = intruder.generate(tracks, {
    seed: 'intruder-party-audit', round: 1, totalRounds: 3,
  });
  partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: challenge.answerId, intruderChallenge: challenge,
  });
  return { ...created, first, second, challenge };
}

test('la difficulté progresse en privilégiant des dimensions annoncées', () => {
  assert.strictEqual(intruder.preferredDimensions(1, 9).difficulty, 'easy');
  assert.strictEqual(intruder.preferredDimensions(5, 9).difficulty, 'medium');
  assert.strictEqual(intruder.preferredDimensions(9, 9).difficulty, 'hard');
});

test('un défi certain contient trois éléments communs et un seul intrus', () => {
  const challenge = intruder.generate(tracks, { seed: 'audit', round: 1, totalRounds: 9 });
  assert.ok(challenge);
  assert.strictEqual(challenge.options.length, 4);
  assert.strictEqual(challenge.options.filter(option => option.id === challenge.answerId).length, 1);
  assert.match(challenge.explanation, /Trois morceaux/);
});

test('la même seed produit exactement la même question', () => {
  const first = intruder.generate(tracks, { seed: 'stable', round: 5, totalRounds: 9 });
  const second = intruder.generate([...tracks].reverse(), { seed: 'stable', round: 5, totalRounds: 9 });
  assert.deepStrictEqual(first, second);
});

test('une bibliothèque insuffisante interdit toute génération incertaine', () => {
  assert.strictEqual(intruder.generate(tracks.slice(0, 3), { seed: 'non' }), null);
  assert.strictEqual(intruder.generate([
    { id: '1', title: 'Un' }, { id: '2', title: 'Deux' },
    { id: '3', title: 'Trois' }, { id: '4', title: 'Quatre' },
  ]), null);
});

test('la réponse et la justification restent secrètes avant révélation', () => {
  const challenge = intruder.generate(tracks, { seed: 'secret' });
  const hidden = intruder.publicChallenge(challenge, false);
  assert.strictEqual(hidden.answerId, null);
  assert.strictEqual(hidden.explanation, null);
  const revealed = intruder.publicChallenge(challenge, true);
  assert.strictEqual(revealed.answerId, challenge.answerId);
  assert.ok(revealed.explanation);
});

test('l’état public cache le verdict pendant la manche puis le révèle', () => {
  const context = activeParty();
  const hidden = partyStore.publicState(context.party, context.first.token, null);
  assert.strictEqual(hidden.intruderChallenge.answerId, null);
  assert.strictEqual(hidden.intruderChallenge.explanation, null);
  partyStore.command(context.party, context.hostToken, 'reveal', { reason: 'manual' });
  const revealed = partyStore.publicState(context.party, context.first.token, null);
  assert.strictEqual(revealed.intruderChallenge.answerId, context.challenge.answerId);
  assert.strictEqual(revealed.intruderChallenge.explanation, context.challenge.explanation);
});

test('un choix inconnu et une seconde réponse sont refusés', () => {
  const context = activeParty();
  assert.throws(() => partyStore.playerAction(
    context.party, context.first.token, 'intruder-answer', { optionId: 'inconnu' }), /invalide/i);
  partyStore.playerAction(context.party, context.first.token, 'intruder-answer', {
    optionId: context.challenge.answerId,
  });
  assert.throws(() => partyStore.playerAction(
    context.party, context.first.token, 'intruder-answer', {
      optionId: context.challenge.answerId,
    }), /déjà envoyée/i);
});

test('le serveur attribue les points uniquement à une bonne réponse', () => {
  const context = activeParty();
  const wrongId = context.challenge.options.find(option => (
    option.id !== context.challenge.answerId)).id;
  partyStore.playerAction(context.party, context.first.token, 'intruder-answer', {
    optionId: context.challenge.answerId,
    points: 999999,
  });
  partyStore.playerAction(context.party, context.second.token, 'intruder-answer', {
    optionId: wrongId,
    points: 999999,
  });
  assert.strictEqual(context.first.score, 700);
  assert.strictEqual(context.first.earnedPoints, 700);
  assert.strictEqual(context.second.score, 0);
  assert.strictEqual(context.second.earnedPoints, 0);
  assert.strictEqual(context.party.roundDecision, 'all_finished');
});

console.log(`\n${passed} tests Intrus réussis.`);
