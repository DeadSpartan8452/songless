const assert = require('assert');
const answers = require('../lib/party-answers');

let passed = 0;
function test(label, run) {
  run();
  passed++;
  console.log(`OK  ${label}`);
}

test('les accents, espaces et signes ne changent pas une réponse', () => {
  assert.strictEqual(answers.cleanAnswer('  Éléonore — été ! '), 'eleonoreete');
});

test('les écritures non latines restent utilisables sans expressions Unicode natives', () => {
  assert.strictEqual(answers.cleanAnswer('宇多田 ヒカル！'), '宇多田ヒカル');
});

test('un titre original ou un alias reste accepté', () => {
  const spec = answers.cleanAnswerSpec({
    mode: 'titre',
    title: 'Titre affiché',
    originalTitle: 'Original Song',
    artist: 'Artiste test',
    aliases: ['Petit surnom'],
  });
  assert.strictEqual(answers.answerIsCorrect('Original Song', spec), true);
  assert.strictEqual(answers.answerIsCorrect('Petit surnom', spec), true);
  assert.strictEqual(answers.answerIsCorrect('mauvais titre', spec), false);
});

test('un artiste invité peut être donné séparément', () => {
  const spec = answers.cleanAnswerSpec({
    mode: 'artiste',
    artist: 'Artiste principal feat. Artiste invité',
  });
  assert.strictEqual(answers.answerIsCorrect('Artiste invité', spec), true);
});

test('une année accepte la tolérance annoncée de deux ans', () => {
  const spec = answers.cleanAnswerSpec({ mode: 'annee', year: 2000 });
  assert.strictEqual(answers.answerIsCorrect('1998', spec), true);
  assert.strictEqual(answers.answerIsCorrect('2003', spec), false);
});

test('une fiche de réponse est bornée avant d’entrer dans le moteur', () => {
  const spec = answers.cleanAnswerSpec({
    mode: 'inconnu',
    title: 'x'.repeat(250),
    aliases: Array.from({ length: 40 }, (_, index) => `alias-${index}`),
  });
  assert.strictEqual(spec.mode, 'titre');
  assert.strictEqual(spec.title.length, 200);
  assert.strictEqual(spec.aliases.length, 30);
});

console.log(`\n${passed} tests de réponses multijoueurs réussis.`);
