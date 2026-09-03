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

test('le panneau téléphone centralise les QR TV et télécommande de façon sûre', () => {
  const index = read('index.html');
  const expansions = read('expansions.js');
  assert.match(index, /id="party-device-qr-grid"/);
  assert.match(expansions, /for \(const role of \['tv', 'remote_admin'\]\)/);
  assert.match(expansions, /\/api\/party\/\$\{encodeURIComponent\(party\.code\)\}\/access-qr\.svg/);
  assert.match(expansions, /\['http:', 'https:'\]\.includes\(parsed\.protocol\)/);
  assert.match(expansions, /if \(deviceQrGrid\)/);
});

test('le panneau Android expose clairement l’état et la mise à jour antivirus', () => {
  const index = read('index.html');
  const app = read('app.js');
  const css = read('features.css');
  assert.match(index, /id="mobile-antivirus-state"/);
  assert.match(index, /id="mobile-antivirus-update"/);
  assert.match(app, /\/api\/antivirus\/status/);
  assert.match(app, /\/api\/antivirus\/update/);
  assert.match(css, /\.mobile-antivirus-state\.ready/);
  assert.match(css, /\.mobile-antivirus-state\.error/);
});

test('le sélecteur Android importe un dossier entier avant de rafraîchir la bibliothèque', () => {
  const index = read('index.html');
  const app = read('app.js');
  const css = read('features.css');
  assert.match(index, /id="mobile-folder-picker"/);
  assert.match(index, /id="mobile-folder-state"/);
  assert.match(app, /choose-music-folder/);
  assert.match(app, /songless-folder-result/);
  assert.match(app, /\/api\/android\/import-folder/);
  assert.match(app, /afficherRapportImport\(rapport\)[\s\S]*?loadLibrary\(\)/);
  assert.match(css, /\.mobile-folder-panel/);
});

