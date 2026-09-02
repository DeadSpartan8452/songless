'use strict';

function startsWith(data, bytes) {
  return bytes.every((byte, index) => data[index] === byte);
}

function validEmbeddedPicture(picture) {
  if (!picture || !Buffer.isBuffer(picture.data) || picture.data.length < 16) return false;
  const data = picture.data;
  const format = String(picture.format || '').toLowerCase();
  if ((format === 'image/jpeg' || format === 'image/jpg')
      && startsWith(data, [0xff, 0xd8, 0xff])) return true;
  if (format === 'image/png'
      && startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  if (format === 'image/gif' && data.subarray(0, 4).toString('ascii') === 'GIF8') return true;
  if (format === 'image/webp'
      && data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
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

module.exports = { safeLocalSvg, validEmbeddedPicture };
