'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const souvenir = require('../public/souvenir-card');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

function party() {
  return {
    code: 'SECRET', inviteUrls: { lan: 'http://192.168.1.2:3000/?pair=secret' },
    mode: 'confidence', round: 12, winnerProfileId: 'p2',
    players: [
      { profileId: 'p1', nom: 'Nom privé 1', emoji: '🎹', score: 4200,
        session: { correct: 8, rounds: 12 },
        portraitTitles: [{ label: 'Métronome', evidence: '8/12 réponses.' }] },
      { profileId: 'p2', nom: 'Nom privé 2', emoji: '🥁', score: 3900,
        session: { correct: 7, rounds: 12 },
        portraitTitles: [{ label: 'Roi du duel', evidence: 'Vainqueur final.' }] },
      { profileId: 'p3', nom: 'Nom privé 3', emoji: '🎸', score: 1200,
        session: { correct: 3, rounds: 12 } },
    ],
  };
}

test('la carte est anonyme par défaut et ne transporte aucun accès', () => {
  const model = souvenir.buildModel(party());
  const serialized = JSON.stringify(model);
  assert.deepStrictEqual(model.players.map(player => player.name), ['Joueur 1', 'Joueur 2', 'Joueur 3']);
  assert.ok(!/Nom privé|SECRET|192\.168|profileId|invite/i.test(serialized));
  assert.match(model.privacy, /anonyme/i);
});

test('le vainqueur explicite reste premier malgré un score inférieur', () => {
  const model = souvenir.buildModel(party());
  assert.strictEqual(model.players[0].score, 3900);
  assert.strictEqual(model.players[0].title, 'Roi du duel');
});

test('les pseudos exigent un choix explicite et restent bornés', () => {
  const value = party();
  value.players[0].nom = '<script>'.repeat(20);
  const anonymous = souvenir.buildModel(value);
  const named = souvenir.buildModel(value, { showNames: true });
  assert.strictEqual(anonymous.players[1].name, 'Joueur 2');
  assert.strictEqual(named.players[0].name, 'Nom privé 2');
  assert.match(named.players[1].name, /^<script>/);
  assert.ok(named.players[1].name.length <= 24);
});

test('le résumé accessible et le texte respectent le même modèle privé', () => {
  const model = souvenir.buildModel(party());
  const output = `${souvenir.summary(model)}\n${souvenir.text(model)}`;
  assert.match(output, /Confiance/);
  assert.match(output, /Joueur 1/);
  assert.ok(!/Nom privé|SECRET|192\.168/.test(output));
});

test('l’interface expose PNG, résumé accessible et réduction des mouvements', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'expansions.js'), 'utf8');
  assert.match(html, /id="souvenir-card-canvas"/);
  assert.match(html, /id="souvenir-show-names"/);
  assert.match(html, /aria-describedby="souvenir-card-summary"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(js, /ClipboardItem/);
  assert.match(js, /songless-carte-souvenir\.png/);
});

console.log(`\n${passed} tests de carte souvenir réussis.`);
