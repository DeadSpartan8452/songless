'use strict';

/**
 * Import de fichiers dans Songless.
 *
 * Deux portes d'entrée :
 *   - un fichier audio déposé sur le site
 *   - une archive .zip, décompressée puis traitée morceau par morceau
 *
 * Dans les deux cas, chaque fichier reçoit le même traitement que le reste de
 * la bibliothèque : titre rendu lisible, genre déduit, alias construits — et
 * les rapprochements probables sont signalés sans supprimer de version.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const T = require('./titles');
const store = require('./store');
const dupes = require('./dupes');
const enricher = require('./enricher');
const musicbrainz = require('./musicbrainz');

const MUSIC_DIR = process.env.SONGLESS_MUSIC_DIR
  ? path.resolve(process.env.SONGLESS_MUSIC_DIR)
  : path.join(__dirname, '..', 'musiques');
const TMP_DIR = path.join(path.dirname(MUSIC_DIR), '.cache', 'extraction');
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus'];

// adm-zip charge l'archive entière en mémoire. Au-delà de ce seuil on passe par
// tar, qui décompresse en flux : c'est la différence entre importer une archive
// de 6 Go et faire tomber Node faute de mémoire.
const SEUIL_STREAM = 400 * 1024 * 1024;

/** Nom de fichier sûr sous Windows, accents conservés. */
function nomSur(nom) {
  return String(nom)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\.+|[.\s]+$/g, '')
    .slice(0, 150)
    .trim() || 'sans-titre';
}

/** Évite d'écraser un fichier existant : « titre (2).mp3 ». */
function nomLibre(nom) {
  const ext = path.extname(nom);
  const base = path.basename(nom, ext);
  let candidat = nom;
  let n = 2;
  while (fs.existsSync(path.join(MUSIC_DIR, candidat))) {
    candidat = `${base} (${n})${ext}`;
    n++;
  }
  return candidat;
}

const estAudio = (nom) => AUDIO_EXT.includes(path.extname(nom).toLowerCase());

/** Tous les fichiers audio d'un dossier, sous-dossiers compris. */
function listerAudio(racine) {
  const trouves = [];
  for (const e of fs.readdirSync(racine, { withFileTypes: true })) {
    const p = path.join(racine, e.name);
    if (e.isDirectory()) trouves.push(...listerAudio(p));
    else if (estAudio(e.name)) trouves.push(p);
  }
  return trouves;
}

const effacer = (chemin) => {
  try { fs.rmSync(chemin, { recursive: true, force: true }); } catch (_) { /* déjà parti */ }
};

/**
 * Place des fichiers audio dans musiques/, l'arborescence d'origine à plat.
 * @returns {{ecrits: string[], nomsOrigine: object}}
 */
function installer(chemins, { deplacer = false, onLog = () => {} } = {}) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const ecrits = [];
  const nomsOrigine = {};

  for (const src of chemins) {
    const souhaite = nomSur(path.basename(src));
    const nom = nomLibre(souhaite);
    const dest = path.join(MUSIC_DIR, nom);
    try {
      if (deplacer) {
        // rename échoue d'un disque à l'autre : on retombe sur copier/supprimer.
        try { fs.renameSync(src, dest); }
        catch (_) { fs.copyFileSync(src, dest); fs.unlinkSync(src); }
      } else {
        fs.copyFileSync(src, dest);
      }
      ecrits.push(nom);
      // Le suffixe « (2) » anti-collision ne doit pas contaminer le titre.
      if (nom !== souhaite) nomsOrigine[nom] = souhaite;
    } catch (e) {
      onLog(`✗ ${path.basename(src)} : ${e.message}`);
    }
  }
  return { ecrits, nomsOrigine };
}

/**
 * Décompresse avec tar, livré d'origine avec Windows 10/11 et capable de lire
 * les .zip. Contrairement à adm-zip, il travaille en flux : la taille de
 * l'archive n'a plus d'importance.
 */
