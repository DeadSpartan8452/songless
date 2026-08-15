#!/usr/bin/env node
'use strict';

/**
 * Importe une archive ou un dossier déjà présent sur le disque.
 *
 *   node tools/import.js "D:\\musiques.zip"
 *   node tools/import.js "D:\\Ma collection"
 *   node tools/import.js "D:\\Ma collection" --deplacer
 *   node tools/import.js "D:\\musiques.zip" --hors-ligne
 *
 * C'est la voie à prendre pour une grosse archive : rien ne transite par le
 * navigateur, rien n'est recopié dans .cache, et aucun plafond de taille ne
 * s'applique. Le traitement est le même que par le site : titre rendu lisible,
 * genre, alias, et doublons écartés.
 *
 * Options :
 *   --deplacer       vide le dossier source au lieu de copier (sans effet sur un .zip)
 *   --hors-ligne     n'interroge pas MusicBrainz ; « node tools/enrich.js » complètera
 *   --sans-plafond   cherche tous les genres manquants en ligne, sans limite de
 *                    requêtes (1 par seconde : compte le temps sur une grosse archive)
 */

const fs = require('fs');
const path = require('path');
const importer = require('../lib/importer');

const args = process.argv.slice(2);
const options = args.filter((a) => a.startsWith('--'));
const chemin = args.find((a) => !a.startsWith('--'));

if (!chemin) {
  console.log('Usage : node tools/import.js "chemin du .zip ou du dossier" [--deplacer] [--hors-ligne]');
  process.exit(1);
}

const cible = path.resolve(chemin);
if (!fs.existsSync(cible)) {
  console.error(`Introuvable : ${cible}`);
  process.exit(1);
}

const deplacer = options.includes('--deplacer');
const reseau = !options.includes('--hors-ligne');
// En terminal on peut attendre : plafond bien plus large que depuis le site.
const plafondReseau = options.includes('--sans-plafond') ? Infinity : 250;

(async () => {
  const debut = Date.now();
  console.log(`Import de ${cible}`);
  if (deplacer) console.log('Mode déplacement : le dossier source sera vidé de ses fichiers audio.');

  let rapport;
  try {
    rapport = await importer.importerChemin(cible, {
      deplacer,
      reseau,
      plafondReseau,
      onLog: (m) => console.log(m),
    });
  } catch (e) {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
  }

  const secondes = Math.round((Date.now() - debut) / 1000);
  console.log('\n─────────────────────────────');
  console.log(`${rapport.ajoutes.length} ajouté(s)`);
  console.log(`${rapport.doublons.length} doublon(s) écarté(s)`);
  if (rapport.erreurs.length) console.log(`${rapport.erreurs.length} en échec`);
  if (rapport.aRevoir.length) {
    console.log(`${rapport.aRevoir.length} titre(s) en alphabet non latin à renommer :`
      + ' node tools/retitle.js --review');
  }
  if (rapport.genresIncomplets) {
    console.log(`${rapport.genresIncomplets} sans genre : node tools/enrich.js pour les compléter`);
  }
  console.log(`Terminé en ${secondes} s.`);
})();
