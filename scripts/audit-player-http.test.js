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
    assert.deepStrictEqual(restored.body.collections[0].trackIds, ['a', 'b']);
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
