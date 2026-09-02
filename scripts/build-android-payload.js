'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOST = path.join(ROOT, 'mobile', 'android-host');
const PAYLOAD = path.join(HOST, 'nodejs-assets', 'nodejs-project');
const APP_FILES = ['server.js', 'package.json', 'package-lock.json'];
const APP_DIRECTORIES = ['lib', 'public', 'tools'];

function safePayload() {
  const resolved = path.resolve(PAYLOAD);
  const expected = path.resolve(ROOT, 'mobile', 'android-host', 'nodejs-assets');
  if (path.dirname(resolved) !== expected || path.basename(resolved) !== 'nodejs-project') {
    throw new Error('Destination Android refusée.');
  }
  return resolved;
}

function copy(relative) {
  fs.cpSync(path.join(ROOT, relative), path.join(PAYLOAD, relative), {recursive: true});
}

function build() {
  const output = safePayload();
  if (fs.existsSync(output)) fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  APP_FILES.forEach(copy);
  APP_DIRECTORIES.forEach(copy);
  fs.copyFileSync(path.join(HOST, 'node-main.js'), path.join(output, 'main.js'));

  const npmCli = process.env.npm_execpath
    || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const install = spawnSync(process.execPath,
    [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit'], {
    cwd: output,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (install.status !== 0) {
    throw new Error(`Installation des dépendances Android impossible : ${install.error || install.status}`);
  }

  const forbidden = ['musiques', 'metadata.json', 'songless-data.json', '.songless-instance-key'];
  for (const name of forbidden) {
    if (fs.existsSync(path.join(output, name))) throw new Error(`Donnée privée incluse : ${name}`);
  }
  return output;
}

if (require.main === module) console.log(`Payload Android prêt : ${build()}`);

module.exports = {APP_DIRECTORIES, APP_FILES, PAYLOAD, build, safePayload};
