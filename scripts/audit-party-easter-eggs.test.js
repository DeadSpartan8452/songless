'use strict';

const assert = require('assert');
const eggs = require('../lib/party-easter-eggs');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

function definition() {
  return eggs.sanitizeDefinition({
    id: 'portal', theme: 'portal', hint: 'Indice réservé au mode Indice',
    successText: 'Gâteau trouvé', failureText: 'The cake is a lie',
    revealText: 'Révélation Portal', secret: 'interdit',
  });
}

function player(overrides = {}) {
  return { profileId: 'p1', attempts: [], found: false, finished: false, correct: null, ...overrides };
}

function party(viewer, overrides = {}) {
  return { mode: 'classic', status: 'round', easterEgg: definition(), players: [viewer], ...overrides };
}

test('la définition est bornée et rejette les champs inconnus', () => {
  const value = definition();
  assert.strictEqual(value.id, 'portal');
  assert.strictEqual(Object.hasOwn(value, 'secret'), false);
});

test('Portal est un préréglage déclaratif activable par une métadonnée courte', () => {
  const value = eggs.sanitizeDefinition('portal');
  assert.strictEqual(value.id, 'portal');
  assert.strictEqual(value.theme, 'portal');
  assert.match(value.failureText, /cake is a lie/i);
  assert.ok(value.hint.length > 20);
});

test('aucun easter egg ne fuit avant un verdict', () => {
  const viewer = player();
  assert.strictEqual(eggs.publicState(party(viewer), viewer, 'player'), null);
});

test('un guess true autorise immédiatement l’easter egg du joueur', () => {
  const viewer = player({
    found: true, finished: true, correct: true,
    attempts: [{ type: 'success', step: 0 }],
  });
  assert.strictEqual(eggs.publicState(party(viewer), viewer, 'player').phase, 'success');
});

test('un guess false intermédiaire ne révèle rien', () => {
  const viewer = player({ attempts: [{ type: 'failed', step: 0 }], correct: false });
  assert.strictEqual(eggs.publicState(party(viewer), viewer, 'player'), null);
});

test('un guess false révèle seulement après épuisement des tentatives', () => {
  const viewer = player({
    finished: true, correct: false,
    attempts: [{ type: 'failed', step: 5 }],
  });
  assert.strictEqual(eggs.publicState(party(viewer), viewer, 'player').phase, 'failure');
});

test('un skip final ne vaut jamais guess false', () => {
  const viewer = player({
    finished: true, correct: false,
    attempts: [{ type: 'skipped', step: 5 }],
  });
  assert.strictEqual(eggs.playerVerdict(viewer), null);
  assert.strictEqual(eggs.publicState(party(viewer), viewer, 'player'), null);
});

test('le mode Indice est le seul à exposer un indice pendant la recherche', () => {
  const viewer = player();
  const classic = eggs.publicState(party(viewer), viewer, 'player');
  const clue = eggs.publicState(party(viewer, { mode: 'indice' }), viewer, 'player');
  assert.strictEqual(classic, null);
  assert.strictEqual(clue.phase, 'hint');
  assert.match(clue.text, /Indice/);
});

test('la TV célèbre un succès mais ne diffuse pas un échec individuel', () => {
  const winner = player({ found: true, finished: true, correct: true });
  assert.strictEqual(eggs.publicState(party(winner), null, 'tv').phase, 'success');
  const loser = player({
    finished: true, correct: false, attempts: [{ type: 'failed', step: 5 }],
  });
  assert.strictEqual(eggs.publicState(party(loser), null, 'tv'), null);
});

test('le PC hôte partage la célébration seulement après une réussite', () => {
  const winner = player({ found: true, finished: true, correct: true });
  assert.strictEqual(eggs.publicState(party(winner), null, 'host').phase, 'success');
  assert.strictEqual(eggs.publicState(party(player()), null, 'host'), null);
});

test('la révélation globale publie seulement le résultat final', () => {
  const viewer = player({ finished: true, correct: false, attempts: [{ type: 'skipped' }] });
  const state = eggs.publicState(party(viewer, { status: 'reveal' }), null, 'tv');
  assert.strictEqual(state.phase, 'reveal');
  assert.strictEqual(state.outcome, 'failure');
});

test('le rendu Portal reste absent du DOM sans charge utile publique', () => {
  const fs = require('fs');
  const path = require('path');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'easter-eggs.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'easter-eggs.css'), 'utf8');
  for (const html of ['index.html', 'controller.html', 'tv.html']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', html), 'utf8');
    assert.match(source, /easter-eggs\.js/);
    assert.match(source, /easter-eggs\.css/);
  }
  assert.match(script, /if \(!egg \|\| !egg\.id\)/);
  assert.match(script, /textContent = String\(value/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /portal-confetti/);
});

console.log(`\n${passed} tests easter eggs réussis.`);
