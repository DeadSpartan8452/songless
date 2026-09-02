'use strict';

const assert = require('assert');
const quality = require('../lib/track-quality');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

test('un morceau sans défaut connu est prêt mais la couverture reste explicite', () => {
  const result = quality.assess({ coverKnown: true });
  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.score, 100);
  assert.ok(result.unknownChecks.includes('audioSignal'));
  assert.ok(result.unknownChecks.includes('encodingQuality'));
});

test('un défaut gênant demande une vérification avec une raison lisible', () => {
  const result = quality.assess({
    coverKnown: true,
    issues: [{ type: 'sans-annee', gravite: 'genant', detail: 'Année inconnue.' }],
  });
  assert.strictEqual(result.status, 'review');
  assert.ok(result.score < 100);
  assert.strictEqual(result.reasons[0].type, 'sans-annee');
});

test('un fichier illisible est problématique', () => {
  const result = quality.assess({
    issues: [{ type: 'illisible', gravite: 'bloquant', detail: 'Fichier vide.' }],
  });
  assert.strictEqual(result.status, 'problematic');
});

test('le risque de doublon concerne aussi le premier morceau du groupe', () => {
  const result = quality.assess({ duplicateRisk: true });
  assert.strictEqual(result.status, 'review');
  assert.ok(result.reasons.some(reason => reason.type === 'doublon'));
});

test('une analyse profonde marque le signal audio comme réellement contrôlé', () => {
  const result = quality.assess({ deep: true });
  assert.ok(result.assessedChecks.includes('audioSignal'));
  assert.ok(!result.unknownChecks.includes('audioSignal'));
  assert.ok(result.unknownChecks.includes('encodingQuality'));
});

test('les mesures techniques retirent réellement les inconnues correspondantes', () => {
  const result = quality.assess({
    coverKnown: true,
    coverDimensionsKnown: true,
    encodingKnown: true,
  });
  assert.ok(result.assessedChecks.includes('coverDimensions'));
  assert.ok(result.assessedChecks.includes('encodingQuality'));
  assert.ok(!result.unknownChecks.includes('coverDimensions'));
  assert.ok(!result.unknownChecks.includes('encodingQuality'));
});

console.log(`\n${passed} tests d'indice de qualité réussis.`);
