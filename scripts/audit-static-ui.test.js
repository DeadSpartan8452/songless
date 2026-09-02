'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGES = ['index.html', 'controller.html', 'tv.html', 'remote.html'];
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

function read(name) {
  return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function attrs(html, attribute) {
  const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, 'gi');
  return [...html.matchAll(pattern)].map(match => match[1]);
}

for (const page of PAGES) {
  test(`${page} ne contient aucun identifiant dupliqué`, () => {
    const ids = attrs(read(page), 'id');
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test(`${page} référence uniquement des ressources locales présentes`, () => {
    const html = read(page);
    const resources = [...attrs(html, 'src'), ...attrs(html, 'href')]
      .filter(value => !value.startsWith('#') && !value.startsWith('/api/'))
      .filter(value => !/^(https?:|data:|mailto:|tel:)/i.test(value))
      .map(value => value.split(/[?#]/)[0])
      .filter(Boolean);
    for (const resource of resources) {
      const target = path.resolve(PUBLIC_DIR, resource.replace(/^\//, ''));
      assert.ok(target.startsWith(PUBLIC_DIR + path.sep), `Ressource hors public : ${resource}`);
      assert.ok(fs.existsSync(target), `Ressource absente : ${page} -> ${resource}`);
    }
  });
}

test('la TV contient les éléments indispensables au spectacle', () => {
  const html = read('tv.html');
  for (const id of ['party-code', 'round-label', 'hero-title', 'players', 'status']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('la télécommande expose seulement les commandes de partie limitées', () => {
  const html = read('remote.html');
  for (const id of ['next-btn', 'reveal-btn', 'lobby-btn', 'finish-btn']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(html, /library-section|upload|delete-track|hostToken/i);
});

test('les interfaces distantes ne chargent pas le code de la bibliothèque', () => {
  const remoteHtml = `${read('tv.html')}\n${read('remote.html')}\n${read('controller.html')}`;
  assert.doesNotMatch(remoteHtml, /src=["'](?:app|expansions)\.js["']/i);
});

test('les confirmations d’équipe ne s’affichent qu’après une action réussie', () => {
  const controller = read('controller.js');
  assert.doesNotMatch(controller, /playerAction\([^\n]+\)\.then\(\(\)\s*=>\s*toast/);
  assert.match(controller, /playerAction\('request-join-team',[\s\S]*?\.then\(success\s*=>\s*{\s*if \(success\) toast\('Demande envoyée/);
  assert.match(controller, /playerAction\('create-team',[\s\S]*?\.then\(success\s*=>\s*{\s*if \(success\) toast\(`Équipe/);
});

test('les trois champs de réponse exposent une liste accessible au clavier', () => {
  const index = read('index.html');
  const app = read('app.js');
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  assert.match(index, /id="guess-input"[\s\S]*?role="combobox"[\s\S]*?aria-controls="autocomplete-list"/);
  assert.match(index, /id="autocomplete-list"[\s\S]*?role="listbox"/);
  assert.match(controller, /id="answer-input"[\s\S]*?role="combobox"[\s\S]*?aria-controls="answer-suggestions"/);
  assert.match(expansions, /id="party-answer-input"[\s\S]*?role="combobox"[\s\S]*?aria-controls="party-answer-suggestions"/);
  for (const source of [app, controller, expansions]) {
    assert.match(source, /aria-activedescendant/);
    assert.match(source, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  }
});

test('le renommage post-révélation reste absent des interfaces distantes', () => {
  const distant = `${read('controller.html')}\n${read('tv.html')}\n${read('remote.html')}`;
  assert.match(read('index.html'), /id="edit-current-track-btn"/);
  assert.doesNotMatch(distant, /edit-current-track-btn|Renommer cette chanson/);
});

console.log(`\n${passed} tests statiques d’interface réussis.`);
