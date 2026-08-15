'use strict';

/**
 * Stockage des métadonnées Songless.
 *
 * Les fichiers audio restent la source de vérité pour "quels morceaux existent".
 * Ce fichier-ci ne stocke que ce qu'on a ajouté par-dessus : titre affiché,
 * titre d'origine, artiste, genre, alias acceptés à la saisie.
 *
 * Clé = nom de fichier exact (ce qui survit à un renommage de dossier).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const META_FILE = path.join(ROOT, 'metadata.json');
const BACKUP_DIR = path.join(ROOT, 'metadata-backups');
const BACKUPS_GARDES = 15;

let cache = null;
let cacheMtime = 0;

function emptyStore() {
  return { version: 1, updatedAt: null, tracks: {} };
}

function load(force = false) {
  try {
    const stat = fs.statSync(META_FILE);
    if (!force && cache && stat.mtimeMs === cacheMtime) return cache;
    const raw = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    cache = { ...emptyStore(), ...raw, tracks: raw.tracks || {} };
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('metadata.json illisible :', e.message);
    cache = emptyStore();
    cacheMtime = 0;
    return cache;
  }
}

/**
 * Met de côté la version actuelle avant de l'écraser.
 *
 * `metadata.json` concentre tout le travail de renommage, de genre et d'alias :
 * plusieurs centaines de corrections faites à la main, qu'aucun outil ne sait
 * refabriquer. `prune()` supprime les entrées dont le MP3 a disparu — si le
 * dossier `musiques/` est momentanément inaccessible, tout part d'un coup.
 * Une copie tournante coûte quelques kilo-octets et ferme le sujet.
 *
 * Silencieux en cas d'échec : une sauvegarde ratée ne doit jamais empêcher
 * d'enregistrer une correction.
 */
function sauvegarder() {
  try {
    if (!fs.existsSync(META_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // Millisecondes comprises : deux écritures dans la même seconde — un
    // enrichissement suivi d'un prune, par exemple — méritent deux copies.
    const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
    fs.copyFileSync(META_FILE, path.join(BACKUP_DIR, `metadata-${horodatage}.json`));

    // On ne garde que les plus récentes : le tri par nom suffit, l'horodatage
    // ISO est ordonnable tel quel.
    const copies = fs.readdirSync(BACKUP_DIR)
      .filter(n => n.startsWith('metadata-') && n.endsWith('.json'))
      .sort();
    for (const vieille of copies.slice(0, Math.max(0, copies.length - BACKUPS_GARDES))) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, vieille)); } catch (_) {}
    }
  } catch (e) {
    console.warn('Sauvegarde de metadata.json impossible :', e.message);
  }
}

function save(store) {
  sauvegarder();
  store.updatedAt = new Date().toISOString();
  const tmp = META_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, META_FILE);   // écriture atomique : pas de fichier à moitié écrit
  cache = store;
  try {
    cacheMtime = fs.statSync(META_FILE).mtimeMs;
  } catch (_) {
    cacheMtime = 0;
  }
  return store;
}

function get(fileName) {
  return load().tracks[fileName] || null;
}

function set(fileName, entry) {
  const store = load(true);
  store.tracks[fileName] = { ...(store.tracks[fileName] || {}), ...entry };
  return save(store);
}

/** Écrit plusieurs entrées d'un coup (utilisé par l'enrichissement en masse). */
function setMany(entries) {
  const store = load(true);
  for (const [fileName, entry] of Object.entries(entries)) {
    store.tracks[fileName] = { ...(store.tracks[fileName] || {}), ...entry };
  }
  return save(store);
}

function remove(fileName) {
  const store = load(true);
  if (store.tracks[fileName]) {
    delete store.tracks[fileName];
    save(store);
  }
  return store;
}

/** Supprime les entrées dont le fichier audio n'existe plus. */
function prune(existingFileNames) {
  const keep = new Set(existingFileNames);
  const store = load(true);
  let dropped = 0;
  for (const name of Object.keys(store.tracks)) {
    if (!keep.has(name)) {
      delete store.tracks[name];
      dropped++;
    }
  }
  if (dropped) save(store);
  return dropped;
}

module.exports = { META_FILE, BACKUP_DIR, load, save, get, set, setMany, remove, prune };