test('l’hôte Android reçoit des textes de bibliothèque adaptés à sa plateforme', () => {
  const index = read('index.html');
  const app = read('app.js');
  assert.match(index, /id="mobile-host-note"/);
  assert.match(index, /mobile-library-intro hidden/);
  assert.match(index, /<!-- Import d'une playlist entière -->\s*<div class="download-card desktop-downloader-only">/);
  assert.match(index, /<!-- Diagnostic de bibliothèque -->\s*<div class="download-card">/);
  assert.match(app, /if \(info\.mobileHost\)/);
  assert.match(app, /Prévu pour Android/);
  assert.match(app, /phone-address-list/);
});

test('la bibliothèque Android compacte les longues lignes sans couper leurs actions', () => {
  const css = read('session.css');
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /\.mobile-host \.track-item\s*\{[\s\S]*?grid-template-columns:\s*16px 40px minmax\(0, 1fr\) repeat\(4, 30px\)/);
  assert.match(css, /\.mobile-host \.genre-badge\.small,[\s\S]*?\.mobile-host \.preview-time\s*\{\s*display:\s*none/);
  assert.match(css, /\.mobile-host \.tracks-bulk-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.mobile-host \.tracks-bulk-actions\.hidden\s*\{\s*display:\s*none/);
});

test('les filtres de bibliothèque couvrent genre précis, année et favoris sans renommer', () => {
  const index = read('index.html');
  const app = read('app.js');
  for (const id of [
    'library-genre-filter',
    'library-genre-detail-filter',
    'library-year-filter',
    'library-favorite-filter',
  ]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /data-genre-detail/);
  assert.match(app, /data-year/);
  assert.match(app, /data-favorite/);
  assert.doesNotMatch(app, /filterLibraryDisplay[\s\S]*?patch\.title/);
});

test('toutes les interfaces utilisent le favicon local sans le confondre avec une pochette', () => {
  for (const page of PAGES) {
    assert.match(read(page), /<link\s+rel=["']icon["']\s+href=["']favicon\.svg["']/i);
  }
  assert.doesNotMatch(read('app.js'), /favicon\.svg[^\n]*(?:cover|pochette)/i);
});

test('le classement en lot exige un aperçu distinct avant application', () => {
  const index = read('index.html');
  const app = read('app.js');
  for (const id of [
    'bulk-classify-btn',
    'bulk-classify-modal',
    'bulk-classify-preview-btn',
    'bulk-classify-apply-btn',
    'bulk-preview-list',
  ]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /fetch\('\/api\/tracks\/meta-preview'/);
  assert.match(app, /fetch\('\/api\/tracks\/meta-apply'/);
  assert.match(app, /bulkMetadataPreviewToken/);
});

test('la blacklist exige un aperçu, filtre le solo et reste administrable', () => {
  const index = read('index.html');
  const app = read('app.js');
  for (const id of [
    'blacklist-target-type',
    'blacklist-duration-type',
    'blacklist-modes',
    'blacklist-preview-btn',
    'blacklist-add-btn',
    'blacklist-rules',
  ]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /blacklistPreviewFingerprint !== blacklistFormFingerprint\(\)/);
  assert.match(app, /if \(isTrackBlacklisted\(t\)\) return false/);
  assert.match(app, /data-blacklist-toggle/);
  assert.match(app, /data-blacklist-delete/);
});

test('le rendu de bibliothèque accepte les métadonnées numériques', () => {
  const app = read('app.js');
  assert.match(app, /return String\(text == null \? '' : text\)/);
  assert.match(app, /function renderLibraryMetadataFilters\(\) \{\s+const canonicalGenres/);
});

test('le comparateur de doublons reste manuel, réversible et sans suppression', () => {
  const index = read('index.html');
  const comparison = read('duplicate-comparison.js');
  for (const id of [
    'duplicate-review-card', 'duplicate-review-btn', 'duplicate-review-list',
    'duplicate-decisions-btn', 'duplicate-decisions',
  ]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
  assert.match(comparison, /Conserver les deux · versions distinctes/);
  assert.match(comparison, /data-duplicate-restore/);
  assert.match(comparison, /\/api\/library\/duplicates\/decision/);
  assert.doesNotMatch(comparison, /fetch\(`?\/api\/tracks\/[^\n]+DELETE|Supprimer le fichier/);
});

test('le mode Confiance reste pilotable sur PC, contrôleur et TV', () => {
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  const tv = read('tv.js');
  assert.match(controller, /data-confidence/);
  assert.match(controller, /potentialGain/);
  assert.match(controller, /maximumLoss/);
  assert.match(expansions, /data-party-confidence/);
  assert.match(expansions, /profitability/);
  assert.match(tv, /stake\.multiplier/);
});

test('le mode Coopération montre objectif, rôle et contribution sur les trois écrans', () => {
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  const tv = read('tv.js');
  assert.match(controller, /cooperation-role/);
  assert.match(controller, /playerCoop\.contribution/);
  assert.match(expansions, /party-cooperation-progress/);
  assert.match(expansions, /Objectif collectif atteint/);
  assert.match(tv, /VERDICT COLLECTIF/);
  assert.match(tv, /ÉQUIPE/);
});

test('le mode Intrus propose quatre choix et révèle sa justification sur les trois écrans', () => {
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  const tv = read('tv.js');
  const tvHtml = read('tv.html');
  assert.match(controller, /data-intruder-option/);
  assert.match(controller, /challenge\.explanation/);
  assert.match(expansions, /data-party-intruder/);
  assert.match(expansions, /Bilan des enquêteurs/);
  assert.match(tv, /renderIntruder/);
  assert.match(tvHtml, /id="intruder-options"/);
});

test('le mode Enchères affiche durées, chrono et main active sur les trois écrans', () => {
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  const tv = read('tv.js');
  const tvHtml = read('tv.html');
  assert.match(controller, /data-auction-bid/);
  assert.match(controller, /auction-timer/);
  assert.match(expansions, /data-party-auction/);
  assert.match(expansions, /party-auction-timer/);
  assert.match(tv, /renderAuction/);
  assert.match(tvHtml, /id="auction-board"/);
});

test('le mode Joker expose le même inventaire limité sur PC, contrôleur et TV', () => {
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  const tv = read('tv.js');
  assert.match(controller, /data-joker-use/);
  assert.match(controller, /Double mise active/);
  assert.match(expansions, /data-party-joker/);
  assert.match(expansions, /party-joker-event/);
  assert.match(tv, /player\.joker\.inventory/);
  assert.match(tv, /state\.joker\.event/);
});

test('les Missions secrètes restent privées puis sont révélées au podium', () => {
  const controller = read('controller.js');
  const expansions = read('expansions.js');
  const tv = read('tv.js');
  assert.match(controller, /mission-card/);
  assert.match(controller, /récompense secrète jusqu’au podium/);
  assert.match(expansions, /party-mission-card/);
  assert.match(expansions, /Missions révélées/);
  assert.match(tv, /MISSIONS RÉVÉLÉES/);
});

test('les champs autonomes du PC possèdent un nom accessible explicite', () => {
  const index = read('index.html');
  const ids = [
    'guess-input', 'party-chat-input', 'collection-name', 'challenge-name',
    'party-code-input', 'download-query', 'download-title', 'playlist-url',
    'file-input', 'library-search',
  ];
  for (const id of ids) {
    const field = index.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*id=["']${id}["'][^>]*>`, 'i'));
    assert.ok(field, `Champ absent : ${id}`);
    assert.match(field[0], /aria-label=["'][^"']+["']/i, `Nom accessible absent : ${id}`);
  }
});

test('les interfaces hors TV reprennent la charte visuelle du Songless original', () => {
  const controllerHtml = read('controller.html');
  const controllerCss = read('controller.css');
  const remoteHtml = read('remote.html');
  const remoteCss = read('remote.css');
  const android = fs.readFileSync(
    path.join(__dirname, '..', 'mobile', 'android-host', 'App.tsx'),
    'utf8'
  );
  for (const css of [controllerCss, remoteCss]) {
    assert.match(css, /--bg:\s*#09090b/);
    assert.match(css, /--cta:\s*#7c3aed|--accent-2:\s*#7c3aed/);
    assert.match(css, /radial-gradient\(var\(--(?:panel-2|bg2)\) 1\.5px, transparent 1\.5px\)/);
    assert.match(css, /font-family:\s*["']?DM Sans/);
  }
  assert.match(controllerHtml, /Songless <small>Joueur<\/small>/);
  assert.match(remoteHtml, /Songless <span class="subtitle">Administration<\/span>/);
  assert.doesNotMatch(`${controllerHtml}\n${remoteHtml}\n${android}`, /RÉGIE DE POCHE|RÉGIE MOBILE/);
  assert.match(android, /backgroundColor: '#09090b'/);
  assert.match(android, /title: \{color: '#7c3aed'/);
});

console.log(`\n${passed} tests statiques d’interface réussis.`);
