const assert = require('assert');
const engine = require('../lib/party-suggestions');

let passed = 0;
function test(label, run) {
  run();
  passed++;
  console.log(`OK  ${label}`);
}

const fileNames = [
  'alpha.mp3',
  'beta.mp3',
  'beta-copy.mp3',
  'gamma.mp3',
];
const metadata = {
  'alpha.mp3': {
    title: 'Lumière du matin', artist: 'Les Horizons', year: 2001,
    originalTitle: 'Morning Light', aliases: ['Aube claire'],
  },
  'beta.mp3': { title: 'Nuit électrique', artist: 'Nova', year: 1999 },
  'beta-copy.mp3': { title: 'Autre titre', artist: 'Nova', year: 1999 },
  'gamma.mp3': { title: 'Voyage lointain', artist: 'Orbite' },
};

test('les marqueurs de variante sont stabilisés sans réordonner le vrai titre', () => {
  const titles = require('../lib/titles');
  assert.strictEqual(
    titles.suggestionVariantKey('Promet pas la lune Nightcore'),
    titles.suggestionVariantKey('Nightcore Promet pas la lune')
  );
  assert.notStrictEqual(
    titles.suggestionVariantKey('Amour toujours'),
    titles.suggestionVariantKey('Toujours amour')
  );
});

test('une même version Nightcore ne produit qu\u2019une proposition', () => {
  const variants = ['nightcore-fin.mp3', 'nightcore-debut.mp3'];
  const variantMetadata = {
    'nightcore-fin.mp3': {
      title: 'Promet pas la lune Nightcore', artist: 'Artiste test',
    },
    'nightcore-debut.mp3': {
      title: 'Nightcore Promet pas la lune', artist: 'Artiste test',
    },
  };
  const result = engine.suggestions({
    query: 'promet', answerMode: 'titre',
    fileNames: variants, metadata: variantMetadata,
  });
  assert.strictEqual(result.length, 1);
});

test('un préfixe de titre est proposé avec son artiste', () => {
  const result = engine.suggestions({
    query: 'lumi', answerMode: 'titre', fileNames, metadata,
  });
  assert.strictEqual(result[0].primary, 'Lumière du matin');
  assert.match(result[0].secondary, /Les Horizons/);
});

test('un titre original et un alias restent recherchables', () => {
  const original = engine.suggestions({
    query: 'morning', answerMode: 'titre', fileNames, metadata,
  });
  const alias = engine.suggestions({
    query: 'aube', answerMode: 'titre', fileNames, metadata,
  });
  assert.strictEqual(original[0].primary, 'Lumière du matin');
  assert.strictEqual(alias[0].primary, 'Lumière du matin');
});

test('les artistes et années identiques sont dédoublonnés', () => {
  const artists = engine.suggestions({
    query: 'nova', answerMode: 'artiste', fileNames, metadata,
  });
  const years = engine.suggestions({
    query: '1999', answerMode: 'annee', fileNames, metadata,
  });
  assert.strictEqual(artists.filter(item => item.value === 'Nova').length, 1);
  assert.strictEqual(years.filter(item => item.value === '1999').length, 1);
});

test('les morceaux sans année ne polluent pas le mode année', () => {
  const result = engine.suggestions({
    query: 'orbite', answerMode: 'annee', fileNames, metadata,
  });
  assert.deepStrictEqual(result, []);
});

test('une faute légère est tolérée seulement avec une requête assez longue', () => {
  assert.ok(engine.suggestions({
    query: 'lumire', answerMode: 'titre', fileNames, metadata,
  }).length > 0);
  assert.deepStrictEqual(engine.suggestions({
    query: 'nva', answerMode: 'artiste', fileNames, metadata,
  }), []);
});

test('la liste propose jusqu’à seize résultats par défaut sans dépasser le plafond', () => {
  const manyFiles = Array.from({ length: 30 }, (_, index) => `titre-${index}.mp3`);
  const manyMetadata = Object.fromEntries(manyFiles.map((file, index) => [file, {
    title: `Chanson commune numéro ${index}`,
    artist: `Artiste ${index}`,
  }]));
  const defaultResults = engine.suggestions({
    query: 'chanson', answerMode: 'titre', fileNames: manyFiles, metadata: manyMetadata,
  });
  const cappedResults = engine.suggestions({
    query: 'chanson', answerMode: 'titre', fileNames: manyFiles,
    metadata: manyMetadata, limit: 100,
  });
  assert.strictEqual(defaultResults.length, 16);
  assert.strictEqual(cappedResults.length, 24);
});

console.log(`\n${passed} tests de suggestions multijoueurs réussis.`);
