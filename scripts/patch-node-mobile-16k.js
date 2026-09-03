'use strict';

const fs = require('fs');
const path = require('path');
const alignmentAudit = require('./audit-android-native-alignment');

const SUPPORTED_VERSION = '18.20.4';
const MARKER = 'SONGLESS_16K_LINK_FLAGS';
const LINK_FLAGS = '-Wl,-z,max-page-size=16384';

function patchNodeMobile(moduleRoot) {
  const root = path.resolve(moduleRoot);
  const packageFile = path.join(root, 'package.json');
  const cmakeFile = path.join(root, 'android', 'CMakeLists.txt');
  if (!fs.existsSync(packageFile) || !fs.existsSync(cmakeFile)) {
    throw new Error('Module nodejs-mobile-react-native incomplet.');
  }

  const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (manifest.name !== 'nodejs-mobile-react-native' ||
      manifest.version !== SUPPORTED_VERSION) {
    throw new Error(
      `Version Node Mobile non contrôlée : ${manifest.version || 'inconnue'}.`
    );
  }

  const source = fs.readFileSync(cmakeFile, 'utf8');
  if (source.includes(MARKER)) return false;
  if (!source.includes('nodejs-mobile-react-native-native-lib')) {
    throw new Error('Cible native Node Mobile introuvable.');
  }

  const patch = [
    '',
    `# ${MARKER}`,
    'set_property(TARGET nodejs-mobile-react-native-native-lib',
    `  APPEND_STRING PROPERTY LINK_FLAGS " ${LINK_FLAGS}")`,
    '',
  ].join('\n');
  fs.writeFileSync(cmakeFile, source.trimEnd() + patch, 'utf8');
  return true;
}

function installCustomLibnode(moduleRoot, customRoot) {
  if (!customRoot) return 0;
  const sourceRoot = path.resolve(customRoot);
  if (!fs.existsSync(sourceRoot)) return 0;

  const root = path.resolve(moduleRoot);
  const copies = ['arm64-v8a', 'x86_64'].map((abi) => {
    const source = path.join(sourceRoot, abi, 'libnode.so');
    const target = path.join(root, 'android', 'libnode', 'bin', abi, 'libnode.so');
    if (!fs.existsSync(source)) {
      throw new Error(`libnode.so 16 Kio absent pour ${abi}.`);
    }
    const inspection = alignmentAudit.inspectElf(fs.readFileSync(source), source);
    if (!inspection.compatible16K) {
      throw new Error(`libnode.so reste incompatible 16 Kio pour ${abi}.`);
    }
    if (!fs.existsSync(path.dirname(target))) {
      throw new Error(`Destination Node Mobile absente pour ${abi}.`);
    }
    return {source, target};
  });

  for (const copy of copies) fs.copyFileSync(copy.source, copy.target);
  return copies.length;
}

function main(argv = process.argv.slice(2)) {
  try {
    const changed = patchNodeMobile(argv[0]);
    const installed = installCustomLibnode(argv[0], argv[1]);
    console.log(changed
      ? 'Pont Node Mobile préparé pour les pages 16 Kio.'
      : 'Pont Node Mobile déjà préparé pour les pages 16 Kio.');
    console.log(installed
      ? 'Moteur libnode 16 Kio vérifié et installé pour les deux architectures.'
      : 'Moteur libnode officiel conservé : remplacement 16 Kio absent.');
    return 0;
  } catch (error) {
    console.error(`Préparation 16 Kio impossible : ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  LINK_FLAGS,
  MARKER,
  SUPPORTED_VERSION,
  installCustomLibnode,
  main,
  patchNodeMobile,
};
