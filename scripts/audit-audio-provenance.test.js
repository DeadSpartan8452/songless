'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeID3 = require('node-id3');
const provenance = require('../lib/audio-provenance');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-provenance-'));
try {
  const file = path.join(root, 'synthetic.mp3');
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x01, 0x02, 0x03]);
  const initialTag = NodeID3.create({
    title: 'Titre synthétique',
    artist: 'Artiste synthétique',
    userDefinedText: [{ description: 'AUTRE_APPLICATION', value: 'à conserver' }],
  });
  fs.writeFileSync(file, Buffer.concat([initialTag, audio]));

  const result = provenance.tagProfile(file, {
    kind: 'profile', profileId: 'synthetic_profile', label: 'Profil synthétique',
  });
  assert.strictEqual(result.status, 'tagged');
  const tags = NodeID3.read(file);
  assert.strictEqual(tags.title, 'Titre synthétique');
  assert.strictEqual(tags.artist, 'Artiste synthétique');
  assert.ok(tags.userDefinedText.some(item => item.description === 'AUTRE_APPLICATION'
    && item.value === 'à conserver'));
  assert.deepStrictEqual(NodeID3.removeTagsFromBuffer(fs.readFileSync(file)), audio);
  assert.deepStrictEqual(provenance.sourceFromFile(file), {
    id: 'profile:synthetic_profile', label: 'Profil synthétique',
    kind: 'profile', profileId: 'synthetic_profile',
  });
  assert.strictEqual(provenance.tagProfile(file, {
    kind: 'profile', profileId: 'synthetic_profile', label: 'Profil synthétique',
  }).profileCount, 1);
  const repeatedTags = NodeID3.read(file);
  const songlessFrames = repeatedTags.userDefinedText.filter(item =>
    item.description === provenance.PROFILE_FRAME);
  assert.strictEqual(songlessFrames.length, 1);

  const flac = path.join(root, 'synthetic.flac');
  const untouched = Buffer.from('fLaC synthetic fixture');
  fs.writeFileSync(flac, untouched);
  assert.strictEqual(provenance.tagProfile(flac, {
    kind: 'profile', profileId: 'synthetic_profile', label: 'Profil synthétique',
  }).status, 'metadata-json-only');
  assert.deepStrictEqual(fs.readFileSync(flac), untouched);

  console.log('OK  provenance MP3 conservée dans ID3 sans toucher au flux audio');
  console.log('OK  tags existants conservés et source reconstruite depuis le tag');
  console.log('OK  les autres formats restent intacts avec metadata.json comme secours');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
