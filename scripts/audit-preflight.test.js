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
    await test('les dépendances sont résolues depuis la racine embarquée', () => {
      const esmRoot = path.join(root, 'node_modules', 'module-esm-only');
      fs.mkdirSync(esmRoot, { recursive: true });
      fs.writeFileSync(path.join(esmRoot, 'package.json'), JSON.stringify({
        name: 'module-esm-only',
        type: 'module',
        exports: { import: './index.js' },
      }));
      fs.writeFileSync(path.join(esmRoot, 'index.js'), 'export default true;');
      const available = preflight.checkDependencies(
        path.join(__dirname, '..'),
        { qrcode: '^1.5.4' }
      );
      assert.deepStrictEqual(available, { ok: true, missing: [] });
      const esmOnly = preflight.checkDependencies(root, {
        'module-esm-only': '1.0.0',
      });
      assert.deepStrictEqual(esmOnly, { ok: true, missing: [] });
      const unavailable = preflight.checkDependencies(root, {
        'module-songless-absent': '1.0.0',
      });
      assert.deepStrictEqual(unavailable, {
        ok: false,
        missing: ['module-songless-absent'],
      });
    });
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
        dependenciesOk: true,
        antivirus: { available: true, id: 'defender', name: 'Microsoft Defender' },
        tools: { ok: false, missing: ['yt-dlp'] }, partyStore, qrCode: QRCode,
      });
      assert.strictEqual(report.checks.find(item => item.id === 'tools').status, 'check');
      assert.strictEqual(report.checks.find(item => item.id === 'speakers').status, 'check');
      assert.strictEqual(report.summary.blocking, 0);
      assert.strictEqual(report.status, 'check');
    });
    await test('Android reçoit une réparation adaptée et le module absent', async () => {
      const report = await preflight.run({
        root, musicDir, tracks: { 'test.mp3': { title: 'Test' } },
        port: 3000, publicPort: 0, internetMode: false, publicUrl: '',
        dependenciesOk: false,
        missingDependencies: ['module-test'],
        mobileHost: true,
        antivirus: { available: true, name: 'ClamAV' },
        tools: { ok: true, missing: [] }, partyStore, qrCode: QRCode,
      });
      const dependency = report.checks.find(item => item.id === 'node');
      assert.strictEqual(dependency.status, 'blocking');
      assert.match(dependency.detail, /module-test/);
      assert.match(dependency.action, /APK Songless/);
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
