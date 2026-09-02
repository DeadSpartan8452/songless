'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bridge = require('rn-bridge');

const port = 3000;
const dataRoot = path.join(bridge.app.datadir(), 'Songless-Data');
const musicRoot = path.join(dataRoot, 'musiques');
const backupRoot = path.join(dataRoot, 'metadata-backups');
const bootstrapToken = crypto.randomBytes(32).toString('base64url');

for (const directory of [dataRoot, musicRoot, backupRoot]) {
  fs.mkdirSync(directory, {recursive: true});
}

process.env.PORT = String(port);
process.env.SONGLESS_LAN = '1';
process.env.SONGLESS_MOBILE_HOST = '1';
process.env.SONGLESS_INSTANCE_SECRET = bootstrapToken;
process.env.SONGLESS_MUSIC_DIR = musicRoot;
process.env.SONGLESS_METADATA_FILE = path.join(dataRoot, 'metadata.json');
process.env.SONGLESS_METADATA_BACKUP_DIR = backupRoot;
process.env.SONGLESS_DATA_FILE = path.join(dataRoot, 'songless-data.json');
process.env.SONGLESS_BACKUP_DIR = backupRoot;

function send(message) {
  bridge.channel.send(message);
}

function retry(attempt, detail) {
  if (attempt >= 30) {
    send({type: 'error', detail: `Serveur local indisponible : ${detail}`});
    return;
  }
  setTimeout(() => waitForServer(attempt + 1), 350);
}

function waitForServer(attempt = 0) {
  const request = http.get(`http://127.0.0.1:${port}/api/context`, response => {
    response.resume();
    if (response.statusCode === 200) {
      send({type: 'ready', url: `http://127.0.0.1:${port}/admin-bootstrap?token=${bootstrapToken}`});
      return;
    }
    retry(attempt, `HTTP ${response.statusCode}`);
  });
  request.setTimeout(1200, () => request.destroy(new Error('timeout')));
  request.on('error', error => retry(attempt, error.message));
}

process.on('uncaughtException', error => {
  send({type: 'error', detail: error && error.message ? error.message : String(error)});
});
process.on('unhandledRejection', error => {
  send({type: 'error', detail: error && error.message ? error.message : String(error)});
});

require('./server');
waitForServer();
