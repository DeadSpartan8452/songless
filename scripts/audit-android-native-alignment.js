'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const PT_LOAD = 1;
const REQUIRED_ALIGNMENT = 0x4000;

function readUInt64(buffer, offset, littleEndian) {
  const value = littleEndian
    ? buffer.readBigUInt64LE(offset)
    : buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Valeur ELF trop grande');
  }
  return Number(value);
}

function inspectElf(buffer, label = 'bibliotheque ELF') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 ||
      !buffer.subarray(0, 4).equals(ELF_MAGIC)) {
    throw new Error(label + ' : en-tete ELF invalide');
  }

  const elfClass = buffer[4];
  const encoding = buffer[5];
  if (elfClass !== 1 && elfClass !== 2) {
    throw new Error(label + ' : classe ELF inconnue');
  }
  if (encoding !== 1 && encoding !== 2) {
    throw new Error(label + ' : encodage ELF inconnu');
  }

  const littleEndian = encoding === 1;
  const read16 = (offset) => littleEndian
    ? buffer.readUInt16LE(offset)
    : buffer.readUInt16BE(offset);
  const read32 = (offset) => littleEndian
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset);
  const headerSize = elfClass === 1 ? 52 : 64;
  if (buffer.length < headerSize) {
    throw new Error(label + ' : en-tete ELF tronque');
  }

  const programOffset = elfClass === 1
    ? read32(28)
    : readUInt64(buffer, 32, littleEndian);
  const entrySize = read16(elfClass === 1 ? 42 : 54);
  const entryCount = read16(elfClass === 1 ? 44 : 56);
  const minimumEntrySize = elfClass === 1 ? 32 : 56;

  if (entryCount > 0 && entrySize < minimumEntrySize) {
    throw new Error(label + ' : table des segments ELF invalide');
  }
  if (programOffset + entrySize * entryCount > buffer.length) {
    throw new Error(label + ' : table des segments ELF tronquee');
  }

  const alignments = [];
  for (let index = 0; index < entryCount; index += 1) {
    const offset = programOffset + index * entrySize;
    if (read32(offset) !== PT_LOAD) continue;
    alignments.push(elfClass === 1
      ? read32(offset + 28)
      : readUInt64(buffer, offset + 48, littleEndian));
  }

  if (alignments.length === 0) {
    throw new Error(label + ' : aucun segment PT_LOAD');
  }

  const minimumAlignment = Math.min(...alignments);
  return {
    elfClass: elfClass === 1 ? 32 : 64,
    alignments,
    minimumAlignment,
    compatible16K: minimumAlignment >= REQUIRED_ALIGNMENT
  };
}

function auditApk(apkPath) {
  const zip = new AdmZip(apkPath);
  const libraries = [];
  const errors = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !/^lib\/.+\.so$/i.test(entry.entryName)) continue;
    try {
      libraries.push({
        name: entry.entryName,
        ...inspectElf(entry.getData(), entry.entryName)
      });
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (libraries.length === 0 && errors.length === 0) {
    errors.push('Aucune bibliotheque native trouvee dans l APK.');
  }

  return {
    apkPath,
    libraries,
    errors,
    compatible16K: errors.length === 0 &&
      libraries.every((library) => library.compatible16K)
  };
}

function formatAlignment(value) {
  return '0x' + value.toString(16).toUpperCase();
}

function makeReport(result) {
  const incompatible = result.libraries.filter((library) => !library.compatible16K);
  const lines = [
    'Songless - audit de compatibilite native Android 16 Kio',
    'APK : ' + path.basename(result.apkPath),
    'Bibliotheques controlees : ' + result.libraries.length,
    'Resultat : ' + (result.compatible16K ? 'COMPATIBLE' : 'NON COMPATIBLE'),
    ''
  ];

  if (incompatible.length > 0) {
    lines.push('Bibliotheques dont un segment PT_LOAD reste sous 0x4000 :');
    for (const library of incompatible) {
      lines.push('- ' + library.name + ' (minimum ' +
        formatAlignment(library.minimumAlignment) + ')');
    }
    lines.push('');
  }
  if (result.errors.length > 0) {
    lines.push('Erreurs :');
    for (const error of result.errors) lines.push('- ' + error);
    lines.push('');
  }
  lines.push('Ce controle lit p_align dans chaque segment ELF PT_LOAD.');
  lines.push('L alignement ZIP seul ne prouve pas la compatibilite native 16 Kio.');
  return lines.join('\r\n') + '\r\n';
}

function main(argv = process.argv.slice(2)) {
  const root = path.join(__dirname, '..');
  const apkPath = path.resolve(argv[0] || path.join(
    root, 'dist', 'Songless-Android', 'Songless-Android.apk'
  ));
  const reportPath = path.resolve(argv[1] || path.join(
    path.dirname(apkPath), 'Songless-Android-compatibilite-16K.txt'
  ));

  if (!fs.existsSync(apkPath)) {
    console.error('APK introuvable : ' + apkPath);
    return 1;
  }

  try {
    const result = auditApk(apkPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, makeReport(result), 'utf8');
    console.log('Rapport 16 Kio : ' + reportPath);
    if (result.errors.length > 0) return 1;
    if (!result.compatible16K) {
      const count = result.libraries.filter(
        (library) => !library.compatible16K
      ).length;
      console.warn(count + ' bibliotheque(s) native(s) non compatible(s).');
      return 2;
    }
    console.log('Toutes les bibliotheques natives sont compatibles 16 Kio.');
    return 0;
  } catch (error) {
    console.error('Audit 16 Kio impossible : ' + error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  REQUIRED_ALIGNMENT,
  auditApk,
  inspectElf,
  makeReport,
  main
};
