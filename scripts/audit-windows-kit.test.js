'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const kit = require('./build-windows-kit');

for (const name of ['musiques', 'metadata.json', 'songless-data.json',
  '.songless-instance-key', '.songless-tailscale-account']) {
  assert.strictEqual(kit.allowed(name), false, `${name} ne doit jamais entrer dans le kit`);
}
assert.strictEqual(kit.allowed('public/app.js'), true);
assert.strictEqual(
  kit.allowed('node_modules/content-type/dist/index.js'),
  true,
  'les dossiers dist internes aux dépendances doivent rester dans le kit',
);
assert.ok(kit.APP_DIRECTORIES.includes('node_modules'));

const installer = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'windows', 'Installer-Songless.ps1'), 'utf8');
assert.match(installer, /Get-FileHash -Algorithm SHA256/);
assert.match(installer, /Les musiques et profils seront conservés/);
assert.match(installer, /Supprimer aussi toutes les musiques/);
assert.match(installer, /Songless-IsRunning/);
assert.match(installer, /LegacyKey = Join-Path \$InstallRoot/);
assert.match(installer, /instance-key\.dpapi/);
assert.match(installer, /LegacyAccount = Join-Path \$InstallRoot/);
assert.match(installer, /tailscale-account\.txt/);

const launcher = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'windows', 'Lancer-Songless.ps1'), 'utf8');
assert.match(launcher, /SONGLESS_MUSIC_DIR/);
assert.match(launcher, /SONGLESS_INSTANCE_KEY_FILE/);
assert.match(launcher, /SONGLESS_TAILSCALE_ACCOUNT_FILE/);
assert.match(launcher, /runtime/);

const appLauncher = fs.readFileSync(path.join(__dirname, '..', 'Songless.ps1'), 'utf8');
assert.match(appLauncher, /Add-Type -AssemblyName System\.Security/);
assert.match(appLauncher, /Security\.Cryptography\.ProtectedData/);
assert.match(appLauncher, /SONGLESS_INSTANCE_KEY_FILE/);

const internetLauncher = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'start-internet.ps1'),
  'utf8'
);
assert.match(internetLauncher, /SONGLESS_TAILSCALE_ACCOUNT_FILE/);
assert.match(internetLauncher, /Retape exactement ce compte/);
assert.match(internetLauncher, /Compte non confirme/);

const menuLauncher = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'windows', 'Songless.bat'), 'utf8');
assert.doesNotMatch(menuLauncher, /WindowStyle Hidden/i);
assert.match(menuLauncher, /-Mode menu/i);

console.log('OK  contenu privé exclu, runtime prévu et désinstallation prudente');
