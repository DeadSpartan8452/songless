'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'lib', 'enricher.js'), 'utf8');
const bulkTool = fs.readFileSync(path.join(root, 'tools', 'enrich.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

assert.doesNotMatch(runtime, /title\s*=\s*ov\.title/);
assert.doesNotMatch(runtime, /title\s*=\s*T\.translit/);
assert.doesNotMatch(bulkTool, /title\s*=\s*ov\.title/);
assert.doesNotMatch(bulkTool, /title\s*=\s*(?:translated|T\.translit)/);
assert.match(runtime, /\[ov\.title, ov\.originalTitle, \.\.\.\(ov\.aliases/);
assert.match(bulkTool, /\[ov\.title, ov\.originalTitle, \.\.\.\(ov\.aliases/);
assert.match(page, /id="edit-current-track-btn"/);
assert.match(app, /openEditModal\(currentTrack\)/);
assert.match(app, /currentTrack\.id === editedId/);

console.log('OK  le titre source reste stable et le renommage post-révélation est câblé');