function extraireParTar(cheminZip, dest) {
  // Git installe un tar GNU, incapable de lire un zip : on vise celui de
  // Windows en priorité, quel que soit l'ordre du PATH.
  const candidats = [
    process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'tar.exe'),
    'tar',
  ].filter(Boolean);

  for (const exe of candidats) {
    try {
      const r = spawnSync(exe, ['-xf', cheminZip, '-C', dest], { stdio: 'ignore' });
      if (!r.error && r.status === 0) return true;
    } catch (_) { /* candidat suivant */ }
  }
  return false;
}

/**
 * Extrait les fichiers audio d'une archive dans musiques/.
 * @returns {{ecrits: string[], nomsOrigine: object}}
 */
function extraireArchive(cheminZip, onLog = () => {}) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const taille = fs.statSync(cheminZip).size;

  if (taille > SEUIL_STREAM) {
    const tmp = path.join(TMP_DIR, `zip-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    onLog(`Archive de ${(taille / 1073741824).toFixed(2)} Go : décompression en flux…`);

    if (extraireParTar(cheminZip, tmp)) {
      const trouves = listerAudio(tmp);
      if (trouves.length === 0) {
        effacer(tmp);
        throw new Error("L'archive ne contient aucun fichier audio reconnu.");
      }
      onLog(`${trouves.length} fichier(s) audio dans l'archive.`);
      const res = installer(trouves, { deplacer: true, onLog });
      effacer(tmp);
      return res;
    }

    effacer(tmp);
    onLog('tar indisponible : lecture en mémoire, cela peut être long.');
  }

  const zip = new AdmZip(cheminZip);
  const entrees = zip.getEntries().filter((e) => !e.isDirectory && estAudio(e.entryName));

  if (entrees.length === 0) {
    throw new Error("L'archive ne contient aucun fichier audio reconnu.");
  }

  onLog(`${entrees.length} fichier(s) audio dans l'archive.`);

  const ecrits = [];
  const nomsOrigine = {};
  for (const entree of entrees) {
    // On ignore l'arborescence interne : tout atterrit à plat dans musiques/
    const souhaite = nomSur(path.basename(entree.entryName));
    const nom = nomLibre(souhaite);
    try {
      fs.writeFileSync(path.join(MUSIC_DIR, nom), entree.getData());
      ecrits.push(nom);
      if (nom !== souhaite) nomsOrigine[nom] = souhaite;
    } catch (e) {
      onLog(`✗ ${entree.entryName} : ${e.message}`);
    }
  }
  return { ecrits, nomsOrigine };
}

/**
 * Trie une liste de fichiers déjà présents dans musiques/ :
 * fiche enrichie, genre, alias, et signalement des doublons probables.
 *
 * @param {string[]} fichiers  noms de fichiers dans musiques/
 * @param {object}   options   { onLog, reseau }
 * @returns {Promise<object>}  rapport détaillé
 */
