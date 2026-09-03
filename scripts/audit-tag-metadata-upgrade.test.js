'use strict';

const assert = require('assert');
const upgrade = require('../lib/tag-metadata-upgrade');

const tracks = {
  'sans-genre.mp3': { genre: 'Autre' },
  'meme-incertain.mp3': { genre: 'Meme / Internet' },
  'rock-fiable.mp3': {
    genre: 'Rock', genreSource: 'manual', genreConfidence: 'high',
  },
};
const present = new Set(Object.keys(tracks));

assert.deepStrictEqual(upgrade.proposalFor(tracks['sans-genre.mp3'], 'Rock'), {
  genre: 'Rock', genreSource: 'tag', genreConfidence: 'medium',
});
assert.deepStrictEqual(
  upgrade.proposalFor(tracks['sans-genre.mp3'], 'Pop', 'musicbrainz'),
  { genre: 'Pop', genreSource: 'musicbrainz', genreConfidence: 'medium' }
);
assert.strictEqual(upgrade.proposalFor(tracks['meme-incertain.mp3'], 'Rock'), null);
assert.strictEqual(upgrade.proposalFor(tracks['rock-fiable.mp3'], 'Pop'), null);
assert.strictEqual(upgrade.proposalFor({}, 'genre inconnu'), null);
assert.strictEqual(upgrade.proposalFor({}, 'Rock', 'inconnu'), null);

const valid = upgrade.validatePlan({ changes: {
  'sans-genre.mp3': { genre: 'Rock', title: 'Titre interdit' },
  'meme-incertain.mp3': { genre: 'Rock' },
  'absent.mp3': { genre: 'Pop' },
}}, tracks, present);
assert.deepStrictEqual(valid, {
  'sans-genre.mp3': {
    genre: 'Rock', genreSource: 'tag', genreConfidence: 'medium',
  },
});
assert.throws(() => upgrade.validatePlan({ changes: [] }, tracks, present), /Aperçu invalide/);

console.log('OK  aperçu des genres tagué, sans écrasement ni champ étranger');
