#!/usr/bin/env node
'use strict';

/**
 * Passe de rattrapage : nomme les morceaux dont le titre reste illisible
 * après l'enrichissement (japonais, coréen, chinois — la translittération
 * automatique ne s'applique qu'au cyrillique et au grec).
 *
 * Chaque entrée est repérée par un fragment du titre courant.
 * À relancer sans risque : les fiches déjà validées ne sont pas retouchées.
 *
 *   node tools/fix-cjk-titles.js
 */

const T = require('../lib/titles');
const store = require('../lib/store');

// fragment reconnaissable → { titre affiché, genre, réponses acceptées }
const FIXES = [
  ['Deathly Loneliness Attacks', {
    title: 'Deathly Loneliness Attacks', genre: 'Anime / J-Music',
    aliases: ['moudoku ga osou', 'deathly loneliness attacks', 'botw'],
  }],
  ['방탄소년단', {
    title: 'Dynamite', artist: 'BTS', genre: 'Pop',
    aliases: ['dynamite', 'bts dynamite'],
  }],
  ['Myosotis', {
    title: 'Myosotis', artist: 'M2U & Nicode', genre: 'Anime / J-Music',
    aliases: ['myosotis', 'deemo'],
  }],
  ['Magnolia', {
    title: 'Magnolia', artist: 'M2U', genre: 'Anime / J-Music',
    aliases: ['magnolia', 'deemo'],
  }],
  ['Dxrk', {
    title: 'RAVE', artist: 'Dxrk ダーク', genre: 'Électro / EDM',
    aliases: ['rave', 'dxrk rave', 'dark rave'],
  }],
  ['KAMIN', { title: 'Kamin', genre: 'Rap / Hip-Hop', aliases: ['kamin', 'kamin'] }],
  ['Moya golova vintom', {
    title: 'Moya Golova Vintom', artist: 'kostromin', genre: 'Rap / Hip-Hop',
    aliases: ['moya golova vintom', 'my head is spinning like a screw', 'kostromin'],
  }],
  ['GAS GAS GAS', {
    title: 'Gas Gas Gas (Initial D)', artist: 'Manuel', genre: 'Anime / J-Music',
    aliases: ['gas gas gas', 'initial d', 'deja vu'],
  }],
  ['miku miku oo ee oo', {
    title: 'Miku Miku Oo Ee Oo', genre: 'Anime / J-Music',
    aliases: ['miku miku oo ee oo', 'miku miku beam'],
  }],
  ['Rauf Faik', {
    title: 'Detstvo (Enfance)', artist: 'Rauf & Faik', genre: 'Pop',
    aliases: ['detstvo', 'rauf faik', 'enfance'],
  }],
  ['VIRTUALNAYa LYuBOV', {
    title: 'Virtualnaya Lyubov (Amour virtuel)', genre: 'Pop',
    aliases: ['virtualnaya lyubov', 'amour virtuel', 'virtual love'],
  }],
  ['LEMON MELON COOKIE', {
    title: 'Lemon Melon Cookie', genre: 'Anime / J-Music',
    aliases: ['lemon melon cookie'],
  }],
  ['ADLIN', {
    title: 'Dead Inside', artist: 'ADLIN', genre: 'Rap / Hip-Hop',
    aliases: ['dead inside', 'adlin'],
  }],
  ['Voruyu alkogol', {
    title: 'Voruyu Alkogol', genre: 'Rap / Hip-Hop',
    aliases: ['voruyu alkogol', 'floki'],
  }],
  ['Ochame Kinou', {
    title: 'Ochame Kinou (Deltarune Ralsei)', genre: 'Anime / J-Music',
    aliases: ['ochame kinou', 'ralsei', 'deltarune'],
  }],
  ['Little Cat Skip', {
    title: 'Little Cat Skip (OneShot)', genre: 'Jeu vidéo',
    aliases: ['little cat skip', 'oneshot'],
  }],
  ['teto teto oo ee oo', {
    title: 'Teto Teto Oo Ee Oo', genre: 'Anime / J-Music',
    aliases: ['teto teto oo ee oo', 'kasane teto'],
  }],
  ['ReoNa', {
    title: 'Nai Nai (Shadows House)', artist: 'ReoNa', genre: 'Anime / J-Music',
    aliases: ['nai nai', 'shadows house', 'reona'],
  }],
  ['メズマライザー', {
    title: 'Mesmerizer', genre: 'Anime / J-Music',
    aliases: ['mesmerizer', 'mezumaraiza', 'miku teto'],
  }],
  ['Say Meow Meow', {
    title: 'Say Meow Meow', genre: 'Meme / Internet',
    aliases: ['say meow meow', 'xue mao jiao'],
  }],
  ['Young Girl A', {
    title: 'Shoujo A (Young Girl A)', genre: 'Anime / J-Music',
    aliases: ['shoujo a', 'young girl a'],
  }],
  ['ラグトレイン', {
    title: 'Lagtrain', artist: 'Inabakumori', genre: 'Anime / J-Music',
    aliases: ['lagtrain', 'ragutorein', 'inabakumori'],
  }],
  ['Dieu ne ment jamais', {
    title: 'Dieu ne ment jamais', artist: 'Damso', genre: 'Rap / Hip-Hop',
    aliases: ['dieu ne ment jamais', 'damso'],
  }],
];

