'use strict';

const assert = require('assert');
const auction = require('../lib/party-auction');
const partyStore = require('../lib/party');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function party() {
  return {
    settings: { points: 1000 }, playback: null, roundDecision: null,
    players: [
      { profileId: 'a', connected: true, finished: false },
      { profileId: 'b', connected: true, finished: false },
      { profileId: 'c', connected: true, finished: false },
    ],
  };
}

function activeParty() {
  const created = partyStore.create({
    mode: 'auction', totalRounds: 3, seed: 'auction-party-audit',
    settings: { answer: 'titre', points: 1000 },
  });
  const first = partyStore.join(created.party.code, {
    id: 'auction-p1', nom: 'Joueur un', emoji: '🔨', multiplayer: {},
  }).player;
  const second = partyStore.join(created.party.code, {
    id: 'auction-p2', nom: 'Joueur deux', emoji: '⏱️', multiplayer: {},
  }).player;
  partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: 'auction-track', playback: { offset: 7 },
    answer: { title: 'Bonne réponse', artist: 'Artiste', mode: 'titre' },
  });
  return { ...created, first, second };
}

test('seules les durées annoncées et strictement positives sont acceptées', () => {
  assert.strictEqual(auction.validBid(0.5), 0.5);
  assert.strictEqual(auction.validBid(15), 15);
  assert.strictEqual(auction.validBid(0), null);
  assert.strictEqual(auction.validBid(-1), null);
  assert.strictEqual(auction.validBid(4), null);
});

test('la durée la plus ambitieuse gagne et lance exactement son extrait', () => {
  const value = party();
  auction.startRound(value, { offset: 12, speed: 1, direction: 'normal' }, 1000);
  auction.submitBid(value, value.players[0], 5, 1100);
  auction.submitBid(value, value.players[1], 2, 1200);
  auction.submitBid(value, value.players[2], 7, 1300);
  assert.strictEqual(value.auction.activeProfileId, 'b');
  assert.strictEqual(value.playback.duration, 2);
  assert.strictEqual(value.playback.offset, 12);
});

test('une égalité est départagée par réception puis par profil', () => {
  const value = party();
  auction.startRound(value, {}, 1000);
  auction.submitBid(value, value.players[1], 2, 1100);
  auction.submitBid(value, value.players[0], 2, 1100);
  auction.submitBid(value, value.players[2], 5, 1200);
  assert.strictEqual(value.auction.activeProfileId, 'a');
  assert.strictEqual(value.auction.tie, true);
  assert.match(value.auction.tieBreak, /première enchère reçue/i);
});

test('une mauvaise réponse transmet l’avantage au suivant', () => {
  const value = party();
  auction.startRound(value, {}, 1000);
  auction.submitBid(value, value.players[0], 1, 1100);
  auction.submitBid(value, value.players[1], 3, 1200);
  auction.submitBid(value, value.players[2], 5, 1300);
  auction.resolveWrong(value, 2000);
  assert.strictEqual(value.auction.activeProfileId, 'b');
  assert.strictEqual(value.playback.duration, 3);
});

test('les points augmentent quand la durée annoncée diminue', () => {
  assert.ok(auction.pointsFor(1000, 1) > auction.pointsFor(1000, 10));
  assert.strictEqual(auction.pointsFor(1000, -1), 0);
});

test('le multiplicateur mystère est visible puis appliqué au gain', () => {
  const context = activeParty();
  context.party.roundModifier = { multiplier: 2 };
  partyStore.playerAction(context.party, context.first.token, 'auction-bid', { seconds: 2 });
  partyStore.playerAction(context.party, context.second.token, 'auction-bid', { seconds: 3 });
  const shown = partyStore.publicState(context.party, context.first.token, null)
    .auction.options.find(option => option.seconds === 2).points;
  context.party.roundStartedAt = Date.now() - 1;
  context.party.playback.startedAt = Date.now() - 1;
  partyStore.playerAction(context.party, context.first.token, 'answer', {
    answer: 'Bonne réponse',
  });
  assert.strictEqual(shown, auction.pointsFor(1000, 2) * 2);
  assert.strictEqual(context.first.score, shown);
});

test('le Champ de Mines pénalise aussi une enchère ratée', () => {
  const context = activeParty();
  context.first.score = 500;
  context.party.roundModifier = { penaltyHeavy: 200 };
  partyStore.playerAction(context.party, context.first.token, 'auction-bid', { seconds: 1 });
  partyStore.playerAction(context.party, context.second.token, 'auction-bid', { seconds: 3 });
  context.party.roundStartedAt = Date.now() - 1;
  context.party.playback.startedAt = Date.now() - 1;
  partyStore.playerAction(context.party, context.first.token, 'answer', { answer: 'Raté' });
  assert.strictEqual(context.first.score, 300);
  assert.strictEqual(context.first.lastPenaltyPoints, 200);
});

test('les enchères adverses restent secrètes jusqu’à la clôture', () => {
  const value = party();
  const now = Date.now();
  auction.startRound(value, {}, now);
  auction.submitBid(value, value.players[0], 2, now + 100);
  const hidden = auction.publicState(value, value.players[1]);
  assert.strictEqual(hidden.bids.find(item => item.profileId === 'a').seconds, null);
  assert.strictEqual(auction.publicState(value, value.players[0])
    .bids.find(item => item.profileId === 'a').seconds, 2);
});

test('l’intégration refuse une enchère forgée et verrouille chaque joueur', () => {
  const context = activeParty();
  assert.throws(() => partyStore.playerAction(
    context.party, context.first.token, 'auction-bid', { seconds: -4 }), /impossible/i);
  partyStore.playerAction(context.party, context.first.token, 'auction-bid', { seconds: 2 });
  assert.throws(() => partyStore.playerAction(
    context.party, context.first.token, 'auction-bid', { seconds: 1 }), /verrouillée/i);
});

test('seul le gagnant répond puis une erreur transmet réellement la main', () => {
  const context = activeParty();
  partyStore.playerAction(context.party, context.first.token, 'auction-bid', { seconds: 1 });
  partyStore.playerAction(context.party, context.second.token, 'auction-bid', { seconds: 3 });
  context.party.roundStartedAt = Date.now() - 1;
  context.party.playback.startedAt = Date.now() - 1;
  assert.throws(() => partyStore.playerAction(
    context.party, context.second.token, 'answer', { answer: 'Bonne réponse' }), /pas à toi/i);
  partyStore.playerAction(context.party, context.first.token, 'answer', { answer: 'Raté' });
  assert.strictEqual(context.party.auction.activeProfileId, context.second.profileId);
  context.party.roundStartedAt = Date.now() - 1;
  context.party.playback.startedAt = Date.now() - 1;
  partyStore.playerAction(context.party, context.second.token, 'answer', {
    answer: 'Bonne réponse', points: 999999,
  });
  assert.strictEqual(context.second.score, auction.pointsFor(1000, 3));
  assert.strictEqual(context.party.roundDecision, 'solved');
});

test('l’état public annonce le chrono sans dévoiler les enchères scellées', () => {
  const context = activeParty();
  partyStore.playerAction(context.party, context.first.token, 'auction-bid', { seconds: 2 });
  const otherView = partyStore.publicState(context.party, context.second.token, null);
  const firstBid = otherView.auction.bids.find(item => item.profileId === context.first.profileId);
  assert.strictEqual(firstBid.submitted, true);
  assert.strictEqual(firstBid.seconds, null);
  assert.ok(otherView.auction.deadlineAt > Date.now());
});

console.log(`\n${passed} tests Enchères réussis.`);
