'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-title-alias-'));
process.env.SONGLESS_CACHE_DIR = cacheDir;
const musicbrainz = require('../lib/musicbrainz');

async function main() {
  const originalFetch = global.fetch;
  const originalTimeout = global.setTimeout;
  let calls = 0;
  global.setTimeout = callback => { callback(); return 0; };
  global.fetch = async url => {
    calls++;
    if (String(url).includes('/01234567-89ab-cdef-0123-456789abcdef?')) {
      return { ok: true, json: async () => ({ aliases: [
        { name: '夜に駆ける', locale: 'ja', primary: true },
        { name: 'Running into the Night', locale: 'en', primary: true },
        { name: 'Courir dans la nuit', locale: 'fr', primary: false },
      ] }) };
    }
    return { ok: true, json: async () => ({ recordings: [{
      id: '01234567-89ab-cdef-0123-456789abcdef', score: 100,
      title: '夜に駆ける', 'artist-credit': [{ name: 'Artiste synthétique' }],
      tags: [{ name: 'pop', count: 3 }],
    }] }) };
  };

  try {
    assert.strictEqual(musicbrainz.choisirAliasTraduit('夜に駆ける', [
      { name: '夜に駆ける', locale: 'ja' },
      { name: 'Running into the Night', locale: 'en' },
      { name: 'Courir dans la nuit', locale: 'fr' },
    ]), 'Courir dans la nuit');
    assert.strictEqual(musicbrainz.choisirAliasTraduit('An English title', [
      { name: 'Titre français', locale: 'fr' },
    ]), null);

    const result = await musicbrainz.enregistrement('夜に駆ける', 'Artiste synthétique', {
      language: 'ja',
    });
    assert.strictEqual(result.translatedTitle, 'Courir dans la nuit');
    assert.strictEqual(calls, 2);

    const excluded = await musicbrainz.enregistrement('夜に駆ける', 'Artiste synthétique', {
      language: 'fr',
    });
    assert.strictEqual(excluded.translatedTitle, undefined);
    assert.strictEqual(calls, 2);

    console.log('OK  MusicBrainz localise les titres non latins par alias français/anglais/espagnol');
    console.log('OK  les titres latins et les langues exclues ne reçoivent pas de titre traduit');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalTimeout;
    fs.rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.SONGLESS_CACHE_DIR;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