async function trier(fichiers, options = {}) {
  const log = options.onLog || (() => {});
  const reseau = options.reseau !== false;

  const overrides = T.loadOverrides();
  const nomsOrigine = options.nomsOrigine || {};
  const nomLogique = (f) => nomsOrigine[f] || f;

  // Repérage des noms écrits « Titre - Artiste » sur l'ensemble du lot
  const splits = fichiers.map((f) => ({ fileName: f, ...T.fromFilename(nomLogique(f)) }));
  const swapSet = T.detectSwappedSides(splits);

  const rapport = { ajoutes: [], doublons: [], erreurs: [], aRevoir: [], genresIncomplets: 0 };
  const aEcrire = {};

  // MusicBrainz impose 1 requête/seconde : depuis le site on plafonne pour ne
  // pas bloquer la page pendant des minutes. En ligne de commande on peut se
  // permettre plus. Le reste se rattrape avec « node tools/enrich.js », qui
  // reprend là où on s'arrête.
  const PLAFOND_RESEAU = options.plafondReseau === undefined ? 40 : options.plafondReseau;
  let appelsReseau = 0;

  for (let i = 0; i < fichiers.length; i++) {
    const fichier = fichiers[i];
    try {
      let fiche = await enricher.ficheDeBase(fichier, overrides, swapSet, nomLogique(fichier));

      if (reseau && !fiche.genre && fiche.artist) {
        // Un artiste déjà en cache ne coûte aucune requête : il ne doit pas
        // consommer le budget, sinon un album d'un même artiste se verrait
        // refuser un genre pourtant disponible gratuitement.
        const gratuit = musicbrainz.dansLeCache(fiche.artist);
        if (gratuit || appelsReseau < PLAFOND_RESEAU) {
          if (!gratuit) appelsReseau++;
          fiche = await enricher.completerGenre(fiche);
        } else {
          rapport.genresIncomplets++;
        }
      }
      fiche = enricher.finaliser(fiche, overrides);

      // Doublon d'un morceau déjà en bibliothèque, ou d'un autre du même lot ?
      const jumeau = dupes.chercherDoublon(fiche, fichier)
        || trouverDansLeLot(fiche, aEcrire, fichier);

      if (jumeau) {
        rapport.doublons.push({
          fichier,
          doublonDe: jumeau.entry.title || jumeau.fileName,
          conserve: true,
        });
        log(`≈ doublon potentiel conservé : ${fiche.title}`);
      }

      aEcrire[fichier] = fiche;
      rapport.ajoutes.push({ fichier, titre: fiche.title, artiste: fiche.artist, genre: fiche.genre });
      if (fiche.needsReview) rapport.aRevoir.push(fiche.title);
      log(`+ ${fiche.title}${fiche.artist ? ' — ' + fiche.artist : ''}  [${fiche.genre}]`);
    } catch (e) {
      rapport.erreurs.push({ fichier, erreur: e.message });
      log(`✗ ${fichier} : ${e.message}`);
    }

    if ((i + 1) % 10 === 0) log(`… ${i + 1}/${fichiers.length}`);
  }

  if (Object.keys(aEcrire).length) store.setMany(aEcrire);
  return rapport;
}

/** Doublon à l'intérieur du lot en cours (l'archive peut se répéter). */
function trouverDansLeLot(fiche, dejaVues, fichierCourant) {
  const sig = dupes.signature(fiche, fichierCourant);
  for (const [fileName, autre] of Object.entries(dejaVues)) {
    if (fileName === fichierCourant) continue;
    if (dupes.memeMorceau(sig, dupes.signature(autre, fileName))) {
      return { fileName, entry: autre };
    }
  }
  return null;
}

/** Importe une archive : extraction puis tri. */
async function importerArchive(cheminZip, options = {}) {
  const log = options.onLog || (() => {});
  log('Lecture de l\'archive…');
  const { ecrits, nomsOrigine } = extraireArchive(cheminZip, log);
  log('Tri des morceaux…');
  return trier(ecrits, { ...options, nomsOrigine });
}

/**
 * Importe un dossier déjà présent sur le disque, sous-dossiers compris.
 * Aucune limite de taille : rien ne transite par le navigateur.
 * @param {object} options { deplacer: true pour vider le dossier source }
 */
async function importerDossier(dossier, options = {}) {
  const log = options.onLog || (() => {});
  const fichiers = listerAudio(dossier);
  if (fichiers.length === 0) {
    throw new Error('Aucun fichier audio dans ce dossier.');
  }
  log(`${fichiers.length} fichier(s) audio trouvé(s).`);

  const { ecrits, nomsOrigine } = installer(fichiers, { deplacer: options.deplacer, onLog: log });
  log('Tri des morceaux…');
  return trier(ecrits, { ...options, nomsOrigine });
}

/** Archive ou dossier, selon ce que désigne le chemin. */
async function importerChemin(chemin, options = {}) {
  const infos = fs.statSync(chemin);
  return infos.isDirectory()
    ? importerDossier(chemin, options)
    : importerArchive(chemin, options);
}

module.exports = {
  importerArchive, importerDossier, importerChemin,
  extraireArchive, listerAudio, installer, trier,
  AUDIO_EXT, MUSIC_DIR, nomSur, nomLibre,
};
