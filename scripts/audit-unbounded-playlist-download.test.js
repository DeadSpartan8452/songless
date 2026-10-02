'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const downloader = require('../lib/downloader');

const url = 'https://www.youtube.com/playlist?list=PLabcdefghijk';
const unboundedArgs = downloader.playlistListArgs(url, Infinity, true);
assert.strictEqual(unboundedArgs.includes('--playlist-end'), false);
assert.deepStrictEqual(unboundedArgs.slice(0, 3), [url, '--flat-playlist', '--dump-json']);

const boundedArgs = downloader.playlistListArgs(url, 500, false);
assert.strictEqual(boundedArgs[boundedArgs.indexOf('--playlist-end') + 1], '501');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
assert.match(html, /Playlist entière · sans plafond/);
assert.doesNotMatch(html, /id="playlist-limit"|Nombre maximum de titres/);
assert.doesNotMatch(app, /playlist-limit|limite:\s*Number\(/);
assert.doesNotMatch(app, /playlist est plus longue que le plafond/);
assert.match(server, /noLimit:\s*true/);
assert.match(readme, /tous ses\s+titres sont parcourus sans plafond/);

console.log('OK  l’import YouTube énumère et télécharge la playlist entière');
