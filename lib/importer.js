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
const { spawnSync, spawn } = require('child_process');
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
    else if (e.isFile() && estAudio(e.name)) trouves.push(p);
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
      // Le nom disque peut être tronqué à 150 caractères ; conserve le nom
      // complet pour établir le titre et l'artiste pendant le tri.
      if (nom !== souhaite || path.basename(src) !== souhaite) nomsOrigine[nom] = path.basename(src);
    } catch (e) {
      onLog(`✗ ${path.basename(src)} : ${e.message}`);
    }
  }
  return { ecrits, nomsOrigine };
}

async function installerAsync(chemins, { deplacer = false, onLog = () => {}, onProgress = () => {} } = {}) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const ecrits = [];
  const nomsOrigine = {};
  const total = chemins.length;

  for (let index = 0; index < total; index++) {
    const src = chemins[index];
    const souhaite = nomSur(path.basename(src));
    const nom = nomLibre(souhaite);
    const dest = path.join(MUSIC_DIR, nom);
    try {
      if (deplacer) {
        try { await fs.promises.rename(src, dest); }
        catch (_) {
          await fs.promises.copyFile(src, dest);
          await fs.promises.unlink(src);
        }
      } else {
        await fs.promises.copyFile(src, dest);
      }
      ecrits.push(nom);
      if (nom !== souhaite || path.basename(src) !== souhaite) {
        nomsOrigine[nom] = path.basename(src);
      }
    } catch (error) {
      onLog(`Échec d'installation d'un fichier audio : ${error.message}`);
    }
    onProgress({ phase: 'install', current: index + 1, total, label: 'Installation des fichiers audio' });
  }
  return { ecrits, nomsOrigine };
}

/**
 * Décompresse les grosses archives en flux avec les outils du système.
 * Windows fournit tar.exe (bsdtar). Sous Linux, tar GNU ne lit pas les ZIP :
 * on essaie bsdtar puis unzip. Les grosses archives ne repassent jamais par
 * adm-zip, qui charge tout en mémoire et ne peut dépasser 2 Gio dans Node.
 */
function extraireParTar(cheminZip, dest) {
  const candidats = process.platform === 'win32'
    ? [process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'tar.exe')]
    : ['bsdtar', 'unzip'];

  for (const exe of candidats.filter(Boolean)) {
    try {
      const args = process.platform === 'win32' || path.basename(exe) === 'bsdtar'
        ? ['-xf', cheminZip, '-C', dest]
        : ['-qq', '-o', cheminZip, '-d', dest];
      const r = spawnSync(exe, args, { stdio: 'ignore', windowsHide: true });
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
    throw new Error(process.platform === 'win32'
      ? 'Impossible de décompresser ce ZIP en flux avec tar.exe. Vérifie que le ZIP est valide.'
      : 'Impossible de décompresser ce grand ZIP : installe unzip ou bsdtar, puis réessaie.');
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
      if (nom !== souhaite || path.basename(entree.entryName) !== souhaite) {
        nomsOrigine[nom] = path.basename(entree.entryName);
      }
    } catch (e) {
      onLog(`✗ ${entree.entryName} : ${e.message}`);
    }
  }
  return { ecrits, nomsOrigine };
}

function tarExecutable() {
  if (process.platform === 'win32') {
    return process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  }
  return 'tar';
}

function safeArchiveEntry(name) {
  const value = String(name || '').replace(/\\/g, '/');
  return value && !value.startsWith('/') && !path.posix.isAbsolute(value)
    && !path.win32.isAbsolute(value)
    && !value.split('/').some(part => part === '..' || part === '.');
}

