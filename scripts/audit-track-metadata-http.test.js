'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Le serveur s'est arrêté (${child.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (_) { /* démarrage en cours */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Le serveur de test ne répond pas.');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-metadata-'));
  const musicDir = path.join(root, 'musiques');
  const metadataFile = path.join(root, 'metadata.json');
  const backupDir = path.join(root, 'backups');
  const fileName = 'morceau-test.mp3';
  const port = await freePort();
  let child;

  fs.mkdirSync(musicDir);
  fs.writeFileSync(path.join(musicDir, fileName), 'test');
  fs.writeFileSync(metadataFile, JSON.stringify({
    version: 1,
    tracks: {
      [fileName]: {
        title: 'Titre de test',
        artist: 'Artiste de test',
        genre: 'Pop',
        needsReview: true,
        musicbrainzRecordingId: '11111111-1111-4111-8111-111111111111',
        album: 'Ancien album erroné',
        albumSource: 'musicbrainz',
        albumConfidence: 'medium',
      },
    },
  }));

  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        SONGLESS_MUSIC_DIR: musicDir,
        SONGLESS_METADATA_FILE: metadataFile,
        SONGLESS_METADATA_BACKUP_DIR: backupDir,
        SONGLESS_TEST_ALLOW_LOCAL_ADMIN: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const base = `http://127.0.0.1:${port}`;
    const initialResponse = await waitForServer(`${base}/api/tracks`, child);
    const [initial] = await initialResponse.json();
    assert.strictEqual(initial.favorite, false);
    assert.strictEqual(initial.needsReview, true);
    assert.strictEqual(initial.classificationReview.genre, true);
    assert.strictEqual(initial.classificationReview.yearMissing, true);
    assert.strictEqual(initial.unofficialVariant, false);
    assert.strictEqual(initial.musicbrainzRecordingId, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(initial.album, 'Ancien album erroné');

    const favoriteResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.strictEqual(favoriteResponse.status, 200);
    const favoriteBody = await favoriteResponse.json();
    assert.strictEqual(favoriteBody.track.favorite, true);
    assert.strictEqual(favoriteBody.track.needsReview, true);
    assert.strictEqual(favoriteBody.track.reviewed, undefined);
    assert.strictEqual(favoriteBody.track.title, 'Titre de test');
    assert.strictEqual(favoriteBody.track.musicbrainzRecordingId, initial.musicbrainzRecordingId);
    assert.strictEqual(favoriteBody.track.album, initial.album);

    const detailResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: 'Artiste corrigé',
        genreDetail: 'Synthwave',
        year: 1987,
        yearSource: 'manual',
        yearConfidence: 'high',
      }),
    });
    assert.strictEqual(detailResponse.status, 200);

    const [updated] = await (await fetch(`${base}/api/tracks`)).json();
    assert.strictEqual(updated.favorite, true);
    assert.strictEqual(updated.artistSource, 'manual');
    assert.strictEqual(updated.artistConfidence, 'high');
    assert.strictEqual(updated.musicbrainzRecordingId, null);
    assert.strictEqual(updated.metadataMatch, 'manual');
    assert.strictEqual(updated.album, null);
    assert.strictEqual(updated.albumSource, 'unknown');
    assert.strictEqual(updated.albumConfidence, 'unknown');
    assert.strictEqual(updated.genreDetail, 'Synthwave');
    assert.strictEqual(updated.year, 1987);
    assert.strictEqual(updated.yearSource, 'manual');
    assert.strictEqual(updated.yearConfidence, 'high');
    assert.strictEqual(updated.title, 'Titre de test');
    assert.strictEqual(updated.classificationReview.year, false);
    assert.strictEqual(updated.classificationReview.genre, true);

    const invalidRecordingResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicbrainzRecordingId: 'pas-un-mbid' }),
    });
    assert.strictEqual(invalidRecordingResponse.status, 400);

    const recordingResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: 'Artiste final',
        musicbrainzRecordingId: '22222222-2222-4222-8222-222222222222',
        album: 'Album vérifié',
        albumSource: 'musicbrainz',
        albumConfidence: 'medium',
      }),
    });
    assert.strictEqual(recordingResponse.status, 200);
    const recordingBody = await recordingResponse.json();
    assert.strictEqual(
      recordingBody.track.musicbrainzRecordingId,
      '22222222-2222-4222-8222-222222222222',
    );
    assert.strictEqual(recordingBody.track.metadataMatch, 'musicbrainz');
    assert.strictEqual(recordingBody.track.album, 'Album vérifié');
    assert.strictEqual(recordingBody.track.albumSource, 'musicbrainz');
    assert.strictEqual(recordingBody.track.albumConfidence, 'medium');

    const [reloaded] = await (await fetch(`${base}/api/tracks`)).json();
    assert.strictEqual(reloaded.musicbrainzRecordingId, recordingBody.track.musicbrainzRecordingId);
    assert.strictEqual(reloaded.album, 'Album vérifié');

    // Une simple correction de casse ne change pas l'identité du morceau.
    const caseResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: 'ARTISTE FINAL' }),
    });
    assert.strictEqual(caseResponse.status, 200);
    const caseBody = await caseResponse.json();
    assert.strictEqual(caseBody.track.musicbrainzRecordingId, reloaded.musicbrainzRecordingId);
    assert.strictEqual(caseBody.track.album, reloaded.album);

    const portalResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ easterEgg: 'portal' }),
    });
    assert.strictEqual(portalResponse.status, 200);
    const portalBody = await portalResponse.json();
    assert.strictEqual(portalBody.track.easterEgg, 'portal');
    const invalidEggResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ easterEgg: 'effet-inconnu' }),
    });
    assert.strictEqual(invalidEggResponse.status, 400);
    const [withPortal] = await (await fetch(`${base}/api/tracks`)).json();
    assert.strictEqual(withPortal.easterEgg, 'portal');

    const previewResponse = await fetch(`${base}/api/tracks/meta-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [initial.id],
        genre: 'Rock',
        genreDetail: 'Post-rock',
        title: 'Titre interdit',
      }),
    });
    assert.strictEqual(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.strictEqual(preview.items.length, 1);
    assert.strictEqual(preview.patch.genre, 'Rock');
    assert.strictEqual(preview.patch.genreDetail, 'Post-rock');
    assert.strictEqual(Object.hasOwn(preview.patch, 'title'), false);

    const beforeApply = await (await fetch(`${base}/api/tracks`)).json();
    assert.strictEqual(beforeApply[0].genre, 'Pop');
    const applyResponse = await fetch(`${base}/api/tracks/meta-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: preview.token }),
    });
    assert.strictEqual(applyResponse.status, 200);
    const afterApply = await (await fetch(`${base}/api/tracks`)).json();
    assert.strictEqual(afterApply[0].genre, 'Rock');
    assert.strictEqual(afterApply[0].genreDetail, 'Post-rock');
    assert.strictEqual(afterApply[0].genreSource, 'manual');
    assert.strictEqual(afterApply[0].genreConfidence, 'high');
    assert.strictEqual(afterApply[0].title, 'Titre de test');
    assert.strictEqual(afterApply[0].classificationReview.any, false);
    const replayResponse = await fetch(`${base}/api/tracks/meta-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: preview.token }),
    });
    assert.strictEqual(replayResponse.status, 400);

    const healthText = await (await fetch(`${base}/api/library/health`)).text();
    const doneLine = healthText.split('\n')
      .find((line, index, lines) => lines[index - 1] === 'event: done' && line.startsWith('data: '));
    assert.ok(doneLine, 'Le diagnostic doit publier son résultat final.');
    const healthReport = JSON.parse(doneLine.slice(6));
    assert.strictEqual(
      healthReport.qualite.review + healthReport.qualite.problematic,
      1,
    );
    assert.strictEqual(healthReport.qualiteMorceaux.length, 1);
    assert.ok(healthReport.qualiteMorceaux[0].unknownChecks.includes('encodingQuality'));

    // Conserver une correction manuelle d'album lors d'une correction d'identité.
    const manualAlbumResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: 'Album choisi à la main' }),
    });
    assert.strictEqual(manualAlbumResponse.status, 200);
    const renameResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Titre corrigé' }),
    });
    assert.strictEqual(renameResponse.status, 200);
    const renamed = (await renameResponse.json()).track;
    assert.strictEqual(renamed.musicbrainzRecordingId, null);
    assert.strictEqual(renamed.album, 'Album choisi à la main');
    assert.strictEqual(renamed.albumSource, 'manual');
    assert.strictEqual(renamed.year, 1987);
    assert.strictEqual(renamed.yearSource, 'manual');
    assert.strictEqual(fs.existsSync(path.join(musicDir, fileName)), true);

    // Vérifier le vrai contrat HTTP, pas seulement le calcul pur de classification.
    const fixtures = {
      'variante-test.mp3': {
        title: 'Version de test', unofficialVariant: true,
        genre: 'Rock', genreSource: 'manual', genreConfidence: 'high',
      },
      'variante-incertaine.mp3': {
        title: 'Autre version', unofficialVariant: true,
        genre: 'Rock', genreSource: 'filename', genreConfidence: 'low',
      },
      'original-test.mp3': { title: 'Original de test', genre: 'Rock', genreSource: 'manual' },
    };
    const saved = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    Object.assign(saved.tracks, fixtures);
    fs.writeFileSync(metadataFile, JSON.stringify(saved));
    for (const name of Object.keys(fixtures)) fs.writeFileSync(path.join(musicDir, name), 'test');
    fs.writeFileSync(path.join(musicDir, 'Essai Nightcore.mp3'), 'test');
    const tracks = await (await fetch(`${base}/api/tracks`)).json();
    const variant = tracks.find(track => track.fileName === 'variante-test.mp3');
    assert.strictEqual(variant.unofficialVariant, true);
    assert.strictEqual(variant.classificationReview.any, false);
    assert.strictEqual(variant.classificationReview.artistMissing, false);
    assert.strictEqual(variant.classificationReview.yearMissing, false);
    const uncertain = tracks.find(track => track.fileName === 'variante-incertaine.mp3');
    assert.strictEqual(uncertain.classificationReview.genreUncertain, true);
    assert.strictEqual(uncertain.classificationReview.yearMissing, false);
    const original = tracks.find(track => track.fileName === 'original-test.mp3');
    assert.strictEqual(original.unofficialVariant, false);
    assert.strictEqual(original.classificationReview.yearMissing, true);
    assert.strictEqual(original.classificationReview.artistMissing, true);
    const fallback = tracks.find(track => track.fileName === 'Essai Nightcore.mp3');
    assert.strictEqual(fallback.unofficialVariant, true);
    assert.strictEqual(fallback.classificationReview.yearMissing, false);
    console.log('OK  métadonnées HTTP isolées, sans écriture dans la bibliothèque personnelle');
  } finally {
    if (child && child.exitCode === null) child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
