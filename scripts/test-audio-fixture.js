'use strict';

const fs = require('fs');
const path = require('path');

function writeSyntheticWav(directory, filename = 'audit-synthetique.wav') {
  const sampleRate = 8000;
  const sampleCount = sampleRate * 6;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index++) {
    const value = Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 8000);
    wav.writeInt16LE(value, 44 + index * 2);
  }

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, filename), wav);
  return filename;
}

module.exports = { writeSyntheticWav };
