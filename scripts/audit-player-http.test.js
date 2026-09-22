'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 31320;
const BASE = `http://127.0.0.1:${PORT}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-player-http-'));
const dataFile = path.join(tempRoot, 'songless-data.json');
const backupDir = path.join(tempRoot, 'backups');
const musicDir = path.join(tempRoot, 'musiques');
const metadataFile = path.join(tempRoot, 'metadata.json');
let passed = 0;

function ok(name) {
  passed++;
  console.log(`OK  ${name}`);
}

async function request(route, options = {}) {
  const response = await fetch(`${BASE}${route}`, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch (_) {}
  return { response, status: response.status, text, body };
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Le serveur de test s’est arrêté avec le code ${child.exitCode}.`);
    }
    try {
      const result = await request('/api/context');
      if (result.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Le serveur de test ne répond pas.');
}

async function main() {
  fs.mkdirSync(musicDir, { recursive: true });
  const metadataTracks = {
    'alpha-one.mp3': {
      title: 'Alpha One', artist: 'Alpha', genre: 'Rock', year: 1997, duration: 180,
      genreSource: 'musicbrainz', yearSource: 'musicbrainz',
    },
    'alpha-copy.mp3': {
      title: 'Alpha One', artist: 'Alpha', genre: 'Rock', year: 1997, duration: 180,
      genreSource: 'musicbrainz', yearSource: 'musicbrainz',
    },
    'beta-two.mp3': {
      title: 'Beta Two', artist: 'Beta', genre: 'Rock', year: 2004, duration: 190,
      genreSource: 'musicbrainz', genreConfidence: 'low',
      yearSource: 'musicbrainz', yearConfidence: 'low',
    },
    'gamma-three.mp3': {
      title: 'Gamma Three', artist: 'Gamma', genre: 'Jazz', year: 2012, duration: 200,
      genreSource: 'tag', yearSource: 'tag',
    },
  };
  for (const fileName of Object.keys(metadataTracks)) {
    fs.writeFileSync(path.join(musicDir, fileName), Buffer.from([0]));
  }
  fs.writeFileSync(metadataFile, JSON.stringify({ version: 1, tracks: metadataTracks }), 'utf8');
  fs.writeFileSync(dataFile, JSON.stringify({
    version: 1,
    profiles: [{ id: 'initial', nom: 'Initial', emoji: '🎧' }],
    collections: [],
    challenges: [],
    partyHistory: [],
  }), 'utf8');

  const projectRoot = path.join(__dirname, '..');
  const child = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      SONGLESS_DATA_FILE: dataFile,
      SONGLESS_BACKUP_DIR: backupDir,
      SONGLESS_MUSIC_DIR: musicDir,
      SONGLESS_METADATA_FILE: metadataFile,
      SONGLESS_TEST_ALLOW_LOCAL_ADMIN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  try {
    await waitForServer(child);

    const state = await request('/api/player/state');
    assert.strictEqual(state.status, 200);
    assert.strictEqual(state.body.profiles[0].id, 'initial');
    assert.match(state.response.headers.get('cache-control') || '', /no-store/);
    ok('la route d’état restitue les profils sans cache navigateur');

    const created = await request('/api/player/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alpha<>', nom: ' Alpha ', emoji: '🎵' }),
    });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.id, 'alpha');
    assert.strictEqual(created.body.nom, 'Alpha');

    const updated = await request('/api/player/profiles/alpha', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stats: { played: 4, wins: 2 } }),
    });
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.body.stats.played, 4);

    const missing = await request('/api/player/profiles/absent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Absent' }),
    });
    assert.strictEqual(missing.status, 404);
    ok('les routes de création et modification gèrent succès et profil absent');

    const lists = await request('/api/player/lists', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: [{ id: 'c<>1', nom: 'Test', trackIds: ['a', 'a', 'b'] }],
        challenges: [{
          id: 'd<>1', nom: 'Défi', trackIds: ['b'], seed: 'HTTP-SEED', totalRounds: 2,
        }],
      }),
    });
    assert.strictEqual(lists.status, 200);
    assert.deepStrictEqual(lists.body.collections[0].trackIds, ['a', 'b']);
    assert.strictEqual(lists.body.challenges[0].seed, 'HTTP-SEED');
    ok('les routes de collections et défis persistent leurs paramètres');

    const trustedId = Buffer.from('alpha-one.mp3').toString('base64url');
    const untrustedId = Buffer.from('beta-two.mp3').toString('base64url');
    const otherThemeId = Buffer.from('gamma-three.mp3').toString('base64url');

    const playlistCreated = await request('/api/playlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Soirée HTTP', description: 'Collecte isolée',
        collaborative: true, quotaPerPlayer: 10, reservePerPlayer: 2,
        status: 'collecting', trackIds: [trustedId] }),
    });
    assert.strictEqual(playlistCreated.status, 201);
    assert.strictEqual(playlistCreated.body.quotaPerPlayer, 10);

    const mergeTarget = await request('/api/playlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Cible fusion', trackIds: [trustedId] }),
    });
    const mergeSource = await request('/api/playlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Source fusion', trackIds: [trustedId, untrustedId] }),
    });
    const merged = await request(`/api/playlists/${mergeTarget.body.id}/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceIds: [mergeSource.body.id] }),
    });
    assert.strictEqual(merged.status, 200);
    assert.strictEqual(merged.body.added, 1);
    assert.deepStrictEqual(new Set(merged.body.playlist.trackIds), new Set([trustedId, untrustedId]));

    const playlistExported = await request(`/api/playlists/${mergeTarget.body.id}/export`);
    assert.strictEqual(playlistExported.status, 200);
    assert.strictEqual(playlistExported.body.version, 2);
    assert.strictEqual(playlistExported.body.format, 'songless-playlist');
    assert.strictEqual(playlistExported.body.references.length, 2);

    const imported = await request('/api/playlists/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'songless-playlist', version: 2,
        playlist: { nom: 'Import test', trackIds: ['ancien-gamma', 'absent-id'] },
        references: [
          { trackId: 'ancien-gamma', title: 'Gamma Three', artist: 'Gamma' },
          { trackId: 'absent-id', title: 'Morceau inexistant', artist: 'Personne' },
        ],
      }),
    });
    assert.strictEqual(imported.status, 201);
    assert.deepStrictEqual(imported.body.playlist.trackIds, [otherThemeId]);
    assert.strictEqual(imported.body.found, 1);
    assert.strictEqual(imported.body.missingCount, 1);
    assert.strictEqual(imported.body.missing[0].title, 'Morceau inexistant');
    ok('fusion, export v2 et import rapprochent la bibliothèque puis signalent les absents');

    const filesBeforeCleanup = fs.readdirSync(musicDir).sort();
    const cleanup = await request('/api/playlists/cleanup-candidates');
    assert.strictEqual(cleanup.status, 200);
    assert.match(cleanup.body.note, /aucun fichier.*supprimé/i);
    assert.deepStrictEqual(fs.readdirSync(musicDir).sort(), filesBeforeCleanup);
    ok('le diagnostic de nettoyage reste strictement non destructeur');

    const guest = await request('/api/player/profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Invité test', emoji: '🎸' }),
    });
    assert.strictEqual(guest.status, 201);

    const playlistParty = await request('/api/party/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'classic', profileId: 'initial', totalRounds: 10,
        seed: 'PLAYLIST-HTTP', settings: { playlistId: playlistCreated.body.id }, trackIds: [] }),
    });
    assert.strictEqual(playlistParty.status, 201);
    const guestJoin = await request(`/api/party/${playlistParty.body.code}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: guest.body.id }),
    });
    assert.strictEqual(guestJoin.status, 200);

    const playlistSearch = await request(`/api/party/${playlistParty.body.code}/playlist/search?playerToken=${encodeURIComponent(guestJoin.body.playerToken)}&q=gamma`);
    assert.strictEqual(playlistSearch.status, 200);
    assert.strictEqual(playlistSearch.body.matches[0].id, otherThemeId);

    const contribution = await request(`/api/party/${playlistParty.body.code}/playlist/contributions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerToken: guestJoin.body.playerToken,
        profileId: 'identite-fabriquee', trackId: otherThemeId }),
    });
    assert.strictEqual(contribution.status, 201);
    assert.strictEqual(contribution.body.contribution.profileId, guest.body.id);

    const challengeOnlySave = await request('/api/player/lists', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenges: [
        { id: 'd<>1', nom: 'Défi', trackIds: ['b'], seed: 'HTTP-SEED', totalRounds: 2 },
        { id: 'd_apres_contribution', nom: 'Défi conservateur',
          trackIds: [trustedId], seed: 'KEEP-PLAYLIST', totalRounds: 1 },
      ] }),
    });
    assert.strictEqual(challengeOnlySave.status, 200);
    const afterChallengeSave = await request('/api/playlists');
    const preservedPlaylist = afterChallengeSave.body.playlists
      .find(item => item.id === playlistCreated.body.id);
    assert.ok(preservedPlaylist);
    assert.ok(preservedPlaylist.contributions
      .some(item => item.profileId === guest.body.id && item.trackId === otherThemeId));
    ok('enregistrer un défi ne supprime pas les contributions récentes d’une playlist');

    const playerView = await request(`/api/party/${playlistParty.body.code}/playlist?playerToken=${encodeURIComponent(guestJoin.body.playerToken)}`);
    assert.strictEqual(playerView.status, 200);
    assert.strictEqual(playerView.body.progress.main, 1);
    assert.ok(playerView.body.tracks.some(track => track.id === otherThemeId));

    const applied = await request(`/api/playlists/${playlistCreated.body.id}/apply-to-party`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: playlistParty.body.code,
        hostToken: playlistParty.body.hostToken, lock: true }),
    });
    assert.strictEqual(applied.status, 200);
    assert.deepStrictEqual(new Set(applied.body.trackIds), new Set([trustedId, otherThemeId]));

    const afterLock = await request(`/api/party/${playlistParty.body.code}/playlist/contributions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerToken: guestJoin.body.playerToken, trackId: untrustedId }),
    });
    assert.strictEqual(afterLock.status, 400);
    assert.match(afterLock.body.error, /collecte.*fermée/i);
    ok('les playlists participatives lient le jeton joueur, recherchent la bibliothèque et se verrouillent');

    const trustedYearParty = await request('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'classic', profileId: 'initial', totalRounds: 2,
        seed: 'TRUSTED-YEAR-HTTP', trackIds: [trustedId, untrustedId],
        settings: { answer: 'annee' },
      }),
    });
    assert.strictEqual(trustedYearParty.status, 201);
    assert.strictEqual(trustedYearParty.body.state.playlist.count, 1);

    const trustedGenreParty = await request('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'classic', profileId: 'initial', totalRounds: 2,
        seed: 'TRUSTED-GENRE-HTTP', trackIds: [trustedId, untrustedId, otherThemeId],
        settings: { theme: 'genre:Rock' },
      }),
    });
    assert.strictEqual(trustedGenreParty.status, 201);
    assert.strictEqual(trustedGenreParty.body.state.playlist.count, 1);

    const trustedDecadeParty = await request('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'classic', profileId: 'initial', totalRounds: 2,
        seed: 'TRUSTED-DECADE-HTTP', trackIds: [trustedId, untrustedId, otherThemeId],
        settings: { theme: 'decade:1990' },
      }),
    });
    assert.strictEqual(trustedDecadeParty.status, 201);
    assert.strictEqual(trustedDecadeParty.body.state.playlist.count, 1);

    const untrustedOnly = await request('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'classic', profileId: 'initial', totalRounds: 2,
        seed: 'UNTRUSTED-ONLY-HTTP', trackIds: [untrustedId],
        settings: { answer: 'annee' },
      }),
    });
    assert.strictEqual(untrustedOnly.status, 400);
    assert.match(untrustedOnly.body.error, /Aucune chanson exploitable/);
    ok('les parties filtrent les métadonnées faibles et gardent les provenances historiques fiables');

    const blacklistCreated = await request('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: 'artist', targetValue: 'Alpha',
        durationType: 'parties', durationAmount: 2,
        modes: ['solo_title', 'classic'], reason: 'Rotation HTTP',
      }),
    });
    assert.strictEqual(blacklistCreated.status, 201);
    assert.strictEqual(blacklistCreated.body.remainingParties, 2);

    const blacklistPreview = await request('/api/blacklist/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'solo_title',
        rule: {
          targetType: 'year', targetValue: '2004',
          durationType: 'days', durationAmount: 1,
        },
      }),
    });
    assert.strictEqual(blacklistPreview.status, 200);
    assert.strictEqual(blacklistPreview.body.total, 4);
    assert.strictEqual(blacklistPreview.body.excluded, 3);
    assert.strictEqual(blacklistPreview.body.remaining, 1);
    assert.strictEqual(blacklistPreview.body.reasons[0].reasons.length > 0, true);
    ok('l’aperçu HTTP cumule les exclusions et annonce les morceaux restants');

    const trackIds = Object.keys(metadataTracks).map(fileName => Buffer.from(fileName).toString('base64url'));
    const partyCreated = await request('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'classic', profileId: 'initial', totalRounds: 2,
        seed: 'BLACKLIST-HTTP', trackIds,
      }),
    });
    assert.strictEqual(partyCreated.status, 201);
    const afterPartyBlacklist = await request('/api/blacklist');
    assert.strictEqual(afterPartyBlacklist.body.rules[0].remainingParties, 1);
    ok('la création multijoueur applique la blacklist serveur et consomme une partie');

    const lifted = await request(`/api/blacklist/${blacklistCreated.body.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    assert.strictEqual(lifted.status, 200);
    assert.strictEqual(lifted.body.active, false);
    const removedRule = await request(`/api/blacklist/${blacklistCreated.body.id}`, { method: 'DELETE' });
    assert.strictEqual(removedRule.status, 200);
    assert.strictEqual((await request('/api/blacklist')).body.rules.length, 0);
    ok('une exclusion peut être levée puis supprimée immédiatement par HTTP');

    const duplicates = await request('/api/library/duplicates');
    assert.strictEqual(duplicates.status, 200);
    assert.strictEqual(duplicates.body.total, 1);
    assert.strictEqual(duplicates.body.comparisons[0].exactFile, true);
    assert.strictEqual(duplicates.body.comparisons[0].confidence, 'exact');
    const distinct = await request('/api/library/duplicates/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: duplicates.body.comparisons[0].files,
        decision: 'distinct',
        reason: 'Deux versions à conserver',
      }),
    });
    assert.strictEqual(distinct.status, 201);
    assert.strictEqual((await request('/api/library/duplicates')).body.total, 0);
    assert.strictEqual((await request(`/api/library/duplicates/decision/${distinct.body.key}`, {
      method: 'DELETE',
    })).status, 200);
    ok('la comparaison distingue les octets identiques et mémorise les faux positifs');

    const exported = await request('/api/player/export');
    assert.strictEqual(exported.status, 200);
    assert.match(exported.response.headers.get('content-type') || '', /application\/json/);
    assert.match(
      exported.response.headers.get('content-disposition') || '',
      /songless-sauvegarde\.json/
    );
    assert.strictEqual(exported.body.profiles.some(profile => profile.id === 'alpha'), true);
    ok('l’export HTTP produit une sauvegarde JSON téléchargeable complète');

    const invalid = await request('/api/player/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections: [] }),
    });
    assert.strictEqual(invalid.status, 400);
    assert.match(invalid.body.error, /Sauvegarde invalide/);
    const afterInvalid = await request('/api/player/state');
    assert.strictEqual(afterInvalid.body.profiles.some(profile => profile.id === 'alpha'), true);
    ok('un import HTTP invalide est refusé sans perte de profil');

    const replacement = await request('/api/player/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        profiles: [{ id: 'replacement<>', nom: 'Remplacement', emoji: '🎤' }],
        collections: [],
        challenges: [],
        partyHistory: [],
      }),
    });
    assert.strictEqual(replacement.status, 200);
    assert.strictEqual(replacement.body.profiles[0].id, 'replacement');
    assert.strictEqual(fs.existsSync(backupDir), true);
    assert.strictEqual(fs.readdirSync(backupDir).length >= 1, true);
    ok('un import valide crée automatiquement une sauvegarde préalable isolée');

    const restored = await request('/api/player/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: exported.text,
    });
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(restored.body.profiles.some(profile => profile.id === 'alpha'), true);
    assert.deepStrictEqual(restored.body.collections.find(item => item.id === 'c1').trackIds, ['a', 'b']);
    assert.strictEqual(restored.body.challenges[0].seed, 'HTTP-SEED');
    ok('la sauvegarde exportée restaure tout le parcours via la route d’import');

    const removed = await request('/api/player/profiles/alpha', { method: 'DELETE' });
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(removed.body.success, true);
    const removedAgain = await request('/api/player/profiles/alpha', { method: 'DELETE' });
    assert.strictEqual(removedAgain.status, 404);
    ok('la route de suppression confirme la disparition du profil');

    console.log(`\n${passed} tests HTTP profils/sauvegardes réussis.`);
  } catch (error) {
    if (serverOutput.trim()) console.error(serverOutput.trim());
    throw error;
  } finally {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 2000);
    });
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
