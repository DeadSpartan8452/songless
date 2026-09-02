'use strict';

/**
 * Détection de doublons, partagée par l'import de fichiers, le téléchargement
 * et le nettoyage (tools/dedupe.js). Une seule définition de « c'est le même
 * morceau », pour que les trois chemins se comportent pareil.
 */

const fs = require('fs');
const path = require('path');
const T = require('./titles');
const store = require('./store');

const MUSIC_DIR = process.env.SONGLESS_MUSIC_DIR
  ? path.resolve(process.env.SONGLESS_MUSIC_DIR)
  : path.join(__dirname, '..', 'musiques');
const CORBEILLE = path.join(path.dirname(MUSIC_DIR), '.cache', 'corbeille');
const MARQUEUR_FEAT = /^(ft|feat|featuring|avec|with)/;
const VARIANT_PATTERNS = [
  ['parodie', /\b(parodie|parody|spoof)\b/],
  ['remix', /\b(remix|remixed|rework|bootleg|mashup)\b/],
  ['sped-up', /\b(sped up|speed up|spedup)\b/],
  ['slowed', /\b(slowed|slowed reverb|slow version)\b/],
  ['live', /\b(live|concert|en public)\b/],
  ['acoustique', /\b(acoustic|acoustique|unplugged)\b/],
  ['instrumental', /\b(instrumental|instrumentale)\b/],
  ['karaoke', /\b(karaoke)\b/],
  ['remaster', /\b(remaster|remastered)\b/],
  ['reprise', /\b(cover|reprise)\b/],
  ['nightcore', /\b(nightcore)\b/],
];

function variantes(entry, fileName = '') {
  const texte = T.norm([
    entry.title,
    entry.originalTitle,
    entry.version,
    entry.variant,
    fileName,
  ].filter(Boolean).join(' '));
  return VARIANT_PATTERNS
    .filter(([, pattern]) => pattern.test(texte))
    .map(([name]) => name);
}

/**
 * Écarte un fichier sans le détruire : il part dans .cache/corbeille.
 * Une détection de doublon reste une supposition ; si elle se trompe, le
 * fichier se récupère au lieu d'être perdu.
 * @returns {string} chemin du fichier mis de côté
 */
function mettreAuRebut(fileName) {
  fs.mkdirSync(CORBEILLE, { recursive: true });
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);

  let dest = path.join(CORBEILLE, fileName);
  let n = 2;
  while (fs.existsSync(dest)) dest = path.join(CORBEILLE, `${base} (${n++})${ext}`);

  const src = path.join(MUSIC_DIR, fileName);
  try {
    fs.renameSync(src, dest);
  } catch (_) {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
  return dest;
}

/** Mots retenus pour comparer deux fiches, sans ordre ni répétition. */
function motsCles(entry) {
  const mots = T.norm(`${entry.title || ''} ${entry.artist || ''}`)
    .split(' ')
    .filter(Boolean);
  return [...new Set(mots)].sort();
}

/** Réduit une fiche à ce qui permet de la comparer. */
function signature(entry, fileName) {
  return {
    file: fileName,
    title: T.tightKey(entry.title || ''),
    orig: T.tightKey(entry.originalTitle || ''),
    artist: T.tightKey(entry.artist || ''),
    mots: motsCles(entry),
    duration: entry.duration || 0,
    variants: variantes(entry, fileName),
  };
}

/**
 * Deux fichiers de durées nettement différentes ne sont pas le même
 * enregistrement, même si leurs tags coïncident : le Megalovania d'Undertale
 * (2:36) et celui de Deltarune (3:04) sont deux morceaux.
 */
function memeDuree(a, b) {
  if (!a.duration || !b.duration) return true;   // durée inconnue : on ne tranche pas
  const ecart = Math.abs(a.duration - b.duration);
  return ecart <= Math.max(4, Math.min(a.duration, b.duration) * 0.05);
}

/**
 * Deux titres identiques à la mention des invités près.
 * On exige un titre d'au moins 10 caractères : sinon « Nightcore »
 * rapprocherait n'importe quoi.
 */
function memeTitreAuFeatPres(t1, t2) {
  if (!t1 || !t2 || t1 === t2) return false;
  const court = t1.length <= t2.length ? t1 : t2;
  const long = court === t1 ? t2 : t1;
  if (court.length < 10 || !long.startsWith(court)) return false;
  return MARQUEUR_FEAT.test(long.slice(court.length));
}

/**
 * Mêmes mots, répartis autrement entre titre et artiste.
 * « ADDICT - HAZBIN HOTEL FR » avait été lu comme artiste ADDICT + titre
 * HAZBIN HOTEL FR, alors que le même morceau sous un autre nom de fichier
 * donnait un titre entier et aucun artiste : deux fiches, un seul morceau, et
 * aucune des règles ci-dessus ne les rapprochait.
 *
 * On exige au moins 3 mots et 12 caractères : sur un titre court, partager son
 * vocabulaire ne prouve rien.
 */
function memeJeuDeMots(a, b) {
  if (a.mots.length < 3 || a.mots.length !== b.mots.length) return false;
  if (a.mots.join('').length < 12) return false;
  return a.mots.every((mot, i) => mot === b.mots[i]);
}

/** Les deux signatures désignent-elles le même morceau ? */
function memeMorceau(a, b) {
  if (!memeDuree(a, b)) return false;

  // Une variante artistique ou technique est un morceau distinct dans
  // Songless. Sans empreinte audio exacte, on préfère toujours conserver un
  // remix, une parodie, une reprise, un sped-up/slowed ou une version live.
  if ((a.variants && a.variants.length) || (b.variants && b.variants.length)) {
    return false;
  }

  const artistesCompatibles = Boolean(a.artist && b.artist
    && (a.artist === b.artist || a.artist.includes(b.artist) || b.artist.includes(a.artist)));

  // Le titre d'origine seul ne suffit pas : une reprise peut partager le même
  // titre sans être le même enregistrement.
  if (artistesCompatibles && a.orig && b.orig && a.orig === b.orig) return true;
  if (artistesCompatibles && a.orig && a.orig === b.title) return true;
  if (artistesCompatibles && b.orig && b.orig === a.title) return true;

  // Titre identique : on exige l'artiste, sinon « Hello » d'Adele et « Hello »
  // d'OMFG passeraient pour un doublon.
  if (a.title && a.title === b.title) {
    if (artistesCompatibles) return true;
  }

  if (artistesCompatibles && memeTitreAuFeatPres(a.title, b.title)) return true;

  return artistesCompatibles && memeJeuDeMots(a, b);
}

/**
 * Cherche dans la bibliothèque un morceau identique à la fiche fournie.
 * @param {object} entry        fiche du candidat
 * @param {string} exclureFichier  nom de fichier à ignorer (le candidat lui-même)
 * @returns {{fileName: string, entry: object}|null}
 */
function chercherDoublon(entry, exclureFichier = null) {
  const sigCandidat = signature(entry, exclureFichier || '');
  if (!sigCandidat.title && !sigCandidat.orig) return null;

  const tracks = store.load(true).tracks;
  for (const [fileName, e] of Object.entries(tracks)) {
    if (fileName === exclureFichier) continue;
    if (!fs.existsSync(path.join(MUSIC_DIR, fileName))) continue;
    if (memeMorceau(sigCandidat, signature(e, fileName))) {
      return { fileName, entry: e };
    }
  }
  return null;
}

module.exports = {
  signature, motsCles, memeMorceau, memeDuree, memeTitreAuFeatPres, memeJeuDeMots,
  variantes, chercherDoublon, mettreAuRebut, MUSIC_DIR, CORBEILLE,
};
