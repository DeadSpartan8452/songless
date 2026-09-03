'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const builder = require('./build-android-payload');

const root = path.join(__dirname, '..');
const host = path.join(root, 'mobile', 'android-host');
const main = fs.readFileSync(path.join(host, 'node-main.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const antivirusBuilder = fs.readFileSync(path.join(root, 'scripts', 'build-android-antivirus.js'), 'utf8');
const app = fs.readFileSync(path.join(host, 'App.tsx'), 'utf8');
const application = fs.readFileSync(path.join(host, 'android', 'app', 'src', 'main', 'java', 'com', 'fr.songless.host', 'MainApplication.kt'), 'utf8');
const folderModule = fs.readFileSync(path.join(host, 'android', 'app', 'src', 'main', 'java', 'com', 'fr.songless.host', 'SonglessFolderModule.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(host, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const properties = fs.readFileSync(path.join(host, 'android', 'gradle.properties'), 'utf8');
const buildGradle = fs.readFileSync(path.join(host, 'android', 'app', 'build.gradle'), 'utf8');
const activity = fs.readFileSync(path.join(host, 'android', 'app', 'src', 'main', 'java', 'com', 'fr.songless.host', 'MainActivity.kt'), 'utf8');
const foregroundService = fs.readFileSync(path.join(host, 'android', 'app', 'src', 'main', 'java', 'com', 'fr.songless.host', 'SonglessHostService.kt'), 'utf8');
const metadataAdapter = fs.readFileSync(path.join(root, 'lib', 'music-metadata.js'), 'utf8');
const answers = fs.readFileSync(path.join(root, 'lib', 'party-answers.js'), 'utf8');
const titles = fs.readFileSync(path.join(root, 'lib', 'titles.js'), 'utf8');

assert.match(main, /crypto\.randomBytes\(32\)/);
assert.match(main, /SONGLESS_INSTANCE_SECRET/);
assert.match(main, /SONGLESS_MOBILE_HOST/);
assert.match(main, /SONGLESS_ANDROID_INBOX/);
assert.match(server, /mobileHost: MOBILE_HOST/);
assert.match(server, /estMachineLocale\(req\) && \(MOBILE_HOST \|\| instanceAuth\.isAuthorized\(req\)\)/);
assert.match(server, /\/api\/antivirus\/update/);
assert.match(application, /SONGLESS_CLAMSCAN/);
assert.match(application, /SONGLESS_NATIVE_LIB_DIR/);
assert.match(application, /clamav\/certs\/clamav\.crt/);
assert.match(application, /SonglessFolderPackage/);
assert.match(folderModule, /ACTION_OPEN_DOCUMENT_TREE/);
assert.match(folderModule, /takePersistableUriPermission/);
assert.match(folderModule, /MAX_FILES = 5000/);
assert.match(folderModule, /Songless-Data\/inbox/);
assert.match(app, /choose-music-folder/);
assert.match(app, /songless-folder-result/);
assert.match(server, /\/api\/android\/import-folder/);
assert.match(server, /antivirus\.scan\(batch/);
assert.match(antivirusBuilder, /ClamAV 1\.5\.4|clamav: '1\.5\.4'/);
assert.match(antivirusBuilder, /SHA-256 invalide/);
assert.match(antivirusBuilder, /arm64-v8a/);
assert.match(antivirusBuilder, /x86_64/);
assert.match(main, /admin-bootstrap\?token=/);
assert.match(app, /nodejs\.start\('main\.js'/);
assert.match(app, /onShouldStartLoadWithRequest/);
assert.match(app, /127\\\.0\\\.0\\\.1/);
assert.match(manifest, /android\.permission\.INTERNET/);
assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE/);
assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
assert.match(manifest, /android:name="\.SonglessHostService"/);
assert.match(activity, /startForegroundService/);
assert.match(foregroundService, /START_STICKY/);
assert.match(foregroundService, /setOngoing\(true\)/);
assert.match(properties, /newArchEnabled=false/);
assert.match(properties, /reactNativeArchitectures=arm64-v8a,x86_64/);
assert.match(buildGradle, /abiFilters "arm64-v8a", "x86_64"/);
assert.match(metadataAdapter, /import\('music-metadata'\)/);
assert.doesNotMatch(answers, /\\p\{/);
assert.doesNotMatch(titles, /\\p\{/);
assert.strictEqual(path.basename(builder.safePayload()), 'nodejs-project');

for (const forbidden of ['musiques', 'metadata.json', 'songless-data.json', '.songless-instance-key']) {
  assert.strictEqual(builder.APP_FILES.includes(forbidden), false);
  assert.strictEqual(builder.APP_DIRECTORIES.includes(forbidden), false);
}

console.log('OK  hôte Android, secret éphémère et payload privé contrôlés');
