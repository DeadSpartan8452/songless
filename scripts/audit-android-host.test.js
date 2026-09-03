'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const builder = require('./build-android-payload');
const alignmentAudit = require('./audit-android-native-alignment');
const nodeMobile16K = require('./patch-node-mobile-16k');

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
const bootReceiver = fs.readFileSync(path.join(host, 'android', 'app', 'src', 'main', 'java', 'com', 'fr.songless.host', 'SonglessBootReceiver.kt'), 'utf8');
const metadataAdapter = fs.readFileSync(path.join(root, 'lib', 'music-metadata.js'), 'utf8');
const answers = fs.readFileSync(path.join(root, 'lib', 'party-answers.js'), 'utf8');
const titles = fs.readFileSync(path.join(root, 'lib', 'titles.js'), 'utf8');
const releaseBuilder = fs.readFileSync(
  path.join(root, 'packaging', 'android', 'Construire-APK-Songless.ps1'),
  'utf8'
);
const releaseLauncher = fs.readFileSync(
  path.join(root, 'packaging', 'android', 'Construire APK Songless.bat'),
  'utf8'
);
const signingBackup = fs.readFileSync(
  path.join(root, 'packaging', 'android', 'Sauvegarder-Signature-Android.ps1'),
  'utf8'
);
const signingRestore = fs.readFileSync(
  path.join(root, 'packaging', 'android', 'Restaurer-Signature-Android.ps1'),
  'utf8'
);
const signingBackupLauncher = fs.readFileSync(
  path.join(root, 'packaging', 'android', 'Sauvegarder signature Android.bat'),
  'utf8'
);
const signingRestoreLauncher = fs.readFileSync(
  path.join(root, 'packaging', 'android', 'Restaurer signature Android.bat'),
  'utf8'
);

