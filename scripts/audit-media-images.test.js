'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const images = require('../lib/media-images');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

function padded(bytes) {
  return Buffer.concat([Buffer.from(bytes), Buffer.alloc(24)]);
}

test('les signatures PNG et JPEG cohérentes sont acceptées', () => {
  assert.strictEqual(images.validEmbeddedPicture({
    format: 'image/png', data: padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }), true);
  assert.strictEqual(images.validEmbeddedPicture({
    format: 'image/jpeg', data: padded([0xff, 0xd8, 0xff, 0xe0]),
  }), true);
});

test('une extension mensongère ou une image tronquée est refusée', () => {
  assert.strictEqual(images.validEmbeddedPicture({
    format: 'image/png', data: padded([0xff, 0xd8, 0xff]),
  }), false);
  assert.strictEqual(images.validEmbeddedPicture({
    format: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]),
  }), false);
});

test('le favicon local est un SVG autonome sans script ni réseau', () => {
  const favicon = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8');
  assert.strictEqual(images.safeLocalSvg(favicon), true);
});

test('un faux SVG actif ou distant est refusé', () => {
  assert.strictEqual(images.safeLocalSvg('<svg><script>alert(1)</script></svg>'), false);
  assert.strictEqual(images.safeLocalSvg('<svg><image href="https://example.test/a.png"/></svg>'), false);
});

console.log(`\n${passed} tests d'images locales réussis.`);
