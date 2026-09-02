'use strict';

const assert = require('assert');
const cooperation = require('../lib/party-cooperation');
const partyStore = require('../lib/party');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function makeParty(players = 3) {
  const created = partyStore.create({
    mode: 'cooperation', totalRounds: 6, seed: 'coop-audit',
    settings: { answer: 'titre', points: 1000, paliers: [0.2, 0.7, 2.5, 5, 9, 15] },
  });
  const joined = [];
  for (let index = 0; index < players; index++) {
    joined.push(partyStore.join(created.party.code, {
      id: `p${index + 1}`, nom: `Joueur ${index + 1}`, emoji: '🎧', multiplayer: {},
    }).player);
  }
  partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: 'track-1',
    answer: { title: 'Bonne réponse', artist: 'Artiste', mode: 'titre' },
  });
  created.party.roundStartedAt = Date.now() - 10;
  created.party.playback.startedAt = Date.now() - 10;
  return { ...created, players: joined };
}

test('les rôles complémentaires tournent sans choix du navigateur', () => {
  const ctx = makeParty();
  assert.deepStrictEqual(ctx.players.map(player => player.cooperationRole), ['ear', 'relay', 'anchor']);
});

test('une bonne réponse alimente le commun et la contribution individuelle', () => {
  const ctx = makeParty(2);
  partyStore.playerAction(ctx.party, ctx.players[0].token, 'answer', { answer: 'Bonne réponse' });
  assert.ok(ctx.party.cooperation.sharedPoints > ctx.players[0].earnedPoints);
  assert.strictEqual(ctx.party.cooperation.sharedPoints, ctx.players[0].cooperationContribution);
});

test('l’Ancre protège une seule vie sans récompenser un échec', () => {
  const ctx = makeParty(3);
  cooperation.resolveReveal(ctx.party);
  assert.strictEqual(ctx.party.cooperation.lives, 3);
  assert.strictEqual(ctx.party.cooperation.shieldUsed, true);
  ctx.party.cooperation.roundResolved = false;
  cooperation.resolveReveal(ctx.party);
  assert.strictEqual(ctx.party.cooperation.lives, 2);
  assert.strictEqual(ctx.party.cooperation.sharedPoints, 0);
});

test('la série donne un verdict collectif, sauf si la survie est épuisée', () => {
  const ctx = makeParty(2);
  ctx.party.cooperation.bestStreak = ctx.party.cooperation.targetStreak;
  assert.strictEqual(cooperation.finish(ctx.party), 'won');
  ctx.party.cooperation.lives = 0;
  assert.strictEqual(cooperation.finish(ctx.party), 'lost');
});

test('l’état public donne progression, survie, rôles et contributions', () => {
  const ctx = makeParty(2);
  const state = partyStore.publicState(ctx.party, ctx.players[0].token, null);
  assert.ok(state.cooperation.targetPoints > 0);
  assert.strictEqual(state.cooperation.lives, 3);
  assert.strictEqual(state.cooperation.roles.length, 3);
  assert.strictEqual(state.players[0].cooperation.role.id, 'ear');
});

test('une manche coopérative refuse de démarrer avec un seul joueur', () => {
  const created = partyStore.create({ mode: 'cooperation', totalRounds: 3 });
  partyStore.join(created.party.code, {
    id: 'solo', nom: 'Solo', emoji: '🎧', multiplayer: {},
  });
  assert.throws(() => partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: 'track', answer: { title: 'Titre', mode: 'titre' },
  }), /au moins 2 joueurs/i);
});

console.log(`\n${passed} tests Coopération réussis.`);
