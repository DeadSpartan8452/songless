'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const titles = require('../lib/party-titles');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function party() {
  return {
    mode: 'confidence',
    cooperation: null,
    players: [
      {
        profileId: 'alpha', nom: 'Alpha', host: true, score: 5000,
        sessionRounds: 3, sessionCorrect: 3, correct: true,
        attempts: [{ type: 'success' }], lightningWins: 3,
        firstCorrectCount: 3, clutchWins: 0, totalGuesses: 3, lives: 3,
        confidenceStats: { answers: 3, correct: 3, totalStaked: 9, pointsWon: 5000, pointsLost: 0 },
      },
      {
        profileId: 'beta', nom: 'Beta', host: false, score: 200,
        sessionRounds: 3, sessionCorrect: 0, correct: false,
        attempts: [{ type: 'failed' }, { type: 'failed' }],
        lightningWins: 0, firstCorrectCount: 0, clutchWins: 0, totalGuesses: 6, lives: 3,
        confidenceStats: { answers: 3, correct: 0, totalStaked: 9, pointsWon: 0, pointsLost: 400 },
      },
    ],
    teams: [],
  };
}

test('le premier lot contient exactement cinquante modèles uniques', () => {
  assert.strictEqual(titles.TEMPLATES.length, 50);
  assert.strictEqual(new Set(titles.TEMPLATES.map(item => item.id)).size, 50);
  for (const template of titles.TEMPLATES) {
    assert.ok(Number(template.priority) > 0);
    assert.strictEqual(typeof template.when, 'function');
    assert.strictEqual(typeof template.evidence, 'function');
  }
});

test('les faits de manche alimentent artistes, genres et décennies', () => {
  const value = party();
  for (let index = 0; index < 3; index++) {
    value.revealedTrack = { title: `Titre ${index}`, artist: 'Coldplay', genre: 'Pop', year: 2005 };
    titles.recordRound(value);
  }
  assert.strictEqual(value.players[0].portraitStats.correctArtists.Coldplay, 3);
  assert.strictEqual(value.players[0].portraitStats.correctGenres.Pop, 3);
  assert.strictEqual(value.players[0].portraitStats.correctDecades['2000'], 3);
  assert.strictEqual(value.players[1].portraitStats.missedArtists.Coldplay, 3);
});

test('les titres remarquables priment et sont accompagnés de leur preuve', () => {
  const value = party();
  for (let index = 0; index < 3; index++) {
    value.revealedTrack = { title: `Titre ${index}`, artist: 'Coldplay', genre: 'Pop', year: 2005 };
    titles.recordRound(value);
  }
  titles.assign(value);
  assert.strictEqual(value.players[0].portraitTitles[0].label, 'Copie sans rature');
  assert.match(value.players[0].portraitTitles[0].evidence, /3\/3/);
  assert.ok(value.players[1].portraitTitles.some(item => /Coldplay/.test(item.label)));
  for (const player of value.players) {
    assert.ok(player.portraitTitles.length >= 1 && player.portraitTitles.length <= 3);
    assert.ok(player.portraitTitles.every(item => item.evidence.length >= 8));
  }
});

test('les variables dynamiques sont nettoyées et bornées', () => {
  const unsafe = `${'<script>musique</script>\u0000'.repeat(10)}`;
  const cleaned = titles.safeText(unsafe);
  assert.ok(!cleaned.includes('\u0000'));
  assert.ok(cleaned.length <= 60);
});

test('les interfaces échappent les titres et la TV utilise textContent', () => {
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'public', 'expansions.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.js'), 'utf8');
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.js'), 'utf8');
  assert.match(desktop, /escapeHtml\(title\.label\)/);
  assert.match(controller, /escapeHtml\(me\.portraitTitles\[0\]\.label\)/);
  assert.match(tv, /title\.textContent = portrait\.label/);
});

test('les portraits restent absents de l’état public avant le podium', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'party.js'), 'utf8');
  assert.match(source, /portraitTitles: party\.status === 'finished'/);
  assert.match(source, /titles\.assign\(party\)/);
  assert.match(source, /titles\.recordRound\(party\)/);
});

console.log(`\n${passed} tests des titres de podium réussis.`);
