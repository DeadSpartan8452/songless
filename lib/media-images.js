'use strict';

function startsWith(data, bytes) {
  return bytes.every((byte, index) => data[index] === byte);
}

function validEmbeddedPicture(picture) {
  return embeddedPictureInfo(picture).valid;
}

function jpegDimensions(data) {
  let offset = 2;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (offset + 4 > data.length) break;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) break;
    if (sof.has(marker) && length >= 7) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function uint24le(data, offset) {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function webpDimensions(data) {
  const chunk = data.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && data.length >= 30) {
    return { width: uint24le(data, 24) + 1, height: uint24le(data, 27) + 1 };
  }
  if (chunk === 'VP8 ' && data.length >= 30
      && startsWith(data.subarray(23), [0x9d, 0x01, 0x2a])) {
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function embeddedPictureInfo(picture) {
  const raw = picture && picture.data;
  const data = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
      : null;
  if (!data || data.length < 16) {
    return { valid: false, format: null, width: null, height: null, bytes: 0 };
  }
  const format = String(picture.format || '').toLowerCase();
  let dimensions = null;
  let valid = false;
  if ((format === 'image/jpeg' || format === 'image/jpg')
      && startsWith(data, [0xff, 0xd8, 0xff])) {
    valid = true;
    dimensions = jpegDimensions(data);
  } else if (format === 'image/png'
      && startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    valid = true;
    if (data.length >= 24 && data.subarray(12, 16).toString('ascii') === 'IHDR') {
      dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
  } else if (format === 'image/gif' && data.subarray(0, 4).toString('ascii') === 'GIF8') {
    valid = true;
    if (data.length >= 10) dimensions = { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  } else if (format === 'image/webp'
      && data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    valid = true;
    dimensions = webpDimensions(data);
  }
  const width = dimensions && Number(dimensions.width) > 0 ? Number(dimensions.width) : null;
  const height = dimensions && Number(dimensions.height) > 0 ? Number(dimensions.height) : null;
  return {
    valid,
    format: valid ? format.replace(/^image\//, '') : null,
    width,
    height,
    bytes: data.length,
  };
}

function safeLocalSvg(source) {
  const svg = String(source || '');
  const withoutStandardNamespace = svg.replace(
    /xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i,
    '',
  );
  return /^\s*<svg\b/i.test(svg)
    && /<\/svg>\s*$/i.test(svg)
    && !/<script\b|\bon\w+\s*=|javascript:|https?:\/\//i.test(withoutStandardNamespace);
}

module.exports = { embeddedPictureInfo, safeLocalSvg, validEmbeddedPicture };
