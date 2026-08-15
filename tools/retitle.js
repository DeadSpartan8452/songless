#!/usr/bin/env node
'use strict';

/**
 * Correction manuelle d'un morceau (titre affiché, genre, artiste, alias).
 *
 *   node tools/retitle.js --review
 *   node tools/retitle.js "Пыяла.mp3" --title "Pyyala (Slovo Patsana)" --genre "Électro / EDM"
 *   node tools/retitle.js "gdzie.mp3" --alias "polish cow" --alias "vache polonaise"
 *
 * Une entrée corrigée ici est marquée « validée » : node tools/enrich.js ne
 * l'écrasera plus (sauf --force).
 */

const fs = require('fs');
const path = require('path');
const T = require('../lib/titles');
const store = require('../lib/store');

const MUSIC_DIR = path.join(__dirname, '..', 'musiques');
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function allFlags(name) {
  const out = [];
  argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

/** Retrouve un morceau par nom de fichier exact, puis par correspondance souple. */
function resolveFile(needle) {
  const tracks = store.load(true).tracks;
  if (tracks[needle]) return needle;

  const key = T.tightKey(needle);
  const matches = Object.keys(tracks).filter((f) =>
    T.tightKey(f).includes(key) || T.tightKey(tracks[f].title || '').includes(key));

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.error(`Plusieurs correspondances pour « ${needle} » :`);
    for (const m of matches.slice(0, 10)) console.error(`   ${m}`);
    process.exit(1);
  }
  return null;
}

function main() {
  if (argv.includes('--review')) {
    const tracks = store.load(true).tracks;
    const todo = Object.entries(tracks).filter(([, e]) => e.needsReview && !e.reviewed);
    if (todo.length === 0) {
      console.log('Aucun titre en attente de relecture.');
      return;
    }
    console.log(`${todo.length} titres à nommer (alphabet non latin) :\n`);
    for (const [file, e] of todo) {
      console.log(`  ${e.title}`);
      if (e.originalTitle) console.log(`     original : ${e.originalTitle}`);
      console.log(`     fichier  : ${file}`);
      console.log(`     corriger : node tools/retitle.js "${file}" --title "Nom connu"\n`);
    }
    return;
  }

  const target = argv.find((a) => !a.startsWith('--')
    && !['--title', '--genre', '--artist', '--alias', '--original'].includes(argv[argv.indexOf(a) - 1]));

  if (!target) {
    console.log(`
Usage :
  node tools/retitle.js --review
  node tools/retitle.js "<nom de fichier>" --title "..." [--genre "..."] [--artist "..."] [--alias "..."] [--original "..."]

  --artist ""    vide un artiste inventé par un mauvais découpage du nom
  --original ""  vide le titre d'origine affiché en fin de partie
`);
    return;
  }

  const fileName = resolveFile(target);
  if (!fileName) {
    console.error(`Aucun morceau ne correspond à « ${target} ».`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(MUSIC_DIR, fileName))) {
    console.error(`Le fichier audio n'existe plus : ${fileName}`);
    process.exit(1);
  }

  const current = store.get(fileName) || {};
  const patch = { reviewed: true, needsReview: false };

  const title = flag('--title');
  const genre = flag('--genre');
  const artist = flag('--artist');
  const aliases = allFlags('--alias');

  if (title) {
    // L'ancien titre devient le titre d'origine s'il n'y en a pas déjà un.
    if (!current.originalTitle && T.norm(current.title) !== T.norm(title)) {
      patch.originalTitle = current.title || '';
    }
    patch.title = title;
  }
  if (genre) {
    const resolved = T.resolveGenre(genre);
    if (!resolved) {
      console.error(`Genre inconnu : « ${genre} ». Liste : node tools/download.js --genres`);
      process.exit(1);
    }
    patch.genre = resolved;
  }
  // --artist "" est une consigne, pas une absence de consigne : c'est ainsi
  // qu'on vide un artiste inventé par un mauvais découpage du nom de fichier.
  if (artist !== null) patch.artist = artist;

  // Idem pour le titre d'origine : après correction d'un titre et d'un artiste
  // inversés, l'ancien « titre d'origine » n'est plus qu'une erreur affichée
  // en fin de partie.
  const original = flag('--original');
  if (original !== null) patch.originalTitle = original;

  patch.aliases = T.buildAliases(
    patch.title || current.title,
    patch.originalTitle || current.originalTitle,
    current.aliases || [],
    aliases,
  );

  store.set(fileName, patch);
  const after = store.get(fileName);
  console.log(`✓ ${after.title}${after.artist ? ` — ${after.artist}` : ''}   [${after.genre}]`);
  if (after.originalTitle) console.log(`  titre d'origine : ${after.originalTitle}`);
  console.log(`  réponses acceptées : ${after.aliases.length}`);
}

main();
