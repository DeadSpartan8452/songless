'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const preflight = require('../lib/preflight');
const partyStore = require('../lib/party');
const QRCode = require('qrcode');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`OK  ${name}`);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-preflight-'));
  const musicDir = path.join(root, 'musiques');
  fs.mkdirSync(musicDir);
  fs.writeFileSync(path.join(musicDir, 'test.mp3'), Buffer.from('ID3 test audio'));
  try {
    await test('un fichier réel lisible valide le contrôle audio', () => {
      const files = preflight.listAudioFiles(musicDir);
      assert.deepStrictEqual(files, ['test.mp3']);
      assert.strictEqual(preflight.checkReadableAudio(musicDir, files).status, 'green');
    });
    await test('un salon temporaire valide QR et séparation des rôles', async () => {
      const check = await preflight.checkParty(partyStore, QRCode);
      assert.strictEqual(check.status, 'green');
    });
    await test('les outils facultatifs restent un avertissement', async () => {
      const report = await preflight.run({
        root, musicDir, tracks: { 'test.mp3': { title: 'Test' } },
        port: 3000, publicPort: 0, internetMode: false, publicUrl: '',
        dependenciesOk: true, defender: 'defender',
        tools: { ok: false, missing: ['yt-dlp'] }, partyStore, qrCode: QRCode,
      });
      assert.strictEqual(report.checks.find(item => item.id === 'tools').status, 'check');
      assert.strictEqual(report.summary.blocking, 0);
      assert.strictEqual(report.status, 'check');
    });
    await test('la route et l’interface sont réservées au diagnostic hôte', () => {
      const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      assert.match(server, /app\.post\('\/api\/preflight'/);
      assert.match(server, /Diagnostic réservé à l’ordinateur hôte/);
      assert.match(html, /id="preflight-btn"/);
      assert.match(html, /salon de test est supprimé automatiquement/);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} tests de diagnostic avant soirée réussis.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