function main() {
  const tracks = store.load(true).tracks;
  const patch = {};
  const unmatched = [];

  for (const [fragment, fix] of FIXES) {
    // Un fragment purement CJK se réduit à une clé vide (tightKey ne garde que
    // a-z0-9) : dans ce cas on compare les chaînes brutes, sinon `includes('')`
    // serait vrai partout et réécrirait toute la bibliothèque.
    const key = T.tightKey(fragment);
    const hits = Object.keys(tracks).filter((f) => {
      const t = tracks[f];
      const haystacks = [t.title || '', t.originalTitle || '', f];
      if (key.length >= 3) {
        return haystacks.some((h) => T.tightKey(h).includes(key));
      }
      return haystacks.some((h) => h.includes(fragment));
    });

    if (hits.length === 0) {
      unmatched.push(fragment);
      continue;
    }
    // Un fragment censé désigner UN morceau qui en touche plusieurs est trop
    // vague ("BTS" attrapait aussi « Coldplay X BTS My Universe ») : on refuse.
    if (hits.length > 1) {
      console.log(`⚠ « ${fragment} » correspond à ${hits.length} fichiers, ignoré :`);
      for (const h of hits) console.log(`     ${h}`);
      continue;
    }

    for (const fileName of hits) {
      const current = tracks[fileName];
      if (current.reviewed) continue;          // correction manuelle déjà faite

      patch[fileName] = {
        title: fix.title,
        originalTitle: current.originalTitle || current.title || '',
        artist: fix.artist || current.artist || '',
        genre: T.resolveGenre(fix.genre) || current.genre || 'Autre',
        aliases: T.buildAliases(fix.title, current.originalTitle, current.title, fix.aliases || []),
        needsReview: false,
        reviewed: true,
      };
      console.log(`✓ ${fix.title}`);
      console.log(`    ← ${current.title}`);
    }
  }

  if (Object.keys(patch).length) store.setMany(patch);

  console.log(`\n${Object.keys(patch).length} fiches corrigées.`);
  if (unmatched.length) {
    console.log(`Non trouvés (déjà corrigés ou fichier supprimé) : ${unmatched.join(', ')}`);
  }

  const left = Object.values(store.load(true).tracks).filter((e) => e.needsReview && !e.reviewed);
  console.log(`${left.length} titres restent à nommer à la main.`);
  for (const e of left) console.log(`   ${e.title}`);
}

main();
