'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const registry = require('../lib/mode-registry');
const partyStore = require('../lib/party');

const modes = registry.publicModes();
const catalog = registry.publicCatalog();

assert.deepStrictEqual(
  modes.map(mode => mode.id),
  ['classic', 'buzzer', 'royale', 'duel', 'confidence', 'cooperation', 'intruder', 'auction', 'joker', 'missions']
);
assert.strictEqual(new Set(modes.map(mode => mode.id)).size, modes.length);
assert.deepStrictEqual(
  catalog.filter(mode => mode.kind === 'local').map(mode => mode.id),
  ['solo_limited', 'solo_infinite', 'solo_duel', 'solo_royale', 'training', 'collections', 'challenges'],
);
assert.strictEqual(new Set(catalog.map(mode => mode.id)).size, catalog.length);

for (const mode of modes) {
  assert.match(mode.id, /^[a-z][a-z0-9_-]*$/);
  assert.ok(mode.label && mode.shortLabel && mode.emoji && mode.summary);
  assert.ok(Number.isInteger(mode.minPlayers) && mode.minPlayers >= 1);
  assert.ok(mode.surfaces.includes('host'));
  assert.ok(mode.surfaces.includes('controller'));
  assert.ok(mode.surfaces.includes('tv'));
  assert.ok(mode.surfaces.includes('remote_admin'));
  assert.strictEqual(typeof mode.capabilities.elimination, 'boolean');
  assert.strictEqual(typeof mode.capabilities.teams, 'boolean');
  assert.strictEqual(typeof mode.capabilities.mystery, 'boolean');
  assert.ok(mode.guide && mode.guide.duration && mode.guide.winCondition);
  assert.ok(Array.isArray(mode.guide.playerActions) && mode.guide.playerActions.length >= 2);
  assert.ok(Array.isArray(mode.guide.hostControls) && mode.guide.hostControls.length >= 2);
  assert.ok(mode.guide.tvContent);
  assert.deepStrictEqual(mode.guide.compatibility, { local: true, remote: true });
}
assert.strictEqual(modes.find(mode => mode.id === 'intruder').capabilities.mystery, false);
assert.strictEqual(modes.filter(mode => mode.id !== 'intruder').every(mode => mode.capabilities.mystery), true);

for (const mode of catalog.filter(item => item.kind === 'local')) {
  assert.deepStrictEqual(mode.surfaces, ['host']);
  assert.deepStrictEqual(mode.guide.compatibility, { local: true, remote: false });
  assert.ok(mode.guide.duration && mode.guide.winCondition && mode.guide.tvContent);
}

assert.strictEqual(registry.normalizeModeId('inconnu'), 'classic');
assert.strictEqual(registry.hasCapability('buzzer', 'buzzer'), true);
assert.strictEqual(registry.hasCapability('royale', 'elimination'), true);
assert.strictEqual(registry.hasCapability('classic', 'elimination'), false);

const created = partyStore.create({ mode: 'royale', totalRounds: 5 });
const state = partyStore.publicState(created.party, null, created.hostToken);
assert.strictEqual(state.modeDefinition.id, 'royale');
assert.strictEqual(state.modeDefinition.capabilities.elimination, true);
assert.strictEqual(JSON.stringify(state).includes(created.hostToken), false);

const expansions = fs.readFileSync(path.join(__dirname, '..', 'public', 'expansions.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'expansions.css'), 'utf8');
assert.match(expansions, /card\.id = id/);
assert.match(expansions, /Fiche du mode sélectionné/);
assert.match(expansions, /guide\.winCondition/);
assert.match(expansions, /guide\.playerActions\.join/);
assert.match(expansions, /guide\.hostControls\.join/);
assert.match(expansions, /guide\.tvContent/);
assert.match(expansions, /renderLocalModeGuides/);
for (const id of ['solo_limited', 'solo_infinite', 'solo_duel', 'solo_royale', 'training', 'collections', 'challenges']) {
  assert.match(expansions, new RegExp(`['"]${id}['"]`));
}
assert.ok((expansions.match(/results:\s*\[\]/g) || []).length >= 4);
assert.match(expansions, /startLimited\(rounds <= 0 \? 'infinite' : rounds, 'format'/);
assert.match(expansions, /startLimited\(format === '0' \? 'infinite' : Number\(format\), 'collection'/);
assert.match(expansions, /item\.totalRounds === 'infinite'[\s\S]*?challengeTotal/);
assert.match(expansions, /Arrêter et voir le bilan/);
assert.match(expansions, /game-session-stop/);
assert.match(expansions, /modesTab\.click\(\)/);
assert.match(expansions, /mode !== 'intruder' && Boolean\(source\.mystery\)/);
assert.match(expansions, /mysteryContainer\.classList\.toggle\('hidden', !mysteryAllowed\)/);
assert.match(css, /\.party-mode-guide/);
assert.match(css, /\.local-session-stop/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.party-mode-guide/);

console.log(`OK  catalogue de ${catalog.length} formats, dont ${modes.length} modes multijoueurs, validé`);
