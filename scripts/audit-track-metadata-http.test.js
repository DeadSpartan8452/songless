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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const base = `http://127.0.0.1:${port}`;
    const initialResponse = await waitForServer(`${base}/api/tracks`, child);
    const [initial] = await initialResponse.json();
    assert.strictEqual(initial.favorite, false);
    assert.strictEqual(initial.needsReview, true);

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

    const detailResponse = await fetch(`${base}/api/tracks/${initial.id}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genreDetail: 'Synthwave',
        year: 1987,
        yearSource: 'manual',
        yearConfidence: 'high',
      }),
    });
    assert.strictEqual(detailResponse.status, 200);

    const [updated] = await (await fetch(`${base}/api/tracks`)).json();
    assert.strictEqual(updated.favorite, true);
    assert.strictEqual(updated.genreDetail, 'Synthwave');
    assert.strictEqual(updated.year, 1987);
    assert.strictEqual(updated.yearSource, 'manual');
    assert.strictEqual(updated.yearConfidence, 'high');
    assert.strictEqual(updated.title, 'Titre de test');

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
