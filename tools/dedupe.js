#!/usr/bin/env node
'use strict';

/**
 * Repère les doublons de la bibliothèque : deux fichiers différents pour le
 * même morceau (téléchargé deux fois, ou déjà présent sous un autre nom).
 *
 *   node tools/dedupe.js            liste les doublons probables
 *   node tools/dedupe.js --apply    supprime le moins bon de chaque paire
 *
 * En cas de doublon on garde le fichier le plus ancien (celui que tu avais
 * déjà) et on lui transfère le titre affiché du plus récent s'il est meilleur.
 */

const fs = require('fs');
const path = require('path');
const T = require('../lib/titles');
const store = require('../lib/store');
const dupes = require('../lib/dupes');

const MUSIC_DIR = path.join(__dirname, '..', 'musiques');
const APPLY = process.argv.includes('--apply');

// La définition de « même morceau » vit dans lib/dupes.js, partagée avec
// l'import et le téléchargement. Cet outil en avait une copie, restée en
// arrière : deux comportements pour une seule question.
const signature = dupes.signature;
const sameTrack = dupes.memeMorceau;

function main() {
  const tracks = store.load(true).tracks;
  const files = Object.keys(tracks).filter((f) => fs.existsSync(path.join(MUSIC_DIR, f)));

  const sigs = files.map((f) => signature(tracks[f], f));
  const pairs = [];
  const consumed = new Set();

  for (let i = 0; i < sigs.length; i++) {
    if (consumed.has(sigs[i].file)) continue;
    for (let j = i + 1; j < sigs.length; j++) {
      if (consumed.has(sigs[j].file)) continue;
      if (!sameTrack(sigs[i], sigs[j])) continue;

      const a = path.join(MUSIC_DIR, sigs[i].file);
      const b = path.join(MUSIC_DIR, sigs[j].file);
      // On garde le plus ancien : c'est celui qui était déjà dans ta bibliothèque.
      const aTime = fs.statSync(a).mtimeMs;
      const bTime = fs.statSync(b).mtimeMs;
      const keep = aTime <= bTime ? sigs[i].file : sigs[j].file;
      const drop = keep === sigs[i].file ? sigs[j].file : sigs[i].file;

      pairs.push({ keep, drop });
      consumed.add(drop);
    }
  }

  if (pairs.length === 0) {
    console.log('Aucun doublon détecté.');
    return;
  }

  console.log(`${pairs.length} doublon(s) :\n`);
  for (const { keep, drop } of pairs) {
    console.log(`  garder   ${keep}`);
    console.log(`  retirer  ${drop}\n`);
  }

  if (!APPLY) {
    console.log('Relance avec --apply pour supprimer les fichiers en trop.');
    return;
  }

  for (const { keep, drop } of pairs) {
    const kept = tracks[keep] || {};
    const dropped = tracks[drop] || {};

    // Le doublon a parfois un meilleur titre (nom connu) : on le récupère.
    const patch = {};
    if (dropped.reviewed || (dropped.originalTitle && !kept.originalTitle)) {
      if (dropped.title) patch.title = dropped.title;
      if (dropped.originalTitle) patch.originalTitle = dropped.originalTitle;
      if (dropped.artist && !kept.artist) patch.artist = dropped.artist;
      if (dropped.genre && dropped.genre !== 'Autre') patch.genre = dropped.genre;
      patch.aliases = T.buildAliases(
        patch.title || kept.title,
        patch.originalTitle || kept.originalTitle,
        kept.aliases || [],
        dropped.aliases || [],
      );
      patch.needsReview = false;
      patch.reviewed = true;
      store.set(keep, patch);
      console.log(`↳ ${keep}`);
      console.log(`   titre repris : ${patch.title || kept.title}`);
    }

    dupes.mettreAuRebut(drop);
    store.remove(drop);
    console.log(`✗ écarté : ${drop}\n`);
  }

  console.log(`${pairs.length} doublon(s) traité(s).`);
  console.log(`Les fichiers écartés sont dans ${dupes.CORBEILLE} — à vider quand tu es sûr.`);
}

main();
