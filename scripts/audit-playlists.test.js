'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const playlists = require('../lib/playlists');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}
function base(overrides = {}) {
  return playlists.cleanPlaylist({ id: 'pl_test', nom: 'Soirée test', collaborative: true,
    quotaPerPlayer: 10, reservePerPlayer: 2, status: 'collecting',
    settings: { hideOthers: true, fairOrder: true, avoidSameArtist: true }, ...overrides });
}

test('migration transparente des anciennes collections', () => {
  const item = playlists.cleanPlaylist({ id: 'c_old', nom: 'Ancienne', trackIds: ['a', 'b', 'a'] });
  assert.equal(item.id, 'c_old');
  assert.deepEqual(item.trackIds, ['a', 'b']);
  assert.equal(item.status, 'draft');
});
test('quotas limités aux valeurs prévues', () => {
  assert.equal(base({ quotaPerPlayer: 20 }).quotaPerPlayer, 20);
  assert.equal(base({ quotaPerPlayer: 17 }).quotaPerPlayer, 0);
});
test('quota principal imposé côté moteur', () => {
  const item = base();
  for (let i = 0; i < 10; i++) playlists.addTrack(item,
    { trackId: `t${i}`, profileId: 'p1', profileName: 'Joueur 1' });
  assert.throws(() => playlists.addTrack(item,
    { trackId: 't10', profileId: 'p1', profileName: 'Joueur 1' }), /10 morceaux principaux/);
});
test('réserves plafonnées séparément', () => {
  const item = base();
  playlists.addTrack(item, { trackId: 'r1', profileId: 'p1', profileName: 'Joueur 1', reserve: true });
  playlists.addTrack(item, { trackId: 'r2', profileId: 'p1', profileName: 'Joueur 1', reserve: true });
  assert.throws(() => playlists.addTrack(item,
    { trackId: 'r3', profileId: 'p1', profileName: 'Joueur 1', reserve: true }), /2 morceaux de réserve/);
});
test('crédit commun sans morceau en double', () => {
  const item = base();
  playlists.addTrack(item, { trackId: 'same', profileId: 'p1', profileName: 'Joueur 1' });
  const result = playlists.addTrack(item, { trackId: 'same', profileId: 'p2', profileName: 'Joueur 2' });
  assert.equal(result.duplicate, true);
  assert.deepEqual(item.trackIds, ['same']);
  assert.equal(item.contributions.length, 2);
});
test('retrait individuel sans supprimer le choix partagé', () => {
  const item = base();
  playlists.addTrack(item, { trackId: 'same', profileId: 'p1', profileName: 'Joueur 1' });
  playlists.addTrack(item, { trackId: 'same', profileId: 'p2', profileName: 'Joueur 2' });
  playlists.removeContribution(item, 'same', 'p1');
  assert.deepEqual(item.trackIds, ['same']);
  playlists.removeContribution(item, 'same', 'p2');
  assert.deepEqual(item.trackIds, []);
});
test('collecte verrouillée côté moteur', () => {
  const item = base({ status: 'locked' });
  assert.throws(() => playlists.addTrack(item,
    { trackId: 'x', profileId: 'p1', profileName: 'Joueur 1' }), /collecte.*fermée/i);
});
test('alternance équitable entre contributeurs', () => {
  const item = base({ trackIds: [] });
  ['a1', 'a2', 'a3'].forEach(trackId => playlists.addTrack(item,
    { trackId, profileId: 'a', profileName: 'A' }));
  ['b1', 'b2'].forEach(trackId => playlists.addTrack(item,
    { trackId, profileId: 'b', profileName: 'B' }));
  assert.deepEqual(playlists.fairOrder(item), ['a1', 'b1', 'a2', 'b2', 'a3']);
});
test('artistes consécutifs évités quand possible', () => {
  const item = base({ trackIds: [] });
  playlists.addTrack(item, { trackId: 'a1', profileId: 'a', profileName: 'A' });
  playlists.addTrack(item, { trackId: 'b1', profileId: 'b', profileName: 'B' });
  playlists.addTrack(item, { trackId: 'b2', profileId: 'b', profileName: 'B' });
  const map = new Map([['a1', { artist: 'Même' }], ['b1', { artist: 'Même' }],
    ['b2', { artist: 'Autre' }]]);
  assert.deepEqual(playlists.fairOrder(item, map), ['a1', 'b2', 'b1']);
});
test('équilibre supplémentaire entre équipes', () => {
  const item = base({ trackIds: [], contributions: [] });
  ['a1', 'a2', 'a3'].forEach(trackId => playlists.addTrack(item,
    { trackId, profileId: 'p1', profileName: 'A' }));
  ['b1', 'b2'].forEach(trackId => playlists.addTrack(item,
    { trackId, profileId: 'p2', profileName: 'B' }));
  const party = { settings: { teamsMode: true }, players: [
    { profileId: 'p1', teamId: 'rouge' }, { profileId: 'p2', teamId: 'bleu' },
  ] };
  assert.deepEqual(playlists.balanceTeams(['a1', 'a2', 'a3', 'b1', 'b2'], item, party),
    ['a1', 'b1', 'a2', 'b2', 'a3']);
});
test('limite de propositions adaptée au quota de la collecte', () => {
  assert.equal(playlists.proposalLimit(base({ quotaPerPlayer: 10, reservePerPlayer: 2 }), true), 12);
  assert.equal(playlists.proposalLimit(base({ quotaPerPlayer: 20, reservePerPlayer: 2 }), true), 22);
  assert.equal(playlists.proposalLimit(base({ quotaPerPlayer: 50, reservePerPlayer: 2 }), true), 52);
  assert.equal(playlists.proposalLimit(base({ quotaPerPlayer: 50, status: 'locked' }), true), 10);
  assert.equal(playlists.proposalLimit(base({ quotaPerPlayer: 50 }), false), 10);
});
test('recherche tolérante aux accents', () => {
  const result = playlists.searchLibrary([
    { id: '1', title: 'Été brûlant', artist: 'Les Étoiles' },
    { id: '2', title: 'Hiver', artist: 'Autre' },
  ], 'ete brulant les etoiles');
  assert.equal(result[0].id, '1');
  assert.equal(result[0].match, 'strong');
});
test('diagnostic des fichiers manquants', () => {
  const summary = playlists.summary(base({ trackIds: ['ok', 'missing'] }),
    [{ id: 'ok', duration: 180 }]);
  assert.equal(summary.playable, 1);
  assert.deepEqual(summary.missing, ['missing']);
  assert.equal(summary.ready, false);
});
test('un vote remplace le précédent sans pouvoir voter hors playlist', () => {
  const item = base({ trackIds: ['vote'] });
  assert.equal(playlists.rateTrack(item, { profileId: 'p1', trackId: 'vote', value: 1 }), 1);
  assert.equal(playlists.rateTrack(item, { profileId: 'p1', trackId: 'vote', value: -1 }), -1);
  assert.equal(item.ratings.length, 1);
  assert.throws(() => playlists.rateTrack(item,
    { profileId: 'p1', trackId: 'absent', value: 1 }), /invalide/);
});
test('persistance et rétrocompatibilité du stockage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-playlists-'));
  process.env.SONGLESS_DATA_FILE = path.join(root, 'data.json');
  process.env.SONGLESS_BACKUP_DIR = path.join(root, 'backups');
  fs.writeFileSync(process.env.SONGLESS_DATA_FILE, JSON.stringify({ profiles: [],
    collections: [{ id: 'legacy', nom: 'Héritée', trackIds: ['t1'] }], challenges: [],
    partyHistory: [], blacklist: [], duplicateDecisions: [] }));
  delete require.cache[require.resolve('../lib/player-store')];
  const store = require('../lib/player-store');
  assert.equal(store.allPlaylists()[0].status, 'draft');
  const created = store.createPlaylist({ nom: 'Participative', collaborative: true,
    quotaPerPlayer: 10, status: 'collecting' });
  store.addPlaylistTrack(created.id,
    { trackId: 't2', profileId: 'p1', profileName: 'Joueur 1' }, { host: false });
  const saved = JSON.parse(fs.readFileSync(process.env.SONGLESS_DATA_FILE, 'utf8'))
    .collections.find(item => item.id === created.id);
  assert.equal(saved.quotaPerPlayer, 10);
  assert.equal(saved.contributions[0].profileId, 'p1');
  fs.rmSync(root, { recursive: true, force: true });
});

console.log(`\n${passed} tests playlists réussis.`);
