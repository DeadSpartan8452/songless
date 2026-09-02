'use strict';

const assert = require('assert');
const registry = require('../lib/mode-registry');
const partyStore = require('../lib/party');

const modes = registry.publicModes();

assert.deepStrictEqual(
  modes.map(mode => mode.id),
  ['classic', 'buzzer', 'royale', 'duel', 'confidence']
);
assert.strictEqual(new Set(modes.map(mode => mode.id)).size, modes.length);

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

console.log(`OK  registre de ${modes.length} modes et capacités validé`);
