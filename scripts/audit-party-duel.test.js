const assert = require('assert');
const duel = require('../lib/party-duel');

let passed = 0;
function test(label, run) {
  run();
  passed++;
  console.log(`OK  ${label}`);
}

test('le meilleur premier joueur tire la corde de son côté', () => {
  const party = {
    duelScore: 0,
    players: [{ earnedPoints: 800 }, { earnedPoints: 200 }],
    teams: [],
  };
  assert.strictEqual(duel.resolveReveal(party), true);
  assert.strictEqual(party.duelScore, -25);
});

test('le meilleur second joueur tire la corde dans l’autre sens', () => {
  const party = {
    duelScore: 0,
    players: [{ earnedPoints: 100 }, { earnedPoints: 900 }],
    teams: [],
  };
  duel.resolveReveal(party);
  assert.strictEqual(party.duelScore, 25);
});

test('une égalité ne déplace pas la corde', () => {
  const party = {
    duelScore: 25,
    players: [{ earnedPoints: 500 }, { earnedPoints: 500 }],
    teams: [],
  };
  duel.resolveReveal(party);
  assert.strictEqual(party.duelScore, 25);
});

test('un duel en équipes additionne les points de chaque camp', () => {
  const party = {
    duelScore: 0,
    teams: [{ id: 'red' }, { id: 'blue' }],
    players: [
      { teamId: 'red', earnedPoints: 200 },
      { teamId: 'red', earnedPoints: 300 },
      { teamId: 'blue', earnedPoints: 450 },
    ],
  };
  assert.deepStrictEqual(duel.roundScores(party), [500, 450]);
  duel.resolveReveal(party);
  assert.strictEqual(party.duelScore, -25);
});

test('la corde reste toujours bornée entre les deux extrémités', () => {
  const party = {
    duelScore: -90,
    players: [{ earnedPoints: 1000 }, { earnedPoints: 0 }],
    teams: [],
  };
  duel.resolveReveal(party);
  assert.strictEqual(party.duelScore, -100);
});

console.log(`\n${passed} tests Duel réussis.`);
