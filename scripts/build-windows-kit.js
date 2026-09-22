'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUTPUT = path.join(DIST, 'Songless-Windows-x64');
const PAYLOAD = path.join(OUTPUT, 'payload');
const APP_FILES = [
  'server.js', 'package.json', 'package-lock.json',
  'Songless.bat', 'Songless.ps1', 'Songless (internet).bat',
  'Songless (telephone).bat',
];
const APP_DIRECTORIES = ['lib', 'public', 'tools', 'node_modules'];
const FORBIDDEN_PARTS = new Set([
  'musiques', '.cache', '.git', 'metadata-backups', 'dist',
  'metadata.json', 'songless-data.json', '.songless-instance-key',
  '.songless-tailscale-account',
]);

function safeOutput() {
  const resolved = path.resolve(OUTPUT);
  const expectedParent = `${path.resolve(DIST)}${path.sep}`;
  if (!resolved.startsWith(expectedParent) || path.basename(resolved) !== 'Songless-Windows-x64') {
    throw new Error('Destination du kit refusée.');
  }
  return resolved;
}

function allowed(relative) {
  const parts = String(relative).split(/[\\/]/).filter(Boolean);
  return !FORBIDDEN_PARTS.has(parts[0]);
}

function copy(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: file => allowed(path.relative(ROOT, file)),
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesUnder(directory) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  visit(directory);
  return files.sort();
}

function findExecutable(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true });
  return found.status === 0
    ? String(found.stdout).split(/\r?\n/).map(line => line.trim()).find(fs.existsSync) || null
    : null;
}

function copyOptionalTools(appRoot) {
  const bin = path.join(appRoot, 'tools', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const direct = [findExecutable('yt-dlp.exe'), findExecutable('ffmpeg.exe'), findExecutable('ffprobe.exe')]
    .filter(Boolean);
  for (const executable of direct) {
    const destination = path.join(bin, path.basename(executable));
    if (!fs.existsSync(destination)) fs.copyFileSync(executable, destination);
  }
  return direct.map(file => path.basename(file));
}

function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Ce constructeur produit uniquement le kit Windows x64 réellement testable ici.');
  }
  const output = safeOutput();
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
  const appRoot = path.join(PAYLOAD, 'app');
  const runtimeRoot = path.join(PAYLOAD, 'runtime');
  fs.mkdirSync(appRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  for (const relative of APP_FILES) copy(path.join(ROOT, relative), path.join(appRoot, relative));
  for (const relative of APP_DIRECTORIES) copy(path.join(ROOT, relative), path.join(appRoot, relative));
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'node.exe'));
  const tools = copyOptionalTools(appRoot);

  const templates = path.join(ROOT, 'packaging', 'windows');
  for (const name of ['Lancer-Songless.ps1', 'Songless.bat', 'Songless-local.bat', 'Songless-WiFi.bat', 'Songless-Internet.bat']) {
    fs.copyFileSync(path.join(templates, name), path.join(PAYLOAD, name));
  }
  for (const name of ['Installer-Songless.ps1', 'Installer Songless.bat']) {
    fs.copyFileSync(path.join(templates, name), path.join(OUTPUT, name));
  }

  const files = filesUnder(PAYLOAD).map(file => ({
    path: path.relative(OUTPUT, file).replace(/\\/g, '/'),
    size: fs.statSync(file).size,
    sha256: sha256(file),
  }));
  const manifest = {
    format: 1,
    product: 'Songless',
    platform: 'win32',
    arch: 'x64',
    node: process.version,
    optionalTools: tools,
    personalDataIncluded: false,
    generatedAt: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(path.join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { output, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), tools };
}

if (require.main === module) {
  const report = build();
  console.log(`Kit Windows créé : ${report.output}`);
  console.log(`${report.files} fichiers · ${Math.round(report.bytes / 1024 / 1024)} Mo`);
  console.log(`Outils intégrés : ${report.tools.join(', ') || 'aucun'}`);
}

module.exports = { APP_DIRECTORIES, APP_FILES, FORBIDDEN_PARTS, allowed, build, safeOutput };
