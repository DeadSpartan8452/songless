'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const handicap = require('../lib/party-handicap');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function party(enabled = true) {
  return {
    settings: { smartHandicap: enabled },
    players: [
      { profileId: 'fort', score: 1500, sessionAnswers: 5, sessionCorrect: 5, globalStats: { answers: 20, correct: 18 } },
      { profileId: 'aide', score: 0, sessionAnswers: 5, sessionCorrect: 1, globalStats: { answers: 20, correct: 5 } },
    ],
  };
}

test('l’option désactivée ne modifie strictement rien', () => {
  const value = party(false);
  assert.strictEqual(handicap.compute(value, value.players[0]).multiplier, 1);
  assert.strictEqual(handicap.applyPoints({}, 1000), 1000);
});

test('le coup de pouce et le défi restent dans des bornes crédibles', () => {
  const value = party();
  const strong = handicap.compute(value, value.players[0]);
  const helped = handicap.compute(value, value.players[1]);
  assert.ok(strong.multiplier >= 0.85 && strong.multiplier < 1);
  assert.ok(helped.multiplier > 1 && helped.multiplier <= 1.2);
  assert.match(strong.explanation, /points ×/);
  assert.match(helped.explanation, /points ×/);
});

test('les statistiques trop courtes restent neutres', () => {
  const value = {
    settings: { smartHandicap: true },
    players: [{ score: 2000 }],
  };
  const player = { score: 0, sessionAnswers: 0, sessionCorrect: 0, globalStats: { answers: 2, correct: 2 } };
  value.players.push(player);
  assert.strictEqual(handicap.compute(value, player).multiplier, 1);
});

test('le serveur applique seul le multiplicateur annoncé', () => {
  const player = { smartHandicap: { multiplier: 1.17 } };
  assert.strictEqual(handicap.applyPoints(player, 1000), 1170);
});

test('le réglage et l’explication existent sur PC, contrôleur et TV', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('public/index.html'), /id="party-smart-handicap"/);
  assert.match(read('public/expansions.js'), /party-handicap-card/);
  assert.match(read('public/controller.js'), /handicap-card/);
  assert.match(read('public/tv.js'), /smartHandicap/);
});

console.log(`\n${passed} tests Handicap intelligent réussis.`);
