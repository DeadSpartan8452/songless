'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const DATABASES = ['main', 'daily'];
const BASE_URL = 'https://database.clamav.net/';
const MAX_DATABASE_SIZE = 256 * 1024 * 1024;
let activeUpdate = null;

function databaseDirectory() {
  return process.env.SONGLESS_CLAMAV_DB
    ? path.resolve(process.env.SONGLESS_CLAMAV_DB)
    : null;
}

function certificateDirectory() {
  return process.env.SONGLESS_CLAMAV_CERTS
    ? path.resolve(process.env.SONGLESS_CLAMAV_CERTS)
    : null;
}

function cvdHeader(file) {
  try {
    const descriptor = fs.openSync(file, 'r');
    const bytes = Buffer.alloc(512);
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    fs.closeSync(descriptor);
    const fields = bytes.subarray(0, length).toString('ascii').split(':');
    if (fields[0] !== 'ClamAV-VDB' || !/^\d+$/.test(fields[2] || '')) return null;
    return {date: fields[1] || null, version: Number(fields[2])};
  } catch (_) {
    return null;
  }
}

function status() {
  const directory = databaseDirectory();
  const certificates = certificateDirectory();
  const files = {};
  for (const name of DATABASES) {
    const file = directory ? path.join(directory, `${name}.cvd`) : '';
    const header = file ? cvdHeader(file) : null;
    files[name] = header ? {...header, bytes: fs.statSync(file).size} : null;
  }
  const certificate = certificates ? path.join(certificates, 'clamav.crt') : '';
  return {
    configured: Boolean(directory && certificates),
    ready: Boolean(files.main && files.daily && fs.existsSync(certificate)),
    updating: Boolean(activeUpdate),
    files,
  };
}

function userAgent() {
  const abi = String(process.env.SONGLESS_ANDROID_ABI || 'arm64-v8a')
    .replace('arm64-v8a', 'aarch64');
  return `ClamAV/1.5.4 (OS: linux-android, ARCH: ${abi}, CPU: ${abi})`;
}

function request(url, options, handler) {
  const req = https.get(url, {
    ...options,
    headers: {...(options && options.headers), 'User-Agent': userAgent()},
  }, response => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      request(new URL(response.headers.location, url).href, options, handler);
      return;
    }
    handler(response);
  });
  req.setTimeout(180000, () => req.destroy(new Error('Téléchargement antivirus expiré.')));
  return req;
}

function remoteHeader(name) {
  return new Promise((resolve, reject) => {
    const req = request(`${BASE_URL}${name}.cvd`, {headers: {Range: 'bytes=0-511'}}, response => {
      if (![200, 206].includes(response.statusCode)) {
        response.resume();
        reject(new Error(`Base ${name} inaccessible (HTTP ${response.statusCode}).`));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        if (total < 512) chunks.push(chunk.subarray(0, 512 - total));
        total += chunk.length;
        if (total >= 512) response.destroy();
      });
      response.on('close', () => {
        const fields = Buffer.concat(chunks).toString('ascii').split(':');
        if (fields[0] !== 'ClamAV-VDB' || !/^\d+$/.test(fields[2] || '')) {
          reject(new Error(`En-tête de la base ${name} invalide.`));
          return;
        }
        resolve({date: fields[1] || null, version: Number(fields[2])});
      });
      response.on('error', reject);
    });
    req.on('error', reject);
  });
}

function downloadDatabase(name, destination, progress) {
  return new Promise((resolve, reject) => {
    const partial = `${destination}.partial`;
    fs.rmSync(partial, {force: true});
    const req = request(`${BASE_URL}${name}.cvd`, {}, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Téléchargement de ${name}.cvd refusé (HTTP ${response.statusCode}).`));
        return;
      }
      const announced = Number(response.headers['content-length']) || 0;
      if (announced > MAX_DATABASE_SIZE) {
        response.resume();
        reject(new Error(`Base ${name}.cvd anormalement volumineuse.`));
        return;
      }
      const output = fs.createWriteStream(partial, {flags: 'wx'});
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_DATABASE_SIZE) response.destroy(new Error('Base antivirus trop volumineuse.'));
        if (progress) progress({name, received, total: announced});
      });
      response.pipe(output);
      response.on('error', reject);
      output.on('error', reject);
      output.on('finish', () => output.close(() => {
        const header = cvdHeader(partial);
        if (!header) {
          fs.rmSync(partial, {force: true});
          reject(new Error(`Base ${name}.cvd téléchargée mais invalide.`));
          return;
        }
        fs.rmSync(destination, {force: true});
        fs.renameSync(partial, destination);
        resolve(header);
      }));
    });
    req.on('error', error => {
      fs.rmSync(partial, {force: true});
      reject(error);
    });
  });
}

async function performUpdate(progress) {
  const directory = databaseDirectory();
  if (!directory || !certificateDirectory()) {
    throw new Error('Runtime antivirus Android non configuré.');
  }
  fs.mkdirSync(directory, {recursive: true});
  const updated = [];
  for (const name of DATABASES) {
    const destination = path.join(directory, `${name}.cvd`);
    const [remote, local] = await Promise.all([
      remoteHeader(name),
      Promise.resolve(cvdHeader(destination)),
    ]);
    if (local && local.version >= remote.version) continue;
    await downloadDatabase(name, destination, progress);
    updated.push(name);
  }
  return {updated, status: status()};
}

function update(progress) {
  if (activeUpdate) return activeUpdate;
  activeUpdate = performUpdate(progress).finally(() => { activeUpdate = null; });
  return activeUpdate;
}

module.exports = {
  BASE_URL, DATABASES, MAX_DATABASE_SIZE, certificateDirectory, cvdHeader,
  databaseDirectory, status, update, userAgent,
};
