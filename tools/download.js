#!/usr/bin/env node
'use strict';

/**
 * Ajout de musique à Songless en ligne de commande.
 *
 *   node tools/download.js "darude sandstorm"
 *   node tools/download.js "https://youtu.be/xxxx" --genre "Meme / Internet" --title "Polish Cow"
 *   node tools/download.js --file chansons.txt
 *   node tools/download.js --check
 *
 * Format de --file (une ligne par morceau, # pour un commentaire) :
 *   titre ou URL | genre | titre affiché
 */

const fs = require('fs');
const path = require('path');
const dl = require('../lib/downloader');
const T = require('../lib/titles');

const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function usage() {
  console.log(`
Songless — ajout de musique

  node tools/download.js "<titre ou URL>" [--genre "<genre>"] [--title "<nom affiché>"]
                         [--artist "<artiste>"] [--force]
  node tools/download.js --file <fichier.txt>
  node tools/download.js --check      vérifie yt-dlp et ffmpeg
  node tools/download.js --genres     liste les genres

Le titre affiché sert de réponse dans le jeu : mets-y le nom sous lequel le
morceau est vraiment connu (ex. « Polish Cow » plutôt que le titre polonais).
`);
}

async function addOne(query, opts, prefix = '') {
  process.stdout.write(`${prefix}» ${query}\n`);
  try {
    const entry = await dl.downloadTrack(query, {
      ...opts,
      onLog: (msg) => process.stdout.write(`${prefix}   ${msg}\n`),
    });
    if (entry.alreadyPresent) return { skipped: true };

    const orig = entry.originalTitle ? `  (${entry.originalTitle})` : '';
    const who = entry.artist ? ` — ${entry.artist}` : '';
    console.log(`${prefix}   ✓ ${entry.title}${who}${orig}   [${entry.genre}]`);
    if (entry.needsReview) {
      console.log(`${prefix}   ⚠ titre non latin : donne-lui son nom connu avec`);
      console.log(`${prefix}     node tools/retitle.js "${entry.fileName}" --title "Nom connu"`);
    }
    return { ok: true, entry };
  } catch (e) {
    console.log(`${prefix}   ✗ ${e.message}`);
    return { failed: true, error: e.message };
  }
}

async function main() {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  if (argv.includes('--genres')) {
    console.log('Genres disponibles :');
    for (const g of T.GENRES) console.log(`  - ${g}`);
    return;
  }

  if (argv.includes('--check')) {
    const tools = dl.checkTools();
    console.log(`yt-dlp : ${tools.ytdlp || 'ABSENT'}`);
    console.log(`ffmpeg : ${tools.ffmpeg || 'ABSENT'}`);
    if (!tools.ok) {
      console.log(`\nÀ installer : ${tools.missing.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nTout est prêt.');
    }
    return;
  }

  const opts = {
    genre: flag('--genre'),
    title: flag('--title'),
    artist: flag('--artist'),
    force: argv.includes('--force'),
  };

  const listFile = flag('--file');
  if (listFile) {
    const p = path.isAbsolute(listFile) ? listFile : path.join(process.cwd(), listFile);
    if (!fs.existsSync(p)) {
      console.error(`Fichier introuvable : ${p}`);
      process.exit(1);
    }
    const lines = fs.readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    console.log(`${lines.length} morceaux à traiter.\n`);
    let ok = 0; let skipped = 0; let failed = 0;

    for (let i = 0; i < lines.length; i++) {
      const [query, genre, title] = lines[i].split('|').map((s) => (s || '').trim());
      const res = await addOne(query, {
        genre: genre || opts.genre,
        title: title || null,
        force: opts.force,
      }, `[${i + 1}/${lines.length}] `);
      if (res.ok) ok++;
      else if (res.skipped) skipped++;
      else failed++;
    }
    console.log(`\nTerminé : ${ok} ajoutés, ${skipped} déjà présents, ${failed} en échec.`);
    return;
  }

  // Tout ce qui n'est pas une option est une requête.
  const flagNames = ['--genre', '--title', '--artist', '--file'];
  const queries = argv.filter((a, i) => {
    if (a.startsWith('--')) return false;
    return !flagNames.includes(argv[i - 1]);
  });

  if (queries.length === 0) {
    usage();
    return;
  }

  for (const q of queries) await addOne(q, opts);
}

main().catch((e) => {
  console.error('Échec :', e.message);
  process.exit(1);
});
