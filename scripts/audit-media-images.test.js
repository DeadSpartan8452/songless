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

test('les dimensions PNG et JPEG sont lues depuis les octets réels', () => {
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  Buffer.from('IHDR').copy(png, 12);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepStrictEqual(
    (({ valid, width, height }) => ({ valid, width, height }))(
      images.embeddedPictureInfo({ format: 'image/png', data: png })
    ),
    { valid: true, width: 640, height: 480 }
  );

  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x07, 0x08, 0x01, 0x2c, 0x01, 0x90,
    0xff, 0xd9,
  ]);
  const info = images.embeddedPictureInfo({ format: 'image/jpeg', data: jpeg });
  assert.deepStrictEqual({ valid: info.valid, width: info.width, height: info.height }, {
    valid: true, width: 400, height: 300,
  });
});

test('les octets Uint8Array de music-metadata sont acceptés sans copie de format', () => {
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  Buffer.from('IHDR').copy(png, 12);
  png.writeUInt32BE(300, 16);
  png.writeUInt32BE(300, 20);
  const bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  const info = images.embeddedPictureInfo({ format: 'image/png', data: bytes });
  assert.strictEqual(info.valid, true);
  assert.strictEqual(info.width, 300);
  assert.strictEqual(info.height, 300);
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