function inspectLargeArchive(cheminZip) {
  const exe = tarExecutable();
  if (!exe) throw new Error('tar.exe est introuvable pour lire ce grand ZIP.');
  const list = spawnSync(exe, ['-tf', cheminZip], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (list.error || list.status !== 0) {
    throw new Error('Le contenu du ZIP ne peut pas être lu. Vérifie que l’archive est valide.');
  }
  const entries = String(list.stdout || '').split(/\r?\n/).filter(Boolean);
  if (entries.some(name => !safeArchiveEntry(name))) {
    throw new Error('Le ZIP contient un chemin interdit. Aucun fichier n’a été extrait.');
  }

  const verbose = spawnSync(exe, ['-tvf', cheminZip], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (verbose.error || verbose.status !== 0) {
    throw new Error('Les types de fichiers du ZIP ne peuvent pas être validés.');
  }
  const types = String(verbose.stdout || '').split(/\r?\n/).filter(Boolean);
  if (types.some(line => /^[lh]/i.test(line))) {
    throw new Error('Le ZIP contient un lien symbolique ou matériel interdit.');
  }

  return entries.filter(name => estAudio(name));
}

async function extraireArchiveAvecProgress(cheminZip, options = {}) {
  const onLog = options.onLog || (() => {});
  const onProgress = options.onProgress || (() => {});
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const taille = fs.statSync(cheminZip).size;

  if (taille > SEUIL_STREAM) {
    const tmp = path.join(TMP_DIR, `zip-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const entries = inspectLargeArchive(cheminZip);
      const total = entries.length;
      if (!total) throw new Error("L'archive ne contient aucun fichier audio reconnu.");
      onProgress({ phase: 'extract', current: 0, total, label: 'Décompression du ZIP' });
      onLog(`Archive de ${(taille / 1073741824).toFixed(2)} Go : décompression en flux…`);

      const child = spawn(tarExecutable(), ['-xf', cheminZip, '-C', tmp], {
        stdio: 'ignore', windowsHide: true,
      });
      let previous = -1;
      const timer = setInterval(() => {
        const current = Math.min(total, listerAudio(tmp).length);
        if (current !== previous) {
          previous = current;
          onProgress({ phase: 'extract', current, total, label: 'Décompression du ZIP' });
        }
      }, 600);
      if (timer.unref) timer.unref();
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => {
          if (code === 0) resolve();
          else reject(new Error('La décompression du ZIP a échoué.'));
        });
      }).finally(() => clearInterval(timer));

      const found = listerAudio(tmp);
      if (!found.length) throw new Error("L'archive ne contient aucun fichier audio reconnu.");
      onProgress({ phase: 'extract', current: found.length, total, label: 'Décompression terminée' });
      onLog(`${found.length} fichier(s) audio dans l'archive.`);
      return await installerAsync(found, {
        deplacer: true, onLog,
        onProgress: progress => onProgress({ ...progress, total: progress.total || found.length }),
      });
    } finally {
      effacer(tmp);
    }
  }

  const zip = new AdmZip(cheminZip);
  const entries = zip.getEntries().filter(entry => !entry.isDirectory && estAudio(entry.entryName));
  if (!entries.length) throw new Error("L'archive ne contient aucun fichier audio reconnu.");
  const total = entries.length;
  const ecrits = [];
  const nomsOrigine = {};
  for (let index = 0; index < total; index++) {
    const entry = entries[index];
    const souhaite = nomSur(path.basename(entry.entryName));
    const nom = nomLibre(souhaite);
    await fs.promises.writeFile(path.join(MUSIC_DIR, nom), entry.getData());
    ecrits.push(nom);
    if (nom !== souhaite || path.basename(entry.entryName) !== souhaite) {
      nomsOrigine[nom] = path.basename(entry.entryName);
    }
    onProgress({ phase: 'extract', current: index + 1, total, label: 'Extraction des morceaux' });
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
    if (options.onProgress) {
      options.onProgress({ phase: 'sort', current: i + 1, total: fichiers.length, label: 'Classement des morceaux' });
    }
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
  const { ecrits, nomsOrigine } = await extraireArchiveAvecProgress(cheminZip, options);
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
  extraireArchive, extraireArchiveAvecProgress, listerAudio, installer, installerAsync, safeArchiveEntry, trier,
  AUDIO_EXT, MUSIC_DIR, nomSur, nomLibre,
};
