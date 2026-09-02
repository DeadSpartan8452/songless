'use strict';

const assert = require('assert');
const blacklist = require('../lib/blacklist');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`OK  ${name}`);
}

const now = new Date('2026-09-02T12:00:00.000Z');
const tracks = [
  { id: 'one', title: 'One', artist: 'Alpha', genre: 'Rock', genreDetail: 'Indie', year: 1997, tags: ['route'] },
  { id: 'two', title: 'Two', artist: 'Beta', genre: 'Pop', genreDetail: 'Dance', year: 2004, tags: ['été'] },
  { id: 'three', title: 'Three', artist: 'Alpha', genre: 'Jazz', year: null, tags: [] },
];

const artistRule = blacklist.normalizeRule({
  id: 'artist-alpha',
  targetType: 'artist',
  targetValue: 'ÁLPHA',
  durationType: 'parties',
  durationAmount: 3,
  modes: ['solo_title'],
  reason: 'Déjà trop joué',
}, null, now);
assert.strictEqual(artistRule.remainingParties, 3);
assert.strictEqual(blacklist.matches(artistRule, tracks[0], 'solo_title', now), true);
assert.strictEqual(blacklist.matches(artistRule, tracks[0], 'classic', now), false);
ok('une exclusion normalise la cible et respecte les modes choisis');

for (const [targetType, targetValue, index] of [
  ['track', 'two', 1],
  ['genre', 'Jazz', 2],
  ['theme', 'ÉTÉ', 1],
  ['year', '1997', 0],
  ['decade', '2000s', 1],
]) {
  const rule = blacklist.normalizeRule({
    targetType, targetValue, durationType: 'days', durationAmount: 2,
  }, null, now);
  assert.strictEqual(blacklist.matches(rule, tracks[index], 'duel', now), true, targetType);
}
ok('les six types de cible sont reconnus sans traduire les métadonnées');

const evaluated = blacklist.evaluate(tracks, [artistRule], 'solo_title', now);
assert.deepStrictEqual(evaluated.allowed.map(track => track.id), ['two']);
assert.strictEqual(evaluated.excluded[0].rules[0].reason, 'Déjà trop joué');
ok('l’aperçu retourne les morceaux restants et la raison visible');

const consumedOnce = blacklist.consumeParty([artistRule], 'solo_title', now);
assert.strictEqual(consumedOnce[0].remainingParties, 2);
const notConsumed = blacklist.consumeParty(consumedOnce, 'classic', now);
assert.strictEqual(notConsumed[0].remainingParties, 2);
const consumedTwice = blacklist.consumeParty(
  blacklist.consumeParty(notConsumed, 'solo_title', now),
  'solo_title',
  now
);
assert.deepStrictEqual(consumedTwice, []);
ok('la durée en parties diminue seulement dans la portée concernée puis se purge');

const timed = blacklist.normalizeRule({
  targetType: 'genre', targetValue: 'Pop', durationType: 'hours', durationAmount: 2,
}, null, now);
assert.strictEqual(timed.endsAt, '2026-09-02T14:00:00.000Z');
assert.strictEqual(blacklist.isExpired(timed, '2026-09-02T13:59:59.000Z'), false);
assert.strictEqual(blacklist.isExpired(timed, '2026-09-02T14:00:00.000Z'), true);
assert.deepStrictEqual(blacklist.purgeExpired([timed], '2026-09-02T14:00:00.000Z'), []);
ok('les durées horaires expirent et sont automatiquement purgées');

const until = blacklist.normalizeRule({
  targetType: 'year', targetValue: 2004, durationType: 'until',
  until: '2026-09-10T18:30:00.000Z', modes: ['all'],
}, null, now);
assert.strictEqual(until.endsAt, '2026-09-10T18:30:00.000Z');
assert.throws(() => blacklist.normalizeRule({
  targetType: 'year', targetValue: '', durationType: 'days', durationAmount: 1,
}, null, now), /cible/);
assert.throws(() => blacklist.normalizeRule({
  targetType: 'year', targetValue: 2004, durationType: 'until', until: '2026-01-01',
}, null, now), /futur/);
ok('la date de fin personnalisée et les erreurs de saisie sont validées');

const disabled = blacklist.normalizeRule({ ...until, active: false }, until, now);
assert.strictEqual(blacklist.matches(disabled, tracks[1], 'classic', now), false);
ok('une exclusion peut être levée immédiatement sans être supprimée');

console.log(`\n${passed} tests de blacklist réussis.`);
