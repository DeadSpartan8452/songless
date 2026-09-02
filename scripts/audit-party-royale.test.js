const assert = require('assert');
const royale = require('../lib/party-royale');

let passed = 0;
function test(label, run) {
  run();
  passed++;
  console.log(`OK  ${label}`);
}

function player(profileId, lives = 3, found = false) {
  return { profileId, lives, found, isGhost: lives <= 0 };
}

function party(players) {
  return {
    mode: 'royale',
    players,
    royalePeakSurvivors: 0,
    finalDuel: null,
  };
}

test('le pic de survivants ignore les joueurs déjà éliminés', () => {
  const state = party([player('a'), player('b'), player('c', 0)]);
  assert.strictEqual(royale.notePeakSurvivors(state), 2);
});

test('un duel final exige au moins trois survivants dans la partie', () => {
  const state = party([player('a'), player('b')]);
  royale.notePeakSurvivors(state);
  assert.strictEqual(royale.activateFinalDuel(state), false);
  state.royalePeakSurvivors = 3;
  assert.strictEqual(royale.activateFinalDuel(state, 1234), true);
  assert.strictEqual(state.finalDuel.startedAt, 1234);
  assert.deepStrictEqual(
    state.finalDuel.contenders.map(contender => contender.profileId),
    ['a', 'b']
  );
});

test('une révélation retire une seule vie aux joueurs en échec', () => {
  const state = party([player('a', 2, true), player('b', 2, false), player('c', 1, false)]);
  royale.notePeakSurvivors(state);
  royale.resolveReveal(state, () => {});
  assert.strictEqual(state.players[0].lives, 2);
  assert.strictEqual(state.players[1].lives, 1);
  assert.strictEqual(state.players[2].lives, 0);
  assert.strictEqual(state.players[2].isGhost, true);
  assert.strictEqual(state.finalDuel.active, true);
});

test('une égalité de duel ne donne aucun point', () => {
  const state = party([player('a', 1, true), player('b', 1, true)]);
  state.royalePeakSurvivors = 3;
  royale.activateFinalDuel(state);
  royale.resolveReveal(state, () => {});
  assert.deepStrictEqual(state.finalDuel.contenders.map(item => item.wins), [0, 0]);
  assert.strictEqual(state.finalDuel.tiedRounds, 1);
  assert.strictEqual(state.finalDuel.roundResult, 'both_correct');
});

test('le premier à deux points déclenche la fin avec le vrai vainqueur', () => {
  const state = party([player('a', 1, true), player('b', 1, false)]);
  state.royalePeakSurvivors = 3;
  royale.activateFinalDuel(state);
  const finishes = [];
  const finish = (...args) => finishes.push(args);
  royale.resolveReveal(state, finish);
  state.players[0].found = true;
  state.players[1].found = false;
  royale.resolveReveal(state, finish);
  assert.strictEqual(state.finalDuel.active, false);
  assert.strictEqual(state.finalDuel.winnerProfileId, 'a');
  assert.strictEqual(finishes[0][1], 'final_duel');
  assert.strictEqual(finishes[0][2], 'a');
});

console.log(`\n${passed} tests Battle Royale réussis.`);
