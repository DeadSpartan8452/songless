'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-mb-'));
process.env.SONGLESS_CACHE_DIR = cacheDir;

const automatic = require('../lib/automatic-metadata');
const downloader = require('../lib/downloader');
const musicbrainz = require('../lib/musicbrainz');
const metadataAutoSource = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'metadata-auto.js'), 'utf8'
);

(async () => {
  const uploadOnly = downloader.buildEntry({
    id: 'video-test',
    title: 'Artiste fiable - Morceau fiable',
    uploader: 'Chaîne vidéo',
    upload_date: '20240102',
    duration: 180,
  });
  assert.strictEqual(uploadOnly.year, 2024);
  assert.strictEqual(uploadOnly.yearSource, 'youtube-upload');
  assert.strictEqual(uploadOnly.yearConfidence, 'low');
  assert.strictEqual(uploadOnly.artistSource, 'filename');
  assert.strictEqual(uploadOnly.title, 'Artiste fiable - Morceau fiable');
  assert.strictEqual(uploadOnly.metadataLookupTitle, 'Morceau fiable');

  const release = downloader.buildEntry({
    id: 'video-release',
    track: 'Morceau fiable',
    artist: 'Artiste fiable',
    release_year: 1998,
    duration: 180,
  });
  assert.strictEqual(release.yearSource, 'youtube');
  assert.strictEqual(release.yearConfidence, 'medium');

  const patch = automatic.proposition(uploadOnly, {
    id: 'mbid-test',
    title: 'Morceau fiable',
    artist: 'Artiste fiable',
    year: 1998,
    album: 'Album fiable',
    genre: 'Rock',
  }, '2026-09-04T00:00:00.000Z');
  assert.strictEqual(patch.artist, 'Artiste fiable');
  assert.strictEqual(patch.year, 1998);
  assert.strictEqual(patch.yearSource, 'musicbrainz');
  assert.strictEqual(patch.genreSource, 'musicbrainz');
  assert.strictEqual(patch.album, 'Album fiable');

  const manual = automatic.proposition({
    title: 'Titre choisi',
    artist: 'Artiste choisi',
    artistSource: 'manual',
    artistConfidence: 'high',
    genre: 'Jazz',
    genreSource: 'manual',
    genreConfidence: 'high',
    year: 2001,
    yearSource: 'manual',
    yearConfidence: 'high',
  }, {
    id: 'autre-id', title: 'Autre titre', artist: 'Autre artiste', year: 1999, genre: 'Rock',
  });
  assert.strictEqual(manual.title, undefined);
  assert.strictEqual(manual.artist, undefined);
  assert.strictEqual(manual.year, undefined);
  assert.strictEqual(manual.genre, undefined);

  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'), 'utf8'
  );
  assert.match(serverSource, /artistSource = patch\.artist \? 'manual' : 'unknown'/);
  assert.match(serverSource, /artistConfidence = patch\.artist \? 'high' : 'unknown'/);

  assert.doesNotMatch(
    metadataAutoSource,
    /enregistrement\(titreRecherche,\s*['"]['"]/,
    'un artiste renseigné ne doit jamais être ignoré pour accepter un homonyme'
  );

  assert.strictEqual(automatic.estVersionNonOfficielle({
    title: 'Morceau connu (Nightcore)',
  }), true);
  assert.strictEqual(automatic.estVersionNonOfficielle({
    title: 'Morceau connu (Parodie)',
  }), true);
  assert.strictEqual(automatic.estVersionNonOfficielle({
    title: 'Morceau connu (Bootleg Mashup)',
  }), true);
  assert.strictEqual(automatic.estVersionNonOfficielle({
    title: 'Morceau connu (Cover)',
  }), true);
  assert.strictEqual(automatic.estVersionNonOfficielle({
    title: 'Morceau connu (Remastered)',
  }), false);
  const unofficial = automatic.proposition({
    title: 'Morceau connu (Sped Up)', genre: 'Autre', genreSource: 'unknown',
  }, {
    source: 'youtube-unofficial', videoId: 'video-variant', genre: 'Électro / EDM',
    genreSource: 'youtube', genreConfidence: 'medium', artist: 'À ignorer', year: 2024,
  });
  assert.strictEqual(unofficial.unofficialVariant, true);
  assert.strictEqual(unofficial.genre, 'Électro / EDM');
  assert.strictEqual(unofficial.artist, undefined);
  assert.strictEqual(unofficial.year, undefined);
  const youtubeNoMatch = automatic.proposition({ title: 'Version inconnue' }, {
    source: 'youtube-unofficial', noMatch: true,
  });
  assert.strictEqual(youtubeNoMatch.unofficialVariant, true);
  assert.strictEqual(youtubeNoMatch.metadataMatch, 'none');

  assert.strictEqual(await musicbrainz.enregistrement('l', ''), null);
  assert.strictEqual(musicbrainz.enregistrementDansCache('l', ''), true);

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      recordings: [{
        id: 'recording-test',
        score: 100,
        title: 'Titre réseau unique',
        'first-release-date': '1987-03-02',
        'artist-credit': [
          { name: 'Artiste réseau', joinphrase: ' feat. ' },
          { name: 'Invité' },
        ],
        tags: [{ name: 'rock', count: 4 }],
        releases: [{ date: '1990-01-01' }],
      }],
    }),
  });
  try {
    const found = await musicbrainz.enregistrement(
      'Titre réseau unique', 'Artiste réseau feat. Invité'
    );
    assert.strictEqual(found.artist, 'Artiste réseau feat. Invité');
    assert.strictEqual(found.year, 1987);
    assert.strictEqual(found.genre, 'Rock');
    assert.strictEqual(found.confidence, 'medium');
    assert.strictEqual(await musicbrainz.enregistrement('ラグドウズ', ''), null);
    assert.strictEqual(musicbrainz.enregistrementDansCache('ラグドウズ', ''), true);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  const applyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-mb-apply-'));
  const musicDir = path.join(applyRoot, 'musiques');
  const metadataFile = path.join(applyRoot, 'metadata.json');
  const planFile = path.join(applyRoot, 'preview.json');
  fs.mkdirSync(musicDir);
  fs.writeFileSync(path.join(musicDir, 'test.mp3'), 'audio-factice');
  fs.writeFileSync(metadataFile, JSON.stringify({
    version: 1,
    tracks: {
      'test.mp3': {
        title: 'Titre test', artist: 'Artiste test', genre: 'Autre',
        genreSource: 'unknown', genreConfidence: 'unknown',
        yearSource: 'unknown', yearConfidence: 'unknown',
      },
    },
  }));
  fs.writeFileSync(planFile, JSON.stringify({
    version: 2,
    source: 'musicbrainz',
    total: 1,
    inspected: 1,
    pending: 0,
    complete: true,
    changes: {
      'test.mp3': {
        expected: {
          title: 'Titre test', artist: 'Artiste test',
          artistSource: '', artistConfidence: '', genre: 'Autre',
          genreSource: 'unknown', genreConfidence: 'unknown', year: '',
          yearSource: 'unknown', yearConfidence: 'unknown', album: '',
          albumSource: '', unofficialVariant: 'false',
        },
        patch: {
          musicbrainzRecordingId: 'mbid-apply',
          metadataCheckedAt: '2026-09-04T00:00:00.000Z',
          metadataMatch: 'musicbrainz',
          year: 2002,
          genre: 'Rock',
        },
      },
    },
  }));
  const applied = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'tools', 'metadata-auto.js'), '--apply', planFile,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SONGLESS_MUSIC_DIR: musicDir,
      SONGLESS_METADATA_FILE: metadataFile,
      SONGLESS_METADATA_BACKUP_DIR: path.join(applyRoot, 'backups'),
      SONGLESS_CACHE_DIR: path.join(applyRoot, 'cache'),
    },
    windowsHide: true,
  });
  assert.strictEqual(applied.status, 0, applied.stderr);
  const saved = JSON.parse(fs.readFileSync(metadataFile, 'utf8')).tracks['test.mp3'];
  assert.strictEqual(saved.year, 2002);
  assert.strictEqual(saved.yearSource, 'musicbrainz');
  assert.strictEqual(saved.genre, 'Rock');
  assert.strictEqual(saved.genreSource, 'musicbrainz');

  fs.writeFileSync(path.join(musicDir, 'youtube.mp3'), 'audio-factice');
  const storeAfterMusicBrainz = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  storeAfterMusicBrainz.tracks['youtube.mp3'] = {
    title: 'Version accélérée', artist: '', genre: 'Autre',
    genreSource: 'unknown', genreConfidence: 'unknown',
    yearSource: 'unknown', yearConfidence: 'unknown',
  };
  fs.writeFileSync(metadataFile, JSON.stringify(storeAfterMusicBrainz));

  const youtubePlanFile = path.join(applyRoot, 'preview-youtube.json');
  fs.writeFileSync(youtubePlanFile, JSON.stringify({
    version: 2,
    source: 'internet',
    total: 1,
    inspected: 1,
    pending: 0,
    complete: true,
    changes: {
      'youtube.mp3': {
        expected: {
          title: 'Version accélérée', artist: '', artistSource: '',
          artistConfidence: '', genre: 'Autre', genreSource: 'unknown',
          genreConfidence: 'unknown', year: '', yearSource: 'unknown',
          yearConfidence: 'unknown', album: '', albumSource: '',
          unofficialVariant: 'false',
        },
        patch: {
          unofficialVariant: true,
          metadataCheckedAt: '2026-09-04T00:00:01.000Z',
          metadataMatch: 'youtube', videoId: 'video-youtube',
          genre: 'Pop', genreSource: 'youtube', genreConfidence: 'medium',
        },
      },
    },
  }));
  const youtubeApplied = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'tools', 'metadata-auto.js'), '--apply', youtubePlanFile,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SONGLESS_MUSIC_DIR: musicDir,
      SONGLESS_METADATA_FILE: metadataFile,
      SONGLESS_METADATA_BACKUP_DIR: path.join(applyRoot, 'backups'),
      SONGLESS_CACHE_DIR: path.join(applyRoot, 'cache'),
    },
    windowsHide: true,
  });
  assert.strictEqual(youtubeApplied.status, 0, youtubeApplied.stderr);
  const youtubeSaved = JSON.parse(fs.readFileSync(metadataFile, 'utf8')).tracks['youtube.mp3'];
  assert.strictEqual(youtubeSaved.genre, 'Pop');
  assert.strictEqual(youtubeSaved.genreSource, 'youtube');
  assert.strictEqual(youtubeSaved.genreConfidence, 'medium');

  const pendingPlanFile = path.join(applyRoot, 'preview-incomplet.json');
  const pendingPlan = JSON.parse(fs.readFileSync(youtubePlanFile, 'utf8'));
  pendingPlan.pending = 1;
  fs.writeFileSync(pendingPlanFile, JSON.stringify(pendingPlan));
  const pendingApplied = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'tools', 'metadata-auto.js'), '--apply', pendingPlanFile,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SONGLESS_MUSIC_DIR: musicDir,
      SONGLESS_METADATA_FILE: metadataFile,
      SONGLESS_METADATA_BACKUP_DIR: path.join(applyRoot, 'backups'),
      SONGLESS_CACHE_DIR: path.join(applyRoot, 'cache'),
    },
    windowsHide: true,
  });
  assert.notStrictEqual(pendingApplied.status, 0);
  assert.match(pendingApplied.stderr, /doivent encore être retentées/);
  fs.rmSync(applyRoot, { recursive: true, force: true });

  console.log('OK  métadonnées Internet sûres et téléchargements futurs contrôlés');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
