'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'lib', 'enricher.js'), 'utf8');
const downloader = fs.readFileSync(path.join(root, 'lib', 'downloader.js'), 'utf8');
const bulkTool = fs.readFileSync(path.join(root, 'tools', 'enrich.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const titles = require('../lib/titles');

assert.doesNotMatch(runtime, /title\s*=\s*ov\.title/);
assert.doesNotMatch(runtime, /title\s*=\s*T\.translit/);
assert.doesNotMatch(bulkTool, /title\s*=\s*ov\.title/);
assert.doesNotMatch(bulkTool, /title\s*=\s*(?:translated|T\.translit)/);
assert.doesNotMatch(downloader, /title\s*=\s*ov\.title/);
assert.match(downloader, /const sourceStem = safeFileName\(info\.title \|\| info\.track/);
assert.match(downloader, /metadataLookupTitle: searchableTitle\.trim\(\)/);
assert.match(runtime, /\[ov\.title, ov\.originalTitle, \.\.\.\(ov\.aliases/);
assert.match(bulkTool, /\[ov\.title, ov\.originalTitle, \.\.\.\(ov\.aliases/);
assert.match(page, /id="edit-current-track-btn"/);
assert.doesNotMatch(page, /id="download-title"/);
assert.match(app, /openEditModal\(currentTrack\)/);
assert.match(app, /currentTrack\.id === editedId/);

const safeOrder = titles.detectSwappedSides([
  { fileName: 'one', artist: 'Track One', title: 'Artist Shared' },
  { fileName: 'two', artist: 'Track Two', title: 'Artist Shared' },
  { fileName: 'three', artist: 'Track Three', title: 'Artist Shared' },
]);
assert.deepStrictEqual([...safeOrder], ['one', 'two', 'three']);
const ambiguousOrder = titles.detectSwappedSides([
  { fileName: 'one', artist: 'Shared Name', title: 'Shared Name' },
  { fileName: 'two', artist: 'Shared Name', title: 'Shared Name' },
  { fileName: 'three', artist: 'Other Artist', title: 'Shared Name' },
]);
assert.strictEqual(ambiguousOrder.has('one'), false);
assert.strictEqual(ambiguousOrder.has('two'), false);

console.log('OK  le titre source reste stable et le renommage post-révélation est câblé');
