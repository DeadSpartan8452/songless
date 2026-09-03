const assert = require('assert');
const buzzer = require('../lib/party-buzzer');

let passed = 0;
function test(label, run) {
  run();
  passed++;
  console.log(`OK  ${label}`);
}

function player(id) {
  return {
    profileId: id,
    answer: null,
    score: 500,
    wrongAttempts: 0,
    roundPenaltyPoints: 0,
    lastPenaltyPoints: 0,
    sessionAnswers: 0,
    sessionCorrect: 0,
  };
}

function party(players) {
  return {
    mode: 'buzzer',
    players,
    settings: { points: 1000 },
    playback: { startedAt: 1000, pausedAt: null },
    buzzOrder: [],
    activeBuzzerProfileId: null,
    buzzerDeadline: null,
    buzzerSolvedByProfileId: null,
    firstFoundThisRound: false,
    roundModifier: null,
  };
}

test('le premier buzz verrouille la réponse et met la musique en pause', () => {
  const first = player('a');
  const state = party([first]);
  buzzer.begin(state, first, 2000);
  assert.strictEqual(state.activeBuzzerProfileId, 'a');
  assert.strictEqual(state.buzzerDeadline, 12000);
  assert.strictEqual(state.playback.pausedAt, 2000);
});

test('un second joueur ne peut pas voler un buzzer actif', () => {
  const first = player('a');
  const second = player('b');
  const state = party([first, second]);
  buzzer.begin(state, first, 2000);
  assert.throws(() => buzzer.begin(state, second, 2100), /répond déjà/);
});

test('une mauvaise réponse applique la pénalité puis reprend la musique', () => {
  const first = player('a');
  const state = party([first]);
  buzzer.begin(state, first, 2000);
  buzzer.submitAnswer(state, first, 'Mauvaise réponse', false, 2500);
  assert.strictEqual(first.score, 400);
  assert.strictEqual(first.answer, null);
  assert.strictEqual(first.buzzerBlockedUntil, 5500);
  assert.strictEqual(state.playback.pausedAt, null);
  assert.strictEqual(state.playback.startedAt, 1500);
});

test('le Champ de Mines applique les 200 points réellement annoncés', () => {
  const first = player('a');
  const state = party([first]);
  state.roundModifier = { penaltyHeavy: 200 };
  buzzer.begin(state, first, 2000);
  buzzer.submitAnswer(state, first, 'Mauvaise réponse', false, 2500);
  assert.strictEqual(first.score, 300);
  assert.strictEqual(first.lastPenaltyPoints, 200);
});

test('la Mort Subite interdit réellement une deuxième tentative', () => {
  const first = player('a');
  const state = party([first]);
  state.roundModifier = { singleAttempt: true };
  buzzer.begin(state, first, 2000);
  buzzer.submitAnswer(state, first, 'Mauvaise réponse', false, 2500);
  assert.strictEqual(first.finished, true);
  assert.throws(() => buzzer.begin(state, first, 6000), /terminés/i);
});

test('une bonne réponse attribue les points et ferme le buzzer', () => {
  const first = player('a');
  const state = party([first]);
  state.roundModifier = { multiplier: 1.5 };
  buzzer.begin(state, first, 2000);
  buzzer.submitAnswer(state, first, 'Bonne réponse', true, 2200);
  assert.strictEqual(first.score, 2000);
  assert.strictEqual(first.sessionCorrect, 1);
  assert.strictEqual(state.buzzerSolvedByProfileId, 'a');
});

test('un délai expiré compte une tentative et libère la main', () => {
  const first = player('a');
  const state = party([first]);
  buzzer.begin(state, first, 2000);
  buzzer.refresh(state, 12000);
  assert.strictEqual(first.lastAnswer, 'Temps écoulé');
  assert.strictEqual(first.sessionAnswers, 1);
  assert.strictEqual(state.activeBuzzerProfileId, null);
  assert.strictEqual(state.buzzerDeadline, null);
});

console.log(`\n${passed} tests Buzzer réussis.`);
