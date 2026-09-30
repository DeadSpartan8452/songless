#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const readline = require('readline/promises');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'app');
const PORT = Number(process.env.PORT || 3000);
const LAN = process.argv.includes('--lan');
const REPOSITORY = 'DeadSpartan8452/songless';
const WINDOWS_ASSET = 'Songless-Windows-x64.zip';
const LINUX_ASSET = 'Songless-Linux-x64.tar.gz';
const ANDROID_ASSET = 'Songless-Android.apk';
const CHECKSUM_ASSET = 'Songless-SHA256SUMS.txt';

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

async function launchCurrent() {
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

function httpsBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections GitHub.'));
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('URL non HTTPS refusée.'));
    const request = https.get(parsed, {
      headers: {
        'User-Agent': 'Songless-Updater',
        Accept: 'application/vnd.github+json',
      },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error('Redirection GitHub invalide.'));
        return resolve(httpsBuffer(new URL(location, parsed).toString(), redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`GitHub répond HTTP ${response.statusCode}.`));
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          request.destroy(new Error('Réponse GitHub trop volumineuse.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(30000, () => request.destroy(new Error('Délai GitHub dépassé.')));
    request.on('error', reject);
  });
}

function downloadAsset(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections GitHub.'));
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('URL non HTTPS refusée.'));
    const request = https.get(parsed, {headers: {'User-Agent': 'Songless-Updater'}}, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error('Redirection GitHub invalide.'));
        return resolve(downloadAsset(
          new URL(location, parsed).toString(), destination, redirects + 1
        ));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Téléchargement GitHub HTTP ${response.statusCode}.`));
      }
      const output = fs.createWriteStream(destination, {flags: 'wx'});
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
      response.on('error', reject);
    });
    request.setTimeout(10 * 60 * 1000, () => request.destroy(new Error('Délai de téléchargement dépassé.')));
    request.on('error', reject);
  });
}

function packageVersion(root) {
  try {
    return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim().replace(/^v/i, '');
  } catch (_) {
    return '0.0.0';
  }
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(n => !Number.isInteger(n))) {
    throw new Error('Numéro de version GitHub invalide.');
  }
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function updateFromGitHub() {
  if (await getContext(PORT)) {
    throw new Error('Ferme la partie Songless avant de lancer la mise à jour.');
  }
  const releaseBytes = await httpsBuffer(
    `https://api.github.com/repos/${REPOSITORY}/releases/latest`
  );
  const release = JSON.parse(releaseBytes.toString('utf8'));
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const currentVersion = packageVersion(ROOT);
  if (!release.tag_name || release.draft || release.prerelease) {
    throw new Error('Aucune version stable n’est publiée sur GitHub.');
  }
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    console.log(`Songless est déjà à jour (${release.tag_name}).`);
    return false;
  }

  const assets = new Map((release.assets || []).map(asset => [asset.name, asset]));
  const archiveAsset = assets.get(LINUX_ASSET);
  const checksumAsset = assets.get(CHECKSUM_ASSET);
  if (!archiveAsset || !checksumAsset) {
    throw new Error('Le paquet Linux ou son manifeste est absent de la Release.');
  }
  if (!Number.isSafeInteger(archiveAsset.size) || archiveAsset.size < 1
      || archiveAsset.size > 1024 * 1024 * 1024) {
    throw new Error('La taille du paquet Linux publiée est inattendue.');
  }

  fs.accessSync(ROOT, fs.constants.W_OK);
  const stage = fs.mkdtempSync(path.join(ROOT, '.songless-update-'));
  try {
    const sums = (await httpsBuffer(checksumAsset.browser_download_url)).toString('utf8');
    const escapedName = LINUX_ASSET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sumLine = sums.split(/\r?\n/).find(line =>
      new RegExp(`^([a-f0-9]{64})\\s+${escapedName}$`, 'i').test(line)
    );
    if (!sumLine) throw new Error('SHA-256 du paquet Linux absente du manifeste.');
    const expectedHash = sumLine.trim().split(/\s+/)[0].toLowerCase();
    const archivePath = path.join(stage, LINUX_ASSET);
    await downloadAsset(archiveAsset.browser_download_url, archivePath);
    const actualHash = crypto.createHash('sha256')
      .update(fs.readFileSync(archivePath)).digest('hex');
    if (actualHash !== expectedHash) throw new Error('SHA-256 du paquet Linux invalide.');

    const listing = spawnSync('tar', ['-tzf', archivePath], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (listing.status !== 0) throw new Error('Archive Linux illisible.');
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
    const forbidden = new Set([
      'musiques', 'metadata.json', 'metadata-backups', 'songless-data.json',
      'profiles', '.cache', '.git',
      '.songless-instance-key', '.songless-tailscale-account',
    ]);
    for (const entry of entries) {
      const name = entry.replace(/\\/g, '/');
      const pieces = name.split('/');
      if (name.startsWith('/') || pieces.includes('..')
          || pieces[0] !== 'Songless-Linux-x64'
          || pieces.some(piece => forbidden.has(piece.toLowerCase()))) {
        throw new Error('L’archive contient un chemin ou une donnée personnelle refusée.');
      }
    }

    const stagedPackage = path.join(stage, 'new');
    fs.mkdirSync(stagedPackage);
    const extracted = spawnSync('tar', [
      '-xzf', archivePath, '-C', stagedPackage,
      '--strip-components=1', '--no-same-owner',
    ], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
    if (extracted.status !== 0) throw new Error('Impossible d’extraire la mise à jour Linux.');
    for (const required of [
      'app/server.js', 'runtime/node', 'Songless', 'VERSION',
      'packaging/linux/update-after-exit.sh',
    ]) {
      if (!fs.existsSync(path.join(stagedPackage, required))) {
        throw new Error(`Fichier requis absent du paquet : ${required}`);
      }
    }

    const worker = path.join(stagedPackage, 'packaging/linux/update-after-exit.sh');
    fs.chmodSync(worker, 0o755);
    const child = spawn('/bin/sh', [worker, ROOT, stage, String(process.pid)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`Mise à jour ${release.tag_name} préparée.`);
    console.log('Songless va se fermer pour remplacer ses fichiers. Relance ./Songless ensuite.');
    return true;
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, {recursive: true, force: true});
    throw error;
  }
}

async function showMenu() {
  const terminal = readline.createInterface({input: process.stdin, output: process.stdout});
  try {
    console.log(`Songless — version ${packageVersion(ROOT)}`);
    console.log('1. Lancer la version actuelle');
    console.log('2. Mise à jour depuis GitHub');
    console.log('3. Quitter');
    const choice = (await terminal.question('Choix : ')).trim();
    if (choice === '1') {
      terminal.close();
      await launchCurrent();
      return;
    }
    if (choice === '2') {
      terminal.close();
      await updateFromGitHub();
      return;
    }
    if (choice !== '3') console.log('Choix invalide.');
  } finally {
    if (!terminal.closed) terminal.close();
  }
}

async function main() {
  if (process.argv.includes('--update')) return updateFromGitHub();
  if (LAN || process.argv.includes('--run')) return launchCurrent();
  return showMenu();
}

main().catch(error => {
  console.error(`Songless : ${error.message}`);
  process.exitCode = 1;
});
