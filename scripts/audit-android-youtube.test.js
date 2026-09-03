'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-android-youtube-'));
process.env.SONGLESS_MOBILE_HOST = '1';
process.env.SONGLESS_MUSIC_DIR = path.join(root, 'music');

const youtube = require('../lib/youtube-android');
const downloader = require('../lib/downloader');

async function run() {
  assert.strictEqual(youtube.extractVideoId('https://youtu.be/y6120QOlsfU'), 'y6120QOlsfU');
  assert.strictEqual(
    youtube.extractVideoId('https://www.youtube.com/watch?v=y6120QOlsfU&list=PL1234567890'),
    'y6120QOlsfU',
  );
  assert.strictEqual(
    youtube.extractPlaylistId('https://www.youtube.com/playlist?list=PL1234567890'),
    'PL1234567890',
  );
  assert.throws(() => youtube.extractVideoId('https://example.test/y6120QOlsfU'), /invalide/);
  assert.throws(
    () => youtube.validateStreamUrl('https://example.test/audio.m4a'),
    /refusée/,
  );

  const tools = downloader.checkTools();
  assert.deepStrictEqual(tools.missing, []);
  assert.strictEqual(tools.engine, 'youtubejs');
  assert.strictEqual(downloader.MUSIC_DIR, process.env.SONGLESS_MUSIC_DIR);

  const source = Buffer.alloc(youtube.CHUNK_BYTES + 123, 0x5a);
  const progress = [];
  const destination = path.join(root, 'download', 'probe.m4a');
  const fakeFetch = async value => {
    const parsed = new URL(value);
    const [start, end] = parsed.searchParams.get('range').split('-').map(Number);
    const body = Uint8Array.from(source.subarray(start, end + 1)).buffer;
    return {ok: true, status: 200, arrayBuffer: async () => body};
  };
  const result = await youtube.downloadFormat({
    url: 'https://r1---sn-test.googlevideo.com/videoplayback?id=test',
    content_length: source.length,
  }, destination, {
    fetchImpl: fakeFetch,
    onProgress: (received, total) => progress.push([received, total]),
  });

  assert.strictEqual(result.bytes, source.length);
  assert.deepStrictEqual(fs.readFileSync(destination), source);
  assert.deepStrictEqual(progress.at(-1), [source.length, source.length]);
  assert.strictEqual(fs.existsSync(`${destination}.partial`), false);

  const metadata = youtube.infoToMetadata({basic_info: {
    title: 'Artiste - Titre',
    channel: {name: 'Artiste'},
    duration: 201,
    view_count: 42,
  }}, 'y6120QOlsfU');
  assert.strictEqual(metadata.title, 'Artiste - Titre');
  assert.strictEqual(metadata.uploader, 'Artiste');
  assert.strictEqual(metadata.duration, 201);

  console.log('OK  moteur YouTube Android, stockage persistant et flux M4A contrôlés');
}

run().finally(() => fs.rmSync(root, {recursive: true, force: true}));
