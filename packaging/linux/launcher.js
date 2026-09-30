#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'app');
const PORT = Number(process.env.PORT || 3000);
const LAN = process.argv.includes('--lan');

function xdgPath(variable, fallback) {
  const supplied = process.env[variable];
  return supplied && path.isAbsolute(supplied) ? supplied : fallback;
}

function getContext(port) {
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/context',
      timeout: 1200,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          const context = JSON.parse(body);
          const valid = response.statusCode === 200
            && typeof context.deviceLocal === 'boolean'
            && typeof context.mobileHost === 'boolean'
            && typeof context.lan === 'boolean'
            && context.port === port;
          resolve(valid ? context : null);
        } catch (_) {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function openBrowser(url) {
  const opener = spawn('xdg-open', [url], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  opener.once('error', () => {
    console.log(`Ouvre cette adresse dans ton navigateur : ${url}`);
  });
  opener.unref();
}

function waitForServer(child, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const finish = (error, context) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      child.removeListener('exit', exited);
      if (error) reject(error);
      else resolve(context);
    };

    const exited = code => finish(new Error(
      `Le serveur Songless s'est arrêté (code ${code === null ? 'inconnu' : code}).`
    ));

    const timer = setInterval(async () => {
      if (Date.now() - startedAt > timeoutMs) {
        return finish(new Error('Songless ne répond pas après 20 secondes.'));
      }
      const context = await getContext(port);
      if (context) finish(null, context);
    }, 350);

    child.once('exit', exited);
  });
}

async function main() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT doit être un numéro entre 1 et 65535.');
  }
  if (!fs.existsSync(path.join(APP, 'server.js'))
      || !fs.existsSync(path.join(ROOT, 'runtime', 'node'))) {
    throw new Error('Le paquet Songless Linux est incomplet.');
  }

  const dataHome = xdgPath(
    'XDG_DATA_HOME', path.join(os.homedir(), '.local', 'share')
  );
  const cacheHome = xdgPath(
    'XDG_CACHE_HOME', path.join(os.homedir(), '.cache')
  );
  const dataRoot = path.join(dataHome, 'songless');
  const cacheRoot = path.join(cacheHome, 'songless');
  const musicRoot = process.env.SONGLESS_MUSIC_DIR
    ? path.resolve(process.env.SONGLESS_MUSIC_DIR)
    : path.join(dataRoot, 'musiques');

  for (const directory of [dataRoot, cacheRoot, musicRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const existing = await getContext(PORT);
  if (existing) {
    if (LAN && !existing.lan) {
      throw new Error(
        'Songless tourne déjà sans le mode réseau. Ferme-le avant de le relancer avec --lan.'
      );
    }
    openBrowser(`http://127.0.0.1:${PORT}/`);
    console.log('Songless est déjà lancé ; aucun second serveur n’a été créé.');
    return;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const environment = {
    ...process.env,
    PORT: String(PORT),
    SONGLESS_INSTANCE_SECRET: token,
    SONGLESS_MUSIC_DIR: musicRoot,
    SONGLESS_METADATA_FILE: path.join(dataRoot, 'metadata.json'),
    SONGLESS_METADATA_BACKUP_DIR: path.join(dataRoot, 'metadata-backups'),
    SONGLESS_DATA_FILE: path.join(dataRoot, 'songless-data.json'),
    SONGLESS_BACKUP_DIR: path.join(dataRoot, 'metadata-backups'),
    SONGLESS_CACHE_DIR: cacheRoot,
  };
  delete environment.SONGLESS_TEST_ALLOW_LOCAL_ADMIN;
  delete environment.SONGLESS_TAILSCALE_ACCOUNT_FILE;

  const node = path.join(ROOT, 'runtime', 'node');
  const argumentsForServer = [path.join(APP, 'server.js')];
  if (LAN) argumentsForServer.push('--lan');

  const child = spawn(node, argumentsForServer, {
    cwd: APP,
    env: environment,
    stdio: 'inherit',
  });

  child.once('error', error => {
    console.error(`Impossible de démarrer le serveur : ${error.message}`);
  });

  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null && !child.killed) child.kill(signal);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => stop(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM'));
  }
  child.once('exit', code => {
    process.exitCode = code || 0;
  });

  try {
    await waitForServer(child, PORT, 20000);
  } catch (error) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    throw error;
  }
  const url = `http://127.0.0.1:${PORT}/admin-bootstrap?token=${encodeURIComponent(token)}`;
  openBrowser(url);
  console.log(`Songless est prêt : http://127.0.0.1:${PORT}`);
  console.log(`Données personnelles conservées dans : ${dataRoot}`);
  if (LAN) console.log('Mode réseau local actif ; scanne le QR affiché dans ce terminal.');
}

main().catch(error => {
  console.error(`Songless : ${error.message}`);
  process.exitCode = 1;
});
