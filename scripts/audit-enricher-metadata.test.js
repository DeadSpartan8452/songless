'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const enricher = require('../lib/enricher');
const musicbrainz = require('../lib/musicbrainz');
const titles = require('../lib/titles');

(async () => {
  const root = path.join(__dirname, '..');
  for (const tool of ['enrich.js', 'years.js']) {
    const help = spawnSync(process.execPath, [path.join(root, 'tools', tool), '--help'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SONGLESS_MUSIC_DIR: path.join(root, 'dossier-inexistant-test'),
        SONGLESS_CACHE_DIR: path.join(root, 'cache-inexistant-test'),
      },
      windowsHide: true,
    });
    assert.strictEqual(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage/);
  }

  const overrides = titles.loadOverrides();

  const inferred = await enricher.ficheDeBase(
    'Artiste test - Chanson rock.mp3',
    overrides
  );
  assert.strictEqual(inferred.genre, 'Rock');
  assert.strictEqual(inferred.genreSource, 'filename');
  assert.strictEqual(inferred.genreConfidence, 'low');

  const curated = await enricher.ficheDeBase('Polish Cow.mp3', overrides);
  assert.strictEqual(curated.genre, 'Meme / Internet');
  assert.strictEqual(curated.genreSource, 'manual');
  assert.strictEqual(curated.genreConfidence, 'high');

  const originalLookup = musicbrainz.genreArtiste;
  try {
    musicbrainz.genreArtiste = async () => ({ genre: 'Électro / EDM' });
    const completed = await enricher.completerGenre({
      title: 'Sans genre',
      artist: 'Artiste catalogue',
      genre: null,
      genreSource: 'unknown',
      genreConfidence: 'unknown',
    });
    assert.strictEqual(completed.genre, 'Électro / EDM');
    assert.strictEqual(completed.genreSource, 'musicbrainz');
    assert.strictEqual(completed.genreConfidence, 'medium');
  } finally {
    musicbrainz.genreArtiste = originalLookup;
  }

  const unknown = enricher.finaliser({
    fileName: 'inconnu.mp3',
    title: 'Inconnu',
    originalTitle: '',
    artist: '',
    genre: null,
    aliases: [],
  }, overrides);
  assert.strictEqual(unknown.genre, 'Autre');
  assert.strictEqual(unknown.genreSource, 'unknown');
  assert.strictEqual(unknown.genreConfidence, 'unknown');

  console.log('OK  provenance et confiance des genres enrichis contrôlées');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
