'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const LOCAL = 'http://127.0.0.1:31320';
const REMOTE = 'http://127.0.0.1:31321';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-permissions-'));
const dataFile = path.join(tempDir, 'songless-data.json');
const musicDir = path.join(tempDir, 'musiques');
fs.mkdirSync(musicDir);
fs.writeFileSync(dataFile, JSON.stringify({
  version: 1,
  profiles: [{ id: 'permission_host', nom: 'Hôte test', emoji: '🎧' }],
  collections: [],
  challenges: [],
}, null, 2));

const instanceSecret = crypto.randomBytes(32).toString('base64url');
let localCookie = '';

async function request(base, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (base === LOCAL && localCookie) headers.set('Cookie', localCookie);
  const response = await fetch(`${base}${route}`, { ...options, headers });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text, response };
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Serveur arrêté avec le code ${child.exitCode}.`);
    try {
      const result = await request(LOCAL, '/api/context');
      if (result.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Le serveur de permissions ne répond pas.');
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--lan', '--internet'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '31320',
      SONGLESS_PUBLIC_PORT: '31321',
      SONGLESS_PUBLIC_URL: 'https://songless-permissions.invalid',
      SONGLESS_DATA_FILE: dataFile,
      SONGLESS_MUSIC_DIR: musicDir,
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
      LOCAL,
      `/admin-bootstrap?token=${encodeURIComponent(instanceSecret)}`,
      { redirect: 'manual' }
    );
    assert.strictEqual(bootstrap.status, 303);
    localCookie = (bootstrap.response.headers.get('set-cookie') || '').split(';')[0];
    assert.match(localCookie, /^songless_admin=/);

    const created = await request(LOCAL, '/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'permission_host', mode: 'classic', totalRounds: 2 }),
    });
    assert.strictEqual(created.status, 201, created.text);
    const inviteUrl = new URL(created.body.inviteUrls.internet);
    const inviteToken = inviteUrl.searchParams.get('invite');
    assert.ok(inviteToken);
    const invitedHeaders = { 'X-Songless-Invite': inviteToken };
    const partyHeader = { 'X-Songless-Party': created.body.code };

    const noInvite = await request(REMOTE, `/api/party/${created.body.code}`);
    assert.strictEqual(noInvite.status, 403);
    const noProfileInvite = await request(REMOTE, '/api/controller/profiles');
    assert.strictEqual(noProfileInvite.status, 403);

    const profiles = await request(REMOTE, '/api/controller/profiles', {
      headers: { ...invitedHeaders, ...partyHeader },
    });
    assert.strictEqual(profiles.status, 200);
    const newProfile = await request(REMOTE, '/api/controller/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...invitedHeaders, ...partyHeader },
      body: JSON.stringify({ nom: 'Invité test', emoji: '🎵' }),
    });
    assert.strictEqual(newProfile.status, 201, newProfile.text);
    const joined = await request(REMOTE, `/api/party/${created.body.code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...invitedHeaders },
      body: JSON.stringify({ profileId: newProfile.body.id }),
    });
    assert.strictEqual(joined.status, 200, joined.text);
    const reaction = await request(REMOTE, `/api/party/${created.body.code}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...invitedHeaders },
      body: JSON.stringify({
        playerToken: joined.body.playerToken,
        action: 'reaction',
        data: { emoji: '👏' },
      }),
    });
    assert.strictEqual(reaction.status, 200, reaction.text);
    const suggestions = await request(
      REMOTE,
      `/api/party/${created.body.code}/suggestions?playerToken=${encodeURIComponent(joined.body.playerToken)}&q=test`,
      { headers: invitedHeaders }
    );
    assert.strictEqual(suggestions.status, 200, suggestions.text);
    assert.deepStrictEqual(suggestions.body.suggestions, []);
    for (const route of ['/api/upload', '/api/download']) {
      const proposal = await request(REMOTE, route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...invitedHeaders, ...partyHeader },
        body: '{}',
      });
      assert.notStrictEqual(proposal.status, 403, `${route} ne traverse plus l’autorisation d’invité`);
      assert.ok(proposal.status >= 400, `${route} a accepté une proposition vide`);
    }
    console.log('OK  invitation requise, profil minimal, jeu et propositions bornées autorisés');

    const issueAccess = async role => {
      const result = await request(LOCAL, `/api/party/${created.body.code}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostToken: created.body.hostToken, role, ttlMinutes: 30 }),
      });
      assert.strictEqual(result.status, 201, result.text);
      return result.body.accessToken;
    };
    const tvToken = await issueAccess('tv');
    const remoteAdminToken = await issueAccess('remote_admin');
    const tvState = await request(
      REMOTE,
      `/api/party/${created.body.code}?accessToken=${encodeURIComponent(tvToken)}`
    );
    assert.strictEqual(tvState.status, 200);
    assert.strictEqual(tvState.body.viewerRole, 'tv');
    const tvAudio = await request(
      REMOTE,
      `/api/party/${created.body.code}/audio?round=1&accessToken=${encodeURIComponent(tvToken)}`
    );
    assert.strictEqual(tvAudio.status, 409);
    const tvCommand = await request(REMOTE, `/api/party/${created.body.code}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: tvToken, action: 'lobby' }),
    });
    assert.strictEqual(tvCommand.status, 403);
    const adminCommand = await request(REMOTE, `/api/party/${created.body.code}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: remoteAdminToken, action: 'lobby' }),
    });
    assert.strictEqual(adminCommand.status, 200, adminCommand.text);
    console.log('OK  TV en lecture seule et télécommande limitée reconnues séparément');

    const denied = [
      ['GET', '/api/player/state'],
      ['GET', '/api/lan/qr.svg'],
      ['POST', '/api/player/profiles'],
      ['PUT', '/api/controller/profiles/permission_host'],
      ['PUT', '/api/player/profiles/permission_host'],
      ['DELETE', '/api/player/profiles/permission_host'],
      ['PUT', '/api/player/lists'],
      ['GET', '/api/player/export'],
      ['POST', '/api/player/import'],
      ['GET', '/api/sources'],
      ['POST', '/api/sources/assign/preview'],
      ['POST', '/api/sources/assign'],
      ['POST', '/api/download/balanced/preview'],
      ['POST', '/api/download/balanced'],
      ['GET', '/api/blacklist'],
      ['POST', '/api/blacklist/preview'],
      ['POST', '/api/blacklist'],
      ['PUT', '/api/blacklist/fake'],
      ['DELETE', '/api/blacklist/fake'],
      ['POST', '/api/blacklist/consume'],
      ['GET', '/api/tracks'],
      ['GET', '/api/genres'],
      ['GET', '/api/tracks/fake/audio'],
      ['GET', '/api/tracks/fake/cover'],
      ['POST', '/api/android/import-folder'],
      ['DELETE', '/api/tracks/fake'],
      ['POST', '/api/tracks/meta-preview'],
      ['POST', '/api/tracks/meta-apply'],
      ['PATCH', '/api/tracks/fake/meta'],
      ['GET', '/api/download/status'],
      ['GET', '/api/antivirus/status'],
      ['POST', '/api/antivirus/update'],
      ['POST', '/api/preflight'],
      ['GET', '/api/download/approvals'],
      ['POST', '/api/download/approvals/fake'],
      ['POST', '/api/download/playlist'],
      ['GET', '/api/library/duplicates'],
      ['POST', '/api/library/duplicates/decision'],
      ['DELETE', '/api/library/duplicates/decision/fake'],
      ['GET', '/api/library/health'],
      ['GET', '/api/party-history'],
      ['GET', '/api/playlists'],
      ['GET', '/api/playlists/cleanup-candidates'],
      ['POST', '/api/playlists'],
      ['PUT', '/api/playlists/fake'],
      ['DELETE', '/api/playlists/fake'],
      ['POST', '/api/playlists/fake/duplicate'],
      ['POST', '/api/playlists/fake/merge'],
      ['POST', '/api/playlists/fake/tracks'],
      ['POST', '/api/playlists/fake/tracks-bulk'],
      ['DELETE', '/api/playlists/fake/tracks/fake'],
      ['PUT', '/api/playlists/fake/order'],
      ['GET', '/api/playlists/fake/export'],
      ['POST', '/api/playlists/import'],
      ['POST', '/api/playlists/fake/fill'],
      ['POST', '/api/playlists/fake/apply-to-party'],
      ['POST', '/api/party/create'],
      ['POST', `/api/party/${created.body.code}/access`],
      ['DELETE', `/api/party/${created.body.code}/access/fake`],
      ['GET', `/api/party/${created.body.code}/qr.svg`],
      ['GET', `/api/party/${created.body.code}/access-qr.svg`],
    ];
    for (const [method, route] of denied) {
      const result = await request(REMOTE, route, {
        method,
        headers: { 'Content-Type': 'application/json', ...invitedHeaders, ...partyHeader },
        body: ['GET', 'HEAD'].includes(method) ? undefined : '{}',
      });
      assert.strictEqual(result.status, 403, `${method} ${route} => ${result.status}: ${result.text}`);
    }
    console.log(`OK  ${denied.length} routes administratives refusées malgré une invitation valide`);

    for (const [method, route] of [
      ['GET', `/api/party/${created.body.code}/playlist`],
      ['GET', `/api/party/${created.body.code}/playlist/search?q=test`],
      ['POST', `/api/party/${created.body.code}/playlist/contributions`],
      ['DELETE', `/api/party/${created.body.code}/playlist/contributions/fake`],
      ['POST', `/api/party/${created.body.code}/playlist/votes`],
    ]) {
      const result = await request(REMOTE, route, {
        method,
        headers: { 'Content-Type': 'application/json', ...invitedHeaders, ...partyHeader },
        body: ['GET', 'HEAD'].includes(method) ? undefined : '{}',
      });
      assert.strictEqual(result.status, 403, `${method} ${route} sans jeton => ${result.status}`);
    }
    console.log('OK  les routes playlist joueur refusent un invité sans jeton joueur');
  } catch (error) {
    error.message += `\nSortie serveur :\n${serverOutput.slice(-4000)}`;
    throw error;
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
