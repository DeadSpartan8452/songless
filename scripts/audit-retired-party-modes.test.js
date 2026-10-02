'use strict';

const assert = require('assert');
const modes = require('../lib/mode-registry');
const partyStore = require('../lib/party');

const modeId = process.argv[2];
assert.ok(['joker', 'missions'].includes(modeId), 'mode retiré attendu');
assert.strictEqual(modes.isRetiredPartyMode(modeId), true);
assert.strictEqual(modes.publicModes().some(mode => mode.id === modeId), false);
assert.strictEqual(modes.publicCatalog().some(mode => mode.id === modeId), false);
assert.throws(
  () => partyStore.create({ mode: modeId, totalRounds: 1 }),
  /retiré/i,
);

console.log(`OK  ${modeId} est retiré du catalogue et de la création`);
