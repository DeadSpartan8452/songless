'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { once } = require('events');

function octal(value, width) {
  const text = Math.max(0, Number(value)).toString(8).padStart(width - 1, '0');
  if (text.length >= width) throw new Error('Valeur TAR trop grande.');
  return `${text}\0`;
}

function putString(header, text, offset, width) {
  const bytes = Buffer.from(String(text), 'utf8');
  if (bytes.length > width) throw new Error('Champ TAR trop long.');
  bytes.copy(header, offset);
}

function headerFor(name, {size = 0, mode = 0o644, type = '0'} = {}) {
  const header = Buffer.alloc(512, 0);
  let archiveName = name;
  let prefix = '';

  if (Buffer.byteLength(archiveName) > 100) {
    const positions = [...archiveName.matchAll(/\//g)].map(match => match.index);
    const split = positions.reverse().find(index =>
      Buffer.byteLength(archiveName.slice(0, index)) <= 155
      && Buffer.byteLength(archiveName.slice(index + 1)) <= 100
    );
    if (split !== undefined) {
      prefix = archiveName.slice(0, split);
      archiveName = archiveName.slice(split + 1);
    } else {
      archiveName = path.posix.basename(archiveName).slice(0, 100);
    }
  }

  putString(header, archiveName, 0, 100);
  putString(header, octal(mode, 8), 100, 8);
  putString(header, octal(0, 8), 108, 8);
  putString(header, octal(0, 8), 116, 8);
  putString(header, octal(size, 12), 124, 12);
  putString(header, octal(0, 12), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  putString(header, 'ustar\0', 257, 6);
  putString(header, '00', 263, 2);
  putString(header, 'root', 265, 32);
  putString(header, 'root', 297, 32);
  putString(header, prefix, 345, 155);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  putString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return header;
}

function padding(size) {
  const remainder = size % 512;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - remainder);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function writeLongName(stream, name) {
  const body = Buffer.from(`${name}\0`, 'utf8');
  await writeChunk(stream, headerFor('././@LongLink', {
    size: body.length,
    mode: 0o644,
    type: 'L',
  }));
  await writeChunk(stream, body);
  await writeChunk(stream, padding(body.length));
}

function listEntries(root) {
  const entries = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    const names = fs.readdirSync(absolute).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const childRelative = relative ? path.join(relative, name) : name;
      const childAbsolute = path.join(root, childRelative);
      const stat = fs.lstatSync(childAbsolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`Lien symbolique inattendu : ${childRelative}`);
      }
      if (stat.isDirectory()) {
        entries.push({relative: childRelative, absolute: childAbsolute, dir: true});
        visit(childRelative);
      } else if (stat.isFile()) {
        entries.push({relative: childRelative, absolute: childAbsolute, dir: false});
      } else {
        throw new Error(`Type de fichier non pris en charge : ${childRelative}`);
      }
    }
  }
  visit('');
  return entries;
}

function validatePackage(entries) {
  const forbidden = new Set([
    '.git', 'musiques', 'metadata.json', 'songless-data.json',
    '.songless-instance-key', '.songless-tailscale-account',
  ]);
  for (const entry of entries) {
    const relative = entry.relative.replace(/\\/g, '/');
    const pieces = relative.split('/');
    if (pieces.some(piece => forbidden.has(piece))) {
      throw new Error(`Donnée locale refusée dans le paquet : ${relative}`);
    }
    if (/\.(exe|dll|bat|ps1)$/i.test(relative)) {
      throw new Error(`Fichier Windows refusé dans le paquet Linux : ${relative}`);
    }
  }
  if (!entries.some(entry =>
    entry.relative.replace(/\\/g, '/') === 'runtime/node' && !entry.dir
  )) {
    throw new Error('Runtime Linux absent du paquet.');
  }
  if (!entries.some(entry => entry.relative === 'Songless' && !entry.dir)) {
    throw new Error('Lanceur Linux absent du paquet.');
  }
}

async function packageLinuxTar(stage, output) {
  const root = path.resolve(stage);
  const destination = path.resolve(output);
  if (path.basename(root) !== 'Songless-Linux-x64') {
    throw new Error('Dossier de préparation Linux inattendu.');
  }
  if (path.basename(destination) !== 'Songless-Linux-x64.tar.gz'
      || path.dirname(destination) !== path.dirname(root).replace(/[\\/]\.build$/, '')) {
    throw new Error('Destination TAR Linux inattendue.');
  }

  const entries = listEntries(root);
  validatePackage(entries);

  const temporary = `${destination}.tmp`;
  const outputStream = fs.createWriteStream(temporary, {flags: 'w'});
  const gzip = zlib.createGzip({level: 6});
  gzip.pipe(outputStream);
  const outputDone = once(outputStream, 'close');
  let fileCount = 0;
  let byteCount = 0;

  try {
    const allEntries = [
      {relative: '', absolute: root, dir: true},
      ...entries,
    ];
    for (const entry of allEntries) {
      const name = `Songless-Linux-x64${entry.relative
        ? `/${entry.relative.split(path.sep).join('/')}` : ''}${entry.dir ? '/' : ''}`;
      const size = entry.dir ? 0 : fs.statSync(entry.absolute).size;
      const relative = entry.relative.replace(/\\/g, '/');
      const mode = relative === 'runtime/node' || relative === 'Songless'
        ? 0o755 : entry.dir ? 0o755 : 0o644;

      if (Buffer.byteLength(name) > 100
          && !name.split('/').some((_, index, parts) => {
            if (index === 0) return false;
            const prefix = parts.slice(0, index).join('/');
            const base = parts.slice(index).join('/');
            return Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100;
          })) {
        await writeLongName(gzip, name);
      }

      await writeChunk(gzip, headerFor(name, {
        size,
        mode,
        type: entry.dir ? '5' : '0',
      }));

      if (!entry.dir) {
        const input = fs.createReadStream(entry.absolute);
        for await (const chunk of input) await writeChunk(gzip, chunk);
        await writeChunk(gzip, padding(size));
        fileCount++;
        byteCount += size;
      }
    }
    await writeChunk(gzip, Buffer.alloc(1024));
    gzip.end();
    await outputDone;
  } catch (error) {
    gzip.destroy();
    outputStream.destroy();
    try { fs.rmSync(temporary, {force: true}); } catch (_) {}
    throw error;
  }

  if (fs.existsSync(destination)) fs.rmSync(destination, {force: true});
  fs.renameSync(temporary, destination);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
  return {
    archive: destination,
    files: fileCount,
    uncompressedBytes: byteCount,
    sha256: hash.digest('hex').toUpperCase(),
  };
}

if (require.main === module) {
  packageLinuxTar(process.argv[2], process.argv[3])
    .then(result => {
      console.log(`Paquet Linux : ${result.archive}`);
      console.log(`${result.files} fichiers ; ${result.uncompressedBytes} octets`);
      console.log(`SHA-256 : ${result.sha256}`);
    })
    .catch(error => {
      console.error(`Échec du paquet Linux : ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {headerFor, packageLinuxTar, validatePackage};
