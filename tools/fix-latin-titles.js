#!/usr/bin/env node
'use strict';

/**
 * Titres en alphabet latin mais dont le nom de fichier mélange artiste, titre
 * et mentions parasites. On leur donne le nom sous lequel le morceau est connu.
 *
 * Repérés par tools/list-foreign.js (langues autres que français/anglais) et
 * par relecture. Relançable sans risque : ne touche pas aux fiches validées.
 *
 *   node tools/fix-latin-titles.js
 */

const T = require('../lib/titles');
const store = require('../lib/store');

// fragment unique du titre actuel → fiche corrigée
const FIXES = [
  ['DÁKITI', {
    title: 'Dákiti', artist: 'Bad Bunny & Jhay Cortez', genre: 'Latino',
    aliases: ['dakiti', 'bad bunny dakiti'],
  }],
  ['Edgerunners', {
    title: 'Let You Down (Cyberpunk: Edgerunners)', artist: 'Dawid Podsiadło',
    genre: 'Jeu vidéo', aliases: ['let you down', 'edgerunners', 'cyberpunk edgerunners'],
  }],
  ['Phantom Liberty', {
    title: 'Phantom Liberty (Cyberpunk 2077)', artist: 'Dawid Podsiadło & P.T. Adamczyk',
    genre: 'Jeu vidéo', aliases: ['phantom liberty', 'cyberpunk 2077'],
  }],
  ['We Are Young', {
    title: 'We Are Young', artist: 'Fun. feat. Janelle Monáe', genre: 'Pop',
    aliases: ['we are young', 'fun we are young'],
  }],
  ['Get You The Moon', {
    title: 'Get You The Moon', artist: 'Kina feat. Snøw', genre: 'Électro / EDM',
    aliases: ['get you the moon', 'kina'],
  }],
  ['suffer with me', {
    title: 'Suffer With Me', artist: 'líue', genre: 'Électro / EDM',
    aliases: ['suffer with me'],
  }],
  ['Lean On', {
    title: 'Lean On', artist: 'Major Lazer & DJ Snake feat. MØ', genre: 'Électro / EDM',
    aliases: ['lean on', 'major lazer lean on'],
  }],
  ['BABY SAID', {
    title: 'Baby Said', artist: 'Måneskin', genre: 'Rock',
    aliases: ['baby said', 'maneskin baby said'],
  }],
  ['SUPERMODEL', {
    title: 'Supermodel', artist: 'Måneskin', genre: 'Rock',
    aliases: ['supermodel', 'maneskin supermodel'],
  }],
  ['THE LONELIEST', {
    title: 'The Loneliest', artist: 'Måneskin', genre: 'Rock',
    aliases: ['the loneliest', 'maneskin the loneliest'],
  }],
  ['NO BATIDÃO', {
    title: 'No Batidão (slowed)', artist: 'MAFIA', genre: 'Latino',
    aliases: ['no batidao', 'batidao'],
  }],
  ['Señorita', {
    title: 'Señorita', artist: 'Shawn Mendes & Camila Cabello', genre: 'Pop',
    aliases: ['senorita', 'shawn mendes senorita'],
  }],
  ['Memory Reboot', {
    title: 'Memory Reboot', artist: 'VØJ & Narvent', genre: 'Électro / EDM',
    aliases: ['memory reboot', 'voj narvent'],
  }],
];

function main() {
  const tracks = store.load(true).tracks;
  const patch = {};
  let skipped = 0;

  for (const [fragment, fix] of FIXES) {
    const key = T.tightKey(fragment);
    const hits = Object.keys(tracks).filter((f) => {
      const e = tracks[f];
      const hay = [e.title || '', e.originalTitle || '', f];
      return key.length >= 3
        ? hay.some((h) => T.tightKey(h).includes(key))
        : hay.some((h) => h.includes(fragment));
    });

    if (hits.length === 0) continue;
    if (hits.length > 1) {
      console.log(`⚠ « ${fragment} » correspond à ${hits.length} fichiers, ignoré :`);
      for (const h of hits) console.log(`     ${h}`);
      skipped++;
      continue;
    }

    const fileName = hits[0];
    const current = tracks[fileName];
    if (current.reviewed) continue;

    patch[fileName] = {
      title: fix.title,
      originalTitle: current.originalTitle
        || (T.norm(current.title) !== T.norm(fix.title) ? current.title : ''),
      artist: fix.artist || current.artist || '',
      genre: T.resolveGenre(fix.genre) || current.genre,
      aliases: T.buildAliases(fix.title, current.originalTitle, current.title, fix.aliases || []),
      needsReview: false,
      reviewed: true,
    };
    console.log(`✓ ${fix.title} — ${fix.artist}`);
    console.log(`    ← ${current.title}`);
  }

  if (Object.keys(patch).length) store.setMany(patch);
  console.log(`\n${Object.keys(patch).length} fiches corrigées, ${skipped} ambiguës ignorées.`);
}

main();
