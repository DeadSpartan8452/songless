'use strict';

const T = require('./titles');
const trackMetadata = require('./track-metadata');

const UNOFFICIAL_VARIANT = /\b(nightcore|sped\s*up|speed\s*up|slowed(?:\s*(?:and|&|\+)\s*reverb)?|bass\s*boosted|8d\s*audio|fan\s*made|fanmade|parod(?:ie|y)|spoof|bootleg|mashup|cover|reprise|karaoke|tiktok\s*(?:version|edit)|amv\s*edit)\b/i;

function estVersionNonOfficielle(track = {}, fileName = '') {
  return Boolean(track.unofficialVariant || UNOFFICIAL_VARIANT.test([
    track.title,
    track.originalTitle,
    track.version,
    track.variant,
    fileName,
  ].filter(Boolean).join(' ')));
}

function artisteManquant(value) {
  const artist = T.norm(value || '');
  return !artist || artist === 'artiste inconnu' || artist === 'artiste inconnue';
}

function peutRemplacerGenre(track) {
  const classification = trackMetadata.readClassification(track);
  if (classification.genreSource === 'manual') return false;
  return !track.genre || track.genre === 'Autre'
    || !['high', 'medium'].includes(classification.genreConfidence);
}

function peutRemplacerArtiste(track) {
  if (artisteManquant(track.artist)) return true;
  if (track.artistSource === 'manual') return false;
  return !['high', 'medium'].includes(track.artistConfidence);
}

function peutRemplacerAnnee(track) {
  const classification = trackMetadata.readClassification(track);
  if (classification.yearSource === 'manual') return false;
  return !classification.year
    || !['high', 'medium'].includes(classification.yearConfidence);
}

/**
 * Produit uniquement les changements suffisamment fiables pour être appliqués
 * automatiquement. Un titre déjà présent n'est jamais renommé par Internet.
 */
function proposition(track = {}, resultat = null, date = new Date().toISOString()) {
  if (!resultat || typeof resultat !== 'object') {
    return { metadataCheckedAt: date, metadataMatch: 'none' };
  }

  const patch = {
    metadataCheckedAt: date,
    metadataMatch: 'musicbrainz',
  };
  if (resultat.source === 'youtube-unofficial') {
    patch.unofficialVariant = true;
    patch.metadataMatch = resultat.noMatch ? 'none' : 'youtube';
    if (resultat.videoId) patch.videoId = String(resultat.videoId);
    if (resultat.genre && peutRemplacerGenre(track)) {
      patch.genre = T.resolveGenre(resultat.genre) || resultat.genre;
      patch.genreSource = resultat.genreSource === 'youtube' ? 'youtube' : 'filename';
      patch.genreConfidence = resultat.genreConfidence === 'medium' ? 'medium' : 'low';
    }
    return patch;
  }
  if (resultat.id) patch.musicbrainzRecordingId = String(resultat.id);

  if (!String(track.title || '').trim() && resultat.title) {
    patch.title = String(resultat.title).trim();
    patch.titleSource = 'musicbrainz';
    patch.titleConfidence = 'medium';
  }
  if (peutRemplacerArtiste(track) && resultat.artist) {
    patch.artist = String(resultat.artist).trim();
    patch.artistSource = 'musicbrainz';
    patch.artistConfidence = 'medium';
  }
  if (resultat.year && peutRemplacerAnnee(track)) {
    patch.year = Number(resultat.year);
    patch.yearSource = 'musicbrainz';
    patch.yearConfidence = 'medium';
  }
  if (!String(track.album || '').trim() && resultat.album) {
    patch.album = String(resultat.album).trim().slice(0, 180);
    patch.albumSource = 'musicbrainz';
    patch.albumConfidence = 'medium';
  }
  if (resultat.genre && peutRemplacerGenre(track)) {
    patch.genre = T.resolveGenre(resultat.genre) || resultat.genre;
    patch.genreSource = 'musicbrainz';
    patch.genreConfidence = 'medium';
  }
  return patch;
}

module.exports = {
  artisteManquant,
  estVersionNonOfficielle,
  peutRemplacerArtiste,
  peutRemplacerAnnee,
  peutRemplacerGenre,
  proposition,
};
