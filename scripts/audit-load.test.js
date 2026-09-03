'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

const BASE = 'http://127.0.0.1:31310';
const PLAYER_COUNT = 32;
const POLL_WAVES = 20;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-load-'));
const dataFile = path.join(tempDir, 'songless-data.json');
const musicDir = path.join(__dirname, '..', 'musiques');
const audioFile = fs.readdirSync(musicDir).find(file => (
  ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus']
    .includes(path.extname(file).toLowerCase())
));
if (!audioFile) throw new Error('Aucun morceau disponible pour le test de charge.');

const profiles = Array.from({ length: PLAYER_COUNT }, (_, index) => ({
  id: `load_player_${index + 1}`,
  nom: `Joueur ${index + 1}`,
  emoji: '🎧',
}));
fs.writeFileSync(dataFile, JSON.stringify({
  version: 1,
  profiles,
  collections: [],
  challenges: [],
}, null, 2));

const instanceSecret = crypto.randomBytes(32).toString('base64url');
let cookie = '';

async function request(route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookie) headers.set('Cookie', cookie);
  const startedAt = performance.now();
  const response = await fetch(`${BASE}${route}`, { ...options, headers });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text, elapsed: performance.now() - startedAt, response };
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Serveur arrêté avec le code ${child.exitCode}.`);
    try {
      const result = await request('/api/context');
      if (result.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Le serveur de charge ne répond pas.');
}

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

async function main() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '31310',
      SONGLESS_DATA_FILE: dataFile,
      SONGLESS_INSTANCE_SECRET: instanceSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  try {
    await waitForServer(child);
    const bootstrap = await request(
      `/admin-bootstrap?token=${encodeURIComponent(instanceSecret)}`,
      { redirect: 'manual' }
    );
    assert.strictEqual(bootstrap.status, 303);
    cookie = (bootstrap.response.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^songless_admin=/);

    const trackId = Buffer.from(audioFile).toString('base64url');
    const created = await request('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: profiles[0].id,
        mode: 'classic',
        totalRounds: 5,
        trackIds: [trackId],
        settings: { answer: 'titre', paliers: [0.2, 1, 3], points: 1000 },
      }),
    });
    assert.strictEqual(created.status, 201, created.text);

    const joinsStartedAt = performance.now();
    const joined = await Promise.all(profiles.slice(1).map(profile => request(
      `/api/party/${created.body.code}/join`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profile.id }),
      }
    )));
    assert.strictEqual(joined.every(result => result.status === 200), true);
    const playerTokens = [created.body.playerToken, ...joined.map(result => result.body.playerToken)];
    assert.strictEqual(new Set(playerTokens).size, PLAYER_COUNT);
    const joinsElapsed = performance.now() - joinsStartedAt;
    assert.ok(joinsElapsed < 5000, `Connexions trop lentes : ${Math.round(joinsElapsed)} ms`);

    const started = await request(`/api/party/${created.body.code}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostToken: created.body.hostToken,
        playerToken: created.body.playerToken,
        action: 'start-next-round',
      }),
    });
    assert.strictEqual(started.status, 200, started.text);
    assert.strictEqual(started.body.players.length, PLAYER_COUNT);
    const playbackDelay = Math.max(
      0,
      Number(started.body.playback && started.body.playback.startedAt)
        - Number(started.body.serverNow) + 50
    );
    if (playbackDelay) await new Promise(resolve => setTimeout(resolve, playbackDelay));

    const answersStartedAt = performance.now();
    const answers = await Promise.all(playerTokens.map(playerToken => request(
      `/api/party/${created.body.code}/action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerToken, action: 'answer', data: { answer: 'Réponse fausse' } }),
      }
    )));
    assert.strictEqual(
      answers.every(result => result.status === 200),
      true,
      JSON.stringify(answers.filter(result => result.status !== 200)
        .map(result => ({ status: result.status, body: result.body })))
    );
    const answersElapsed = performance.now() - answersStartedAt;
    assert.ok(answersElapsed < 5000, `Réponses trop lentes : ${Math.round(answersElapsed)} ms`);

    const timings = [];
    for (let wave = 0; wave < POLL_WAVES; wave++) {
      const states = await Promise.all(playerTokens.map(playerToken => request(
        `/api/party/${created.body.code}?playerToken=${encodeURIComponent(playerToken)}`
      )));
      assert.strictEqual(states.every(result => result.status === 200), true);
      timings.push(...states.map(result => result.elapsed));
    }
    assert.strictEqual(timings.length, PLAYER_COUNT * POLL_WAVES);
    const p95 = percentile(timings, 0.95);
    assert.ok(p95 < 750, `Poll p95 trop lent : ${Math.round(p95)} ms`);

    const audio = await Promise.all(playerTokens.slice(0, 8).map(playerToken => request(
      `/api/party/${created.body.code}/audio?round=1&playerToken=${encodeURIComponent(playerToken)}`,
      { headers: { Range: 'bytes=0-65535' } }
    )));
    assert.strictEqual(audio.every(result => result.status === 206), true);
    assert.strictEqual(audio.every(result => result.response.headers.get('content-range')), true);

    const finalState = await request(
      `/api/party/${created.body.code}?hostToken=${encodeURIComponent(created.body.hostToken)}`
    );
    assert.strictEqual(finalState.status, 200);
    assert.strictEqual(finalState.body.players.length, PLAYER_COUNT);
    assert.strictEqual(finalState.body.players.every(player => player.attempts.length === 1), true);

    console.log(`OK  ${PLAYER_COUNT} joueurs connectés en ${Math.round(joinsElapsed)} ms`);
    console.log(`OK  ${PLAYER_COUNT} réponses simultanées en ${Math.round(answersElapsed)} ms`);
    console.log(`OK  ${timings.length} états servis, p95 ${Math.round(p95)} ms`);
    console.log('OK  8 lectures audio partielles simultanées et serveur encore cohérent');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
