'use strict';

/**
 * Construit la fiche d'un fichier audio : titre affiché lisible, titre
 * d'origine, artiste, genre, alias.
 *
 * Partagé entre l'enrichissement en masse (tools/enrich.js) et l'import de
 * nouveaux fichiers (lib/importer.js), pour qu'un morceau ajouté par glisser-
 * déposer ou par archive reçoive exactement le même traitement que les autres.
 */

const path = require('path');
const musicMetadata = require('music-metadata');

const T = require('./titles');
const musicbrainz = require('./musicbrainz');

const MUSIC_DIR = path.join(__dirname, '..', 'musiques');

// Un tag ID3 générique ne vaut pas mieux que le nom de fichier.
const TAG_INUTILE = /^(track|piste|audio track|untitled|unknown)\b/i;

/**
 * Fiche d'un fichier, sans réseau.
 * @param {string} fileName   nom réel sur le disque
 * @param {Array}  overrides  table des titres connus (T.loadOverrides())
 * @param {Set}    swapSet    fichiers écrits « Titre - Artiste » (T.detectSwappedSides)
 * @param {string} nomPourTitre  nom dont dériver le titre, si différent du nom
 *   réel. Un import ajoute « (2) » en cas de collision : sans ça le titre
 *   deviendrait « Rolling in the Deep (2) » et ne serait plus reconnu comme un
 *   doublon de l'original.
 */
async function ficheDeBase(fileName, overrides, swapSet = null, nomPourTitre = null) {
  const filePath = path.join(MUSIC_DIR, fileName);
  const nomTitre = nomPourTitre || fileName;

  let tagTitle = '';
  let tagArtist = '';
  let tagGenre = '';
  let duration = 0;
  let hasCover = false;
  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: true });
    tagTitle = (meta.common.title || '').trim();
    tagArtist = (meta.common.artist || '').trim();
    tagGenre = ((meta.common.genre || [])[0] || '').trim();
    duration = meta.format.duration || 0;
    hasCover = !!(meta.common.picture && meta.common.picture.length > 0);
  } catch (_) {
    /* fichier sans tags lisibles : on se rabat sur le nom */
  }

  const fromName = T.fromFilename(nomTitre);
  const useTagTitle = tagTitle && !TAG_INUTILE.test(tagTitle);

  let title = T.cleanTitle(useTagTitle ? tagTitle : fromName.title) || fromName.cleaned || fileName;
  let artist = T.cleanTitle(tagArtist || fromName.artist);

  // « Titre - Artiste » au lieu de « Artiste - Titre » (rips d'OST) : on remet à l'endroit.
  if (swapSet && swapSet.has(fileName) && fromName.artist) {
    title = T.cleanTitle(fromName.artist);
    artist = T.cleanTitle(fromName.title);
  } else if (title.includes(' - ')) {
    // Le titre porte encore « Artiste - Titre » : on sépare, et on préfère ce
    // nom-là si le tag ID3 vient d'un ripper (« YTD », « Vibe Music »...).
    const inner = T.splitArtistTitle(title);
    if (inner.artist) {
      const tagDansLeNom = artist && T.tightKey(nomTitre).includes(T.tightKey(artist));
      if (!artist || !tagDansLeNom) artist = inner.artist;
      title = inner.title;
    }
  }

  let originalTitle = '';
  let genre = null;
  let needsReview = false;

  // 1. Nom réellement connu du public (Polish Cow, Coffin Dance...)
  const ov = T.matchOverride(overrides, title, fromName.cleaned, nomTitre);
  if (ov) {
    originalTitle = ov.originalTitle || (T.norm(title) !== T.norm(ov.title) ? title : '');
    title = ov.title;
    if (ov.artist) artist = ov.artist;
    if (ov.genre) genre = ov.genre;
  } else {
    // 2. Alphabet non latin : translittération, et signalement pour relecture.
    const script = T.detectScript(title);
    if (script !== 'latin') {
      const translittere = T.cleanTitle(T.translit(title));
      originalTitle = title;
      needsReview = true;
      if (T.isReadableLatin(translittere) && T.norm(translittere)) title = translittere;
    }
  }

  if (T.detectScript(artist) !== 'latin') artist = T.translit(artist) || artist;
  if (T.norm(originalTitle) === T.norm(title)) originalTitle = '';

  // 3. Genre : tag ID3, puis indices du nom de fichier.
  if (!genre && tagGenre) genre = T.resolveGenre(tagGenre);
  if (!genre) {
    const devine = T.guessGenre([nomTitre, title, originalTitle, artist]);
    if (devine !== 'Autre') genre = devine;
  }

  return {
    fileName,
    title: title.trim(),
    originalTitle: originalTitle.trim(),
    artist: artist.trim(),
    genre,
    duration: Math.round(duration),
    hasCover,
    aliases: [],
    needsReview,
    reviewed: false,
  };
}

/** Complète le genre via MusicBrainz quand les heuristiques n'ont rien donné. */
async function completerGenre(fiche) {
  if (fiche.genre || !fiche.artist) return fiche;
  try {
    const info = await musicbrainz.genreArtiste(fiche.artist);
    if (info && info.genre) fiche.genre = info.genre;
  } catch (_) {
    /* hors ligne : « Autre », rattrapable par tools/enrich.js */
  }
  return fiche;
}

/** Finalise : genre par défaut et liste des réponses acceptées. */
function finaliser(fiche, overrides) {
  if (!fiche.genre) fiche.genre = 'Autre';
  const ov = T.matchOverride(overrides, fiche.title, fiche.originalTitle, fiche.fileName);
  fiche.aliases = T.buildAliases(
    fiche.title,
    fiche.originalTitle,
    ov ? ov.aliases : [],
    fiche.artist && fiche.title ? `${fiche.artist} ${fiche.title}` : '',
  );
  return fiche;
}

module.exports = { ficheDeBase, completerGenre, finaliser, MUSIC_DIR };