function makeElf64(alignment) {
  const elf = Buffer.alloc(64 + 56);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf, 0);
  elf[4] = 2;
  elf[5] = 1;
  elf.writeBigUInt64LE(64n, 32);
  elf.writeUInt16LE(64, 52);
  elf.writeUInt16LE(56, 54);
  elf.writeUInt16LE(1, 56);
  elf.writeUInt32LE(1, 64);
  elf.writeBigUInt64LE(BigInt(alignment), 64 + 48);
  return elf;
}

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
assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED/);
assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_SPECIAL_USE/);
assert.match(manifest, /android:foregroundServiceType="specialUse"/);
assert.match(manifest, /android:name="\.SonglessHostService"/);
assert.match(manifest, /android:name="\.SonglessBootReceiver"/);
assert.match(activity, /startForegroundService/);
assert.match(foregroundService, /START_STICKY/);
assert.match(foregroundService, /setOngoing\(true\)/);
assert.match(foregroundService, /startNodeProject\("main\.js"/);
assert.match(application, /createReactContextInBackground/);
assert.match(bootReceiver, /ACTION_BOOT_COMPLETED/);
assert.match(bootReceiver, /startForegroundService/);
assert.match(main, /request-ready/);
assert.match(app, /request-ready/);
assert.match(properties, /newArchEnabled=false/);
assert.match(properties, /reactNativeArchitectures=arm64-v8a,x86_64/);
assert.match(buildGradle, /abiFilters "arm64-v8a", "x86_64"/);
assert.match(buildGradle, /SONGLESS_ANDROID_KEYSTORE/);
assert.match(buildGradle, /signingConfig signingConfigs\.release/);
assert.doesNotMatch(
  buildGradle,
  /release\s*\{\s*signingConfig signingConfigs\.debug/
);
assert.match(releaseBuilder, /ConvertFrom-SecureString/);
assert.match(releaseBuilder, /apksigner\.bat/);
assert.match(releaseBuilder, /assembleRelease --no-daemon/);
assert.match(releaseBuilder, /build-android-payload\.js/);
assert.match(releaseBuilder, /audit-android-native-alignment\.js/);
assert.match(releaseBuilder, /patch-node-mobile-16k\.js/);
assert.match(releaseBuilder, /dist\\node-mobile-16k/);
assert.match(releaseBuilder, /build\\nodejs-assets/);
assert.match(releaseBuilder, /app\\build/);
assert.match(releaseBuilder, /nodejs-mobile-react-native\\android/);
assert.match(releaseBuilder, /StringComparison]::OrdinalIgnoreCase/);
assert.match(
  releaseBuilder,
  /Remove-Item -LiteralPath \$generatedPath -Recurse -Force/
);
assert.match(releaseLauncher, /ExecutionPolicy Bypass/);
assert.match(signingBackup, /-deststoretype', 'PKCS12'/);
assert.match(signingBackup, /SONGLESS_BACKUP_PASSWORD/);
assert.doesNotMatch(signingBackup, /Write-Host.*backupPassword/i);
assert.match(signingBackup, /sauvegarde portable existe deja/);
assert.match(signingRestore, /ConvertFrom-SecureString/);
assert.match(signingRestore, /Elle ne sera jamais ecrasee/);
assert.match(signingRestore, /Remove-Item -LiteralPath \$keystore/);
assert.match(signingBackupLauncher, /ExecutionPolicy Bypass/);
assert.match(signingRestoreLauncher, /ExecutionPolicy Bypass/);
assert.match(metadataAdapter, /import\('music-metadata'\)/);
assert.doesNotMatch(answers, /\\p\{/);
assert.doesNotMatch(titles, /\\p\{/);
assert.strictEqual(path.basename(builder.safePayload()), 'nodejs-project');
assert.strictEqual(alignmentAudit.inspectElf(makeElf64(0x4000)).compatible16K, true);
assert.strictEqual(alignmentAudit.inspectElf(makeElf64(0x1000)).compatible16K, false);

const nodeMobileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-node-mobile-'));
fs.mkdirSync(path.join(nodeMobileRoot, 'android'));
fs.writeFileSync(path.join(nodeMobileRoot, 'package.json'), JSON.stringify({
  name: 'nodejs-mobile-react-native', version: nodeMobile16K.SUPPORTED_VERSION,
}));
fs.writeFileSync(path.join(nodeMobileRoot, 'android', 'CMakeLists.txt'), [
  'add_library(nodejs-mobile-react-native-native-lib SHARED native-lib.cpp)',
  'target_link_libraries(nodejs-mobile-react-native-native-lib libnode)',
].join('\n'));
for (const abi of ['arm64-v8a', 'x86_64']) {
  fs.mkdirSync(path.join(nodeMobileRoot, 'android', 'libnode', 'bin', abi), {
    recursive: true,
  });
}
const customNodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-libnode-16k-'));
for (const abi of ['arm64-v8a', 'x86_64']) {
  fs.mkdirSync(path.join(customNodeRoot, abi), {recursive: true});
  fs.writeFileSync(path.join(customNodeRoot, abi, 'libnode.so'), makeElf64(0x4000));
}
try {
  assert.strictEqual(nodeMobile16K.patchNodeMobile(nodeMobileRoot), true);
  assert.strictEqual(nodeMobile16K.patchNodeMobile(nodeMobileRoot), false);
  const patchedNodeMobile = fs.readFileSync(
    path.join(nodeMobileRoot, 'android', 'CMakeLists.txt'), 'utf8'
  );
  assert.match(patchedNodeMobile, /max-page-size=16384/);
  assert.strictEqual((patchedNodeMobile.match(/SONGLESS_16K_LINK_FLAGS/g) || []).length, 1);
  assert.strictEqual(
    nodeMobile16K.installCustomLibnode(nodeMobileRoot, customNodeRoot),
    2
  );
  for (const abi of ['arm64-v8a', 'x86_64']) {
    const installed = fs.readFileSync(path.join(
      nodeMobileRoot, 'android', 'libnode', 'bin', abi, 'libnode.so'
    ));
    assert.strictEqual(alignmentAudit.inspectElf(installed).compatible16K, true);
  }
} finally {
  fs.rmSync(nodeMobileRoot, {recursive: true, force: true});
  fs.rmSync(customNodeRoot, {recursive: true, force: true});
}

const patchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-path-to-regexp-'));
const patchTarget = path.join(
  patchRoot,
  'node_modules',
  'path-to-regexp',
  'dist',
  'index.js'
);
fs.mkdirSync(path.dirname(patchTarget), {recursive: true});
fs.writeFileSync(patchTarget, [
  'const ID_START = /^[$_\\p{ID_Start}]$/u;',
  'const ID_CONTINUE = /^[$\\u200c\\u200d\\p{ID_Continue}]$/u;',
  'const ID = /^[$_\\p{ID_Start}][$\\u200c\\u200d\\p{ID_Continue}]*$/u;',
].join('\n'));
try {
  builder.patchPathToRegexpForNodeMobile(patchRoot);
  const patchedPathToRegexp = fs.readFileSync(patchTarget, 'utf8');
  assert.doesNotMatch(patchedPathToRegexp, /\\p\{/);
  assert.match(patchedPathToRegexp, /A-Za-z0-9/);
} finally {
  fs.rmSync(patchRoot, {recursive: true, force: true});
}

for (const forbidden of ['musiques', 'metadata.json', 'songless-data.json', '.songless-instance-key']) {
  assert.strictEqual(builder.APP_FILES.includes(forbidden), false);
  assert.strictEqual(builder.APP_DIRECTORIES.includes(forbidden), false);
}

console.log('OK  hôte Android, secret éphémère et payload privé contrôlés');
