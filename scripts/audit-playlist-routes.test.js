'use strict';

const assert = require('assert');
const playlistTools = require('../lib/playlists');
const registerPlaylistRoutes = require('../lib/playlist-routes');

async function main() {
  const sampleTracks = [
    { id: 'sola', title: 'Solatorobo OST' },
    { id: 'regular', title: 'Chanson test', genre: 'Pop' },
    { id: 'furry', title: 'Feel Furry song' },
    { id: 'nightcore', title: 'Nightcore edit' },
  ];
  let tracks = [...sampleTracks, ...Array.from({ length: 20001 }, (_, index) => ({
    id: `extra-${index}`, title: 'Chanson fictive', genre: 'Pop',
  }))];
  const registered = { use: [], get: new Map(), post: new Map(), put: new Map(), delete: new Map() };
  const app = {
    use: (...args) => registered.use.push(args),
    get: (route, handler) => registered.get.set(route, handler),
    post: (route, handler) => registered.post.set(route, handler),
    put: (route, handler) => registered.put.set(route, handler),
    delete: (route, handler) => registered.delete.set(route, handler),
  };
  const item = playlistTools.cleanPlaylist({
    id: 'pl_test', nom: 'Playlist fictive',
    trackIds: [],
    settings: { excludedTags: ['solatorobo', 'feel-furry', 'nightcore'], fairOrder: false },
  });
  let created;
  let applied;
  let fills = [];
  const playerStore = {
    createPlaylist(value) {
      created = playlistTools.cleanPlaylist({ ...value, id: 'pl_all' });
      return created;
    },
    playlistById: id => id === item.id ? item : null,
    allPlaylists: () => [item],
    publicState: () => ({ profiles: [] }),
    addPlaylistTrack(id, contribution) {
      fills.push(contribution.trackId);
      return { added: true };
    },
    updatePlaylist: () => item,
    markPlaylistPlayed: () => item,
  };
  const party = { settings: {}, players: [] };
  const partyStore = {
    get: () => party,
    setTrackIds: (_party, _token, ids) => { applied = ids; },
    publicState: () => ({}),
  };
  registerPlaylistRoutes(app, {
    playerStore,
    partyStore,
    allBuiltTracks: async () => tracks,
    validPartyTrackIds: ids => ids.map(String).filter(id => tracks.some(track => track.id === id)),
    qrCode: {},
    isHostRequest: () => true,
  });

  function response() {
    return {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      end() { return this; },
    };
  }

  const createRes = response();
  await registered.post.get('/api/playlists/from-library')({ body: { nom: 'Toute la bibliothèque' } }, createRes);
  assert.equal(createRes.statusCode, 201);
  assert.equal(created.trackIds.length, tracks.length);
  assert.equal(created.trackIds.at(-1), tracks.at(-1).id);
  assert.equal(createRes.body.included, tracks.length);

  const bulkRes = response();
  await registered.post.get('/api/playlists/:id/tracks-bulk')({
    params: { id: item.id }, body: { trackIds: tracks.map(track => track.id) },
  }, bulkRes);
  assert.equal(bulkRes.body.accepted, 20002);
  assert.equal(bulkRes.body.added, 20002);

  fills = [];
  tracks = sampleTracks;
  const importRes = response();
  await registered.post.get('/api/playlists/import')({ body: {
    format: 'songless-playlist',
    playlist: { nom: 'Import test fictif', trackIds: [] },
    references: Array.from({ length: 5001 }, () => ({ title: 'Introuvable', artist: 'Artiste test' })),
  } }, importRes);
  assert.equal(importRes.body.missingCount, 5001);

  const fillRes = response();
  await registered.post.get('/api/playlists/:id/fill')({ params: { id: item.id }, body: { count: 20 } }, fillRes);
  assert.deepEqual(fills, ['regular']);

  item.trackIds = sampleTracks.map(track => track.id);
  const applyRes = response();
  await registered.post.get('/api/playlists/:id/apply-to-party')({
    params: { id: item.id }, body: { code: 'TEST', hostToken: 'host-test', lock: false },
  }, applyRes);
  assert.deepEqual(applied, ['regular']);

  assert.equal(registered.use[0][0], '/api/playlists');
  console.log('OK  création bibliothèque entière et exclusions appliquées au remplissage et à la partie');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
