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
  fs.cpSync(path.join(ROOT, relative), path.join(PAYLOAD, relative), {
    recursive: true,
    filter: file => relative !== 'tools' || !/\.(exe|cmd|bat|ps1)$/i.test(file),
  });
}

function patchPathToRegexpForNodeMobile(output) {
  const target = path.join(
    output,
    'node_modules',
    'path-to-regexp',
    'dist',
    'index.js'
  );
  let source = fs.readFileSync(target, 'utf8');
  const replacements = [
    [
      'const ID_START = /^[$_\\p{ID_Start}]$/u;',
      'const ID_START = /^[$_A-Za-z]$/;',
    ],
    [
      'const ID_CONTINUE = /^[$\\u200c\\u200d\\p{ID_Continue}]$/u;',
      'const ID_CONTINUE = /^[$\\u200c\\u200dA-Za-z0-9]$/;',
    ],
    [
      'const ID = /^[$_\\p{ID_Start}][$\\u200c\\u200d\\p{ID_Continue}]*$/u;',
      'const ID = /^[$_A-Za-z][$_\\u200c\\u200dA-Za-z0-9]*$/;',
    ],
  ];

  for (const [original, compatible] of replacements) {
    if (!source.includes(original)) {
      throw new Error('Version de path-to-regexp Android non reconnue.');
    }
    source = source.replace(original, compatible);
  }
  fs.writeFileSync(target, source, 'utf8');
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
  patchPathToRegexpForNodeMobile(output);

  const forbidden = ['musiques', 'metadata.json', 'songless-data.json', '.songless-instance-key'];
  for (const name of forbidden) {
    if (fs.existsSync(path.join(output, name))) throw new Error(`Donnée privée incluse : ${name}`);
  }
  return output;
}

if (require.main === module) console.log(`Payload Android prêt : ${build()}`);

module.exports = {
  APP_DIRECTORIES,
  APP_FILES,
  PAYLOAD,
  build,
  patchPathToRegexpForNodeMobile,
  safePayload,
};
