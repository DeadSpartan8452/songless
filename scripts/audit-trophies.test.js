'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SONGLESS_TROPHIES } = require('../public/trophies-data');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function trophyRuntime() {
  const storage = new Map();
  const element = () => ({
    className: '', innerHTML: '', innerText: '', parentNode: null,
    classList: { add() {}, remove() {} },
    appendChild(child) { child.parentNode = this; },
    removeChild() {},
  });
  const context = vm.createContext({
    console,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    document: {
      body: element(),
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
      createElement: element,
    },
    setTimeout() {},
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'trophies-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'trophies.js'), 'utf8'), context);
  return context.window.songlessTrophies;
}

test('le catalogue contient 105 succès historiques, 100 séries et le secret Portal', () => {
  assert.strictEqual(SONGLESS_TROPHIES.length, 206);
  assert.strictEqual(new Set(SONGLESS_TROPHIES.map(item => item.id)).size, 206);
  assert.strictEqual(SONGLESS_TROPHIES.filter(item => item.rule).length, 101);
  const portal = SONGLESS_TROPHIES.find(item => item.id === 'secret_portal_cake');
  assert.ok(portal && portal.hidden);
  assert.deepStrictEqual(portal.rule.where, { id: 'portal', outcome: 'success' });
});

test('chaque nouveau succès possède un texte précis et une condition bornée', () => {
  for (const trophy of SONGLESS_TROPHIES.filter(item => item.rule)) {
    assert.match(trophy.id, /^[a-z0-9_]+$/);
    assert.ok(trophy.name.length >= 4);
    assert.ok(trophy.desc.length >= 20);
    assert.ok(trophy.rule.event);
    assert.ok(Number(trophy.rule.target) >= 1);
  }
  assert.ok(SONGLESS_TROPHIES.filter(item => item.hidden).length >= 8);
});

test('le moteur progresse, déduplique et débloque les conditions déclaratives', () => {
  const trophies = trophyRuntime();
  trophies.record('round', {
    win: true, firstTry: true, late: false, mode: 'confidence', special: true,
    trackKey: 'Premier titre|Artiste A', artist: 'Artiste A',
  }, 'partie-1:1');
  let ids = new Set(trophies.getUnlockedIds());
  for (const id of ['journey_rounds_1', 'journey_wins_1', 'mastery_first_try_1',
    'specialist_rounds_1', 'mode_confidence_play', 'mode_confidence_win']) {
    assert.ok(ids.has(id), id);
  }

  trophies.record('round', {
    win: true, firstTry: true, late: false, mode: 'confidence', special: true,
    trackKey: 'Premier titre|Artiste A', artist: 'Artiste A',
  }, 'partie-1:1');
  trophies.record('round', {
    win: false, firstTry: false, late: false, mode: 'classic', special: false,
    trackKey: 'Deuxième titre|Artiste B', artist: 'Artiste B',
  }, 'partie-1:2');
  ids = new Set(trophies.getUnlockedIds());
  assert.ok(ids.has('library_tracks_2'));
  assert.ok(ids.has('library_artists_2'));
  assert.ok(!ids.has('journey_rounds_3'), 'l’événement dupliqué ne doit pas compter deux fois');
});

test('les soirées utilisent leur propre compteur persistant', () => {
  const trophies = trophyRuntime();
  trophies.record('party_finished', { mode: 'classic', win: false }, 'A');
  trophies.record('party_finished', { mode: 'classic', win: true }, 'B');
  const ids = new Set(trophies.getUnlockedIds());
  assert.ok(ids.has('party_sessions_1'));
  assert.ok(ids.has('party_sessions_2'));
});

test('aucun déclencheur direct ne pointe vers un identifiant absent', () => {
  const ids = new Set(SONGLESS_TROPHIES.map(item => item.id));
  for (const relative of ['public/trophies.js', 'public/controller.js', 'public/expansions.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    for (const match of source.matchAll(/(?:^|\.)unlock\('([^']+)'/gm)) {
      assert.ok(ids.has(match[1]), `${relative}: ${match[1]}`);
    }
  }
});

test('les succès cachés masquent leur nom et leur condition avant déblocage', () => {
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'public', 'trophies.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.js'), 'utf8');
  assert.match(desktop, /hiddenLocked[^]*Succès secret/);
  assert.match(controller, /hiddenLocked[^]*Condition cachée/);
});

console.log(`\n${passed} tests du catalogue de succès réussis.`);
