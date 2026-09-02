'use strict';

const assert = require('assert');
const confidence = require('../lib/party-confidence');
const partyStore = require('../lib/party');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function party() {
  const created = partyStore.create({
    mode: 'confidence', totalRounds: 4, seed: 'confidence-audit',
    settings: { answer: 'titre', points: 1000, paliers: [0.2, 0.7, 2.5, 5, 9, 15] },
  });
  const player = partyStore.join(created.party.code, {
    id: 'p1', nom: 'Joueur test', emoji: '🎧', multiplayer: {},
  }).player;
  partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: 'track-1',
    answer: { title: 'Bonne réponse', artist: 'Artiste', mode: 'titre' },
  });
  created.party.roundStartedAt = Date.now() - 10;
  created.party.playback.startedAt = Date.now() - 10;
  return { ...created, player };
}

test('seules les trois mises serveur sont acceptées', () => {
  const player = { score: 1000 };
  confidence.resetPlayer(player);
  assert.strictEqual(confidence.select(player, 3).multiplier, 3);
  assert.throws(() => confidence.select(player, 99), /invalide/i);
});

test('la perte est plafonnée à 30 % et le score reste positif', () => {
  assert.strictEqual(confidence.maximumLoss(100, 5000, 3), 30);
  assert.strictEqual(confidence.maximumLoss(0, 5000, 3), 0);
});

test('une bonne réponse triple réellement les points en Panache', () => {
  const ctx = party();
  partyStore.playerAction(ctx.party, ctx.player.token, 'set-confidence', { multiplier: 3 });
  partyStore.playerAction(ctx.party, ctx.player.token, 'answer', { answer: 'Bonne réponse' });
  assert.ok(ctx.player.earnedPoints >= 3000);
  assert.strictEqual(ctx.player.confidenceStats.correct, 1);
  assert.strictEqual(ctx.player.confidenceStats.totalStaked, 3);
});

test('une mauvaise réponse prélève la mise puis prépare le prochain essai', () => {
  const ctx = party();
  ctx.player.score = 1000;
  partyStore.playerAction(ctx.party, ctx.player.token, 'set-confidence', { multiplier: 3 });
  partyStore.playerAction(ctx.party, ctx.player.token, 'answer', { answer: 'Raté' });
  assert.strictEqual(ctx.player.score, 700);
  assert.strictEqual(ctx.player.confidenceLastDelta, -300);
  assert.strictEqual(ctx.player.confidenceStake, 1);
  assert.strictEqual(ctx.player.confidenceLocked, false);
});

test('le navigateur ne peut ni forger ni changer une mise après envoi', () => {
  const ctx = party();
  assert.throws(() => partyStore.playerAction(
    ctx.party, ctx.player.token, 'set-confidence', { multiplier: 7 }), /invalide/i);
  ctx.player.confidenceLocked = true;
  assert.throws(() => partyStore.playerAction(
    ctx.party, ctx.player.token, 'set-confidence', { multiplier: 2 }), /verrouillée/i);
});

test('l’état public expose l’aperçu et le bilan calculés par le serveur', () => {
  const ctx = party();
  ctx.player.score = 1000;
  partyStore.playerAction(ctx.party, ctx.player.token, 'set-confidence', { multiplier: 2 });
  const state = partyStore.publicState(ctx.party, ctx.player.token, null);
  const me = state.players.find(item => item.profileId === 'p1');
  assert.strictEqual(me.confidence.preview.multiplier, 2);
  assert.strictEqual(me.confidence.preview.maximumLoss, 250);
  assert.strictEqual(me.confidence.stats.answers, 0);
});

test('Confiance conserve les paliers, le passage et le vote progressif', () => {
  const ctx = party();
  partyStore.playerAction(ctx.party, ctx.player.token, 'skip');
  assert.strictEqual(ctx.player.currentAttempt, 1);
  partyStore.playerAction(ctx.party, ctx.player.token, 'vote-next-step');
  assert.ok(ctx.party.currentStep >= 1);
});

console.log(`\n${passed} tests Confiance réussis.`);
