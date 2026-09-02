'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const LOCAL = 'http://127.0.0.1:31300';
const REMOTE = 'http://127.0.0.1:31301';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-audit-'));
const dataFile = path.join(tempDir, 'songless-data.json');
const musicDir = path.join(__dirname, '..', 'musiques');
const auditAudioFile = fs.readdirSync(musicDir).find(file => (
  ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus']
    .includes(path.extname(file).toLowerCase())
));
if (!auditAudioFile) throw new Error('Aucun morceau disponible pour le test HTTP.');
const auditTrackId = Buffer.from(auditAudioFile).toString('base64url');

fs.writeFileSync(dataFile, JSON.stringify({
  version: 1,
  profiles: [
    { id: 'audit_host', nom: 'Alex', emoji: '🎧' },
    { id: 'audit_guest', nom: 'Sam', emoji: '🎵' },
  ],
  collections: [],
  challenges: [],
}, null, 2));

let passed = 0;
let localCookie = '';
const instanceBootstrap = crypto.randomBytes(32).toString('base64url');

function ok(name) {
  passed++;
  console.log(`OK  ${name}`);
}

async function request(base, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (base === LOCAL && localCookie) headers.set('Cookie', localCookie);
  const response = await fetch(`${base}${route}`, { ...options, headers });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch (_) {}
  return { response, status: response.status, body, text };
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Le serveur de test s'est arrêté avec le code ${child.exitCode}.`);
    }
    try {
      const result = await request(LOCAL, '/api/context');
      if (result.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Le serveur de test ne répond pas.');
}

async function main() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath, '--lan', '--internet'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '31300',
      SONGLESS_PUBLIC_PORT: '31301',
      SONGLESS_PUBLIC_URL: 'https://songless-audit.invalid',
      SONGLESS_DATA_FILE: dataFile,
      SONGLESS_INSTANCE_SECRET: instanceBootstrap,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  try {
    await waitForServer(child);

    const unauthorized = await request(LOCAL, '/api/context');
    assert.strictEqual(unauthorized.body.local, false);
    const deniedCreate = await request(LOCAL, '/api/party/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(deniedCreate.status, 403);
    ok('un onglet local sans session ne devient pas administrateur');

    const bootstrap = await request(LOCAL,
      `/admin-bootstrap?token=${encodeURIComponent(instanceBootstrap)}`, { redirect: 'manual' });
    assert.strictEqual(bootstrap.status, 303);
    localCookie = (bootstrap.response.headers.get('set-cookie') || '').split(';')[0];
    assert.match(localCookie, /^songless_admin=/);

    const localContext = await request(LOCAL, '/api/context');
    assert.strictEqual(localContext.status, 200);
    assert.strictEqual(localContext.body.local, true);
    assert.strictEqual(localContext.body.canEditProfiles, true);
    assert.strictEqual(localContext.body.readOnly, false);
    ok('le port local reconnaît le PC hôte');

    const remoteContext = await request(REMOTE, '/api/context');
    assert.strictEqual(remoteContext.status, 200);
    assert.strictEqual(remoteContext.body.local, false);
    assert.strictEqual(remoteContext.body.canEditProfiles, false);
    assert.strictEqual(remoteContext.body.readOnly, true);
    ok('le port Internet ne reçoit pas les droits locaux');

    const localPage = await request(LOCAL, '/');
    const remotePage = await request(REMOTE, '/');
    assert.match(localPage.text, /Songless/i);
    assert.match(remotePage.text, /controller/i);
    assert.doesNotMatch(remotePage.text, /id="library-section"/i);
    ok('le PC reçoit l’interface hôte et Internet le contrôleur');

    const security = await request(REMOTE, '/api/context');
    assert.match(security.response.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.strictEqual(security.response.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(security.response.headers.get('x-frame-options'), 'DENY');
    assert.match(security.response.headers.get('strict-transport-security') || '', /max-age=/);
    ok('les en-têtes de sécurité sont présents sur l’entrée Internet');

    const modes = await request(LOCAL, '/api/party/modes');
    assert.strictEqual(modes.status, 200);
    assert.deepStrictEqual(
      modes.body.modes.map(mode => mode.id),
      ['classic', 'buzzer', 'royale', 'duel', 'confidence', 'cooperation', 'intruder', 'auction', 'joker', 'missions']
    );
    assert.strictEqual(modes.body.modes.every(mode => (
      mode.surfaces.includes('tv') && mode.surfaces.includes('controller')
    )), true);
    assert.doesNotMatch(modes.text, /hostToken|inviteToken|accessToken/);
    ok('le registre HTTP publie les capacités des modes sans aucun jeton');

    const create = await request(LOCAL, '/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: 'audit_host',
        mode: 'classic',
        totalRounds: 1,
        trackIds: [auditTrackId],
        settings: { answer: 'titre', paliers: [0.2, 1], points: 1000 },
      }),
    });
    assert.strictEqual(create.status, 201);
    assert.ok(create.body.hostToken);
    assert.ok(create.body.inviteUrls.internet);
    ok('le PC local peut créer une partie');

    const tvAccess = await request(LOCAL, `/api/party/${encodeURIComponent(create.body.code)}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostToken: create.body.hostToken,
        role: 'tv',
        ttlMinutes: 30,
      }),
    });
    assert.strictEqual(tvAccess.status, 201);
    assert.ok(tvAccess.body.accessToken);
    assert.strictEqual(tvAccess.body.role, 'tv');

    const remoteAdminAccess = await request(
      LOCAL,
      `/api/party/${encodeURIComponent(create.body.code)}/access`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostToken: create.body.hostToken,
          role: 'remote_admin',
          ttlMinutes: 30,
        }),
      }
    );
    assert.strictEqual(remoteAdminAccess.status, 201);
    assert.ok(remoteAdminAccess.body.accessToken);
    assert.notStrictEqual(remoteAdminAccess.body.accessToken, tvAccess.body.accessToken);
    assert.match(tvAccess.body.urls.internet, /\/tv\.html\?/);
    assert.match(remoteAdminAccess.body.urls.internet, /\/remote\.html\?/);
    assert.strictEqual(tvAccess.body.urls.internet.includes(create.body.hostToken), false);
    assert.strictEqual(remoteAdminAccess.body.urls.internet.includes(create.body.hostToken), false);
    ok('le PC génère des accès TV et télécommande séparés');

    const tvPage = await request(REMOTE, '/tv.html');
    const remoteAdminPage = await request(REMOTE, '/remote.html');
    assert.strictEqual(tvPage.status, 200);
    assert.strictEqual(remoteAdminPage.status, 200);
    assert.match(tvPage.text, /Écran TV/i);
    assert.match(remoteAdminPage.text, /Télécommande/i);
    assert.doesNotMatch(tvPage.text + remoteAdminPage.text, /library-section/i);
    ok('les interfaces TV et télécommande existent sans bibliothèque privée');

    const inviteUrl = new URL(create.body.inviteUrls.internet);
    const code = create.body.code;
    const invite = inviteUrl.searchParams.get('invite');
    const invitedHeaders = {
      'Content-Type': 'application/json',
      'X-Songless-Party': code,
      'X-Songless-Invite': invite,
    };

    const tvState = await request(
      REMOTE,
      `/api/party/${encodeURIComponent(code)}?accessToken=${encodeURIComponent(tvAccess.body.accessToken)}`
    );
    assert.strictEqual(tvState.status, 200);
    assert.strictEqual(tvState.body.viewerRole, 'tv');
    assert.strictEqual(tvState.body.canControl, false);

    const tvCommand = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: tvAccess.body.accessToken,
        action: 'finish',
      }),
    });
    assert.strictEqual(tvCommand.status, 403);

    const adminStart = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: remoteAdminAccess.body.accessToken,
        action: 'start-next-round',
      }),
    });
    assert.strictEqual(adminStart.status, 200);
    assert.strictEqual(adminStart.body.viewerRole, 'remote_admin');
    assert.strictEqual(adminStart.body.canControl, true);
    assert.strictEqual(adminStart.body.currentTrackId, null);
    assert.strictEqual(JSON.stringify(adminStart.body).includes(auditTrackId), false);

    const adminLobby = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: remoteAdminAccess.body.accessToken,
        action: 'lobby',
      }),
    });
    assert.strictEqual(adminLobby.status, 200);
    assert.strictEqual(adminLobby.body.status, 'lobby');
    ok('la TV reste en lecture seule et seule la télécommande peut commander');

    const revokeTv = await request(
      LOCAL,
      `/api/party/${encodeURIComponent(code)}/access/${encodeURIComponent(tvAccess.body.id)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostToken: create.body.hostToken }),
      }
    );
    assert.strictEqual(revokeTv.status, 204);
    const revokedTvState = await request(
      REMOTE,
      `/api/party/${encodeURIComponent(code)}?accessToken=${encodeURIComponent(tvAccess.body.accessToken)}`
    );
    assert.strictEqual(revokedTvState.status, 403);
    ok('un accès TV révoqué cesse immédiatement de fonctionner');

    const noInvite = await request(REMOTE, `/api/party/${encodeURIComponent(code)}`);
    assert.strictEqual(noInvite.status, 403);
    ok('une requête Internet sans invitation est refusée');

    const forbiddenLibrary = await request(REMOTE, '/api/tracks', {
      headers: invitedHeaders,
    });
    assert.strictEqual(forbiddenLibrary.status, 403);
    const forbiddenBulkEdit = await request(REMOTE, '/api/tracks/meta-preview', {
      method: 'POST',
      headers: { ...invitedHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['interdit'], genre: 'Rock' }),
    });
    assert.strictEqual(forbiddenBulkEdit.status, 403);
    ok('un invité ne peut ni consulter ni classer la bibliothèque');

    const remoteCreate = await request(REMOTE, '/api/party/create', {
      method: 'POST',
      headers: invitedHeaders,
      body: JSON.stringify({ mode: 'classic' }),
    });
    assert.strictEqual(remoteCreate.status, 403);
    ok('un invité ne peut pas créer une partie');

    const remoteCommand = await request(
      REMOTE,
      `/api/party/${encodeURIComponent(code)}/command`,
      {
        method: 'POST',
        headers: invitedHeaders,
        body: JSON.stringify({
          hostToken: create.body.hostToken,
          action: 'finish',
        }),
      }
    );
    assert.strictEqual(remoteCommand.status, 403);
    ok('même avec le secret hôte, l’entrée Internet ne commande pas la partie');

    const remoteQr = await request(
      REMOTE,
      `/api/party/${encodeURIComponent(code)}/qr.svg?hostToken=${encodeURIComponent(create.body.hostToken)}`,
      { headers: invitedHeaders }
    );
    assert.strictEqual(remoteQr.status, 403);
    ok('le QR hôte reste inaccessible à distance');

    const join = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: invitedHeaders,
      body: JSON.stringify({ profileId: 'audit_guest' }),
    });
    assert.strictEqual(join.status, 200);
    assert.ok(join.body.playerToken);
    assert.strictEqual(Object.hasOwn(join.body, 'hostToken'), false);
    ok('un invité valide reçoit uniquement un jeton joueur');

    const leave = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/action`, {
      method: 'POST',
      headers: invitedHeaders,
      body: JSON.stringify({
        playerToken: join.body.playerToken,
        action: 'leave',
      }),
    });
    assert.strictEqual(leave.status, 200);
    const leftPlayer = leave.body.players.find(player => player.profileId === 'audit_guest');
    assert.strictEqual(leftPlayer.connected, false);

    const reconnect = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: invitedHeaders,
      body: JSON.stringify({ profileId: 'audit_guest' }),
    });
    assert.strictEqual(reconnect.status, 200);
    assert.strictEqual(reconnect.body.playerToken, join.body.playerToken);
    const reconnectedPlayer = reconnect.body.state.players
      .find(player => player.profileId === 'audit_guest');
    assert.strictEqual(reconnectedPlayer.connected, true);
    ok('un abandon est signalé et une actualisation reprend le même joueur');

    const start = await request(LOCAL, `/api/party/${encodeURIComponent(code)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostToken: create.body.hostToken,
        playerToken: create.body.playerToken,
        action: 'start-round',
        data: {
          round: 1,
          trackId: 'secret-track-id',
          answer: { title: 'Réponse cachée', artist: 'Artiste', year: 2000, mode: 'titre' },
        },
      }),
    });
    assert.strictEqual(start.status, 200);

    const playerState = await request(
      REMOTE,
      `/api/party/${encodeURIComponent(code)}?playerToken=${encodeURIComponent(join.body.playerToken)}`,
      { headers: invitedHeaders }
    );
    assert.strictEqual(playerState.status, 200);
    assert.strictEqual(playerState.body.currentTrackId, null);
    assert.strictEqual(Object.hasOwn(playerState.body, 'answerSpec'), false);
    assert.strictEqual(JSON.stringify(playerState.body).includes('Réponse cachée'), false);
    assert.strictEqual(JSON.stringify(playerState.body).includes('secret-track-id'), false);
    ok('l’état joueur ne divulgue ni morceau ni réponse avant révélation');

    const invalidJson = await request(LOCAL, '/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.strictEqual(invalidJson.status, 400);
    assert.match(String(invalidJson.body.error || ''), /JSON invalide/i);
    ok('un JSON invalide produit une erreur maîtrisée');

    const finish = await request(REMOTE, `/api/party/${encodeURIComponent(code)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: remoteAdminAccess.body.accessToken,
        action: 'finish',
      }),
    });
    assert.strictEqual(finish.status, 200);
    assert.strictEqual(finish.body.status, 'finished');

    const history = await request(LOCAL, '/api/party-history');
    assert.strictEqual(history.status, 200);
    const lastParty = history.body.history[history.body.history.length - 1];
    assert.deepStrictEqual(lastParty.players.map(player => player.rank), [1, 1]);
    ok('la fin de partie conserve les joueurs ex æquo au même rang');

    console.log(`\n${passed} tests HTTP réussis.`);
  } finally {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('\nÉchec de l’audit HTTP :', error);
  process.exitCode = 1;
});
