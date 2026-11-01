'use strict';

const assert = require('assert');
require('../public/audio-sync');
const sync = globalThis.SonglessAudioSync;

assert.strictEqual(sync.outputLatencySeconds({ outputLatency: 0.08, baseLatency: 0.02 }), 0.08);
assert.strictEqual(sync.outputLatencySeconds({ baseLatency: 0.03 }), 0.03);
assert.strictEqual(sync.outputLatencySeconds({ outputLatency: 2 }), 0.25);
assert.strictEqual(sync.manualTrimSeconds(400), 0.25);
assert.strictEqual(sync.manualTrimSeconds(-80), 0);
assert.ok(Math.abs(sync.contentOffsetSeconds({ outputLatency: 0.08 }, 40, 1.5) - 0.18) < 1e-9);
assert.ok(Math.abs(sync.contentOffsetSeconds({ outputLatency: 0.08 }, 0, 1) - 0.08) < 1e-9);
assert.strictEqual(sync.contentOffsetSeconds(null, 0, 1), 0);
assert.strictEqual(sync.estimatedServerNow(1000, 500, 1500), 2000);
assert.strictEqual(sync.remainingStartDelay(3000, 1000, 500, 1500), 1000);
assert.strictEqual(sync.remainingStartDelay(3000, 1000, 500, 2500), 0);

console.log('OK  latence de sortie estimée, trim borné et vitesse compensée');
console.log('OK  délai de départ recalculé depuis l’ancre conservée pendant le chargement audio');
