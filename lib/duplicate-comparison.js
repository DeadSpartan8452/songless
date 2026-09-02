'use strict';

const crypto = require('crypto');
const dupes = require('./dupes');

function cleanFile(value) {
  return String(value || '').trim().slice(0, 300);
}

function decisionKey(files) {
  const sorted = [...new Set((Array.isArray(files) ? files : []).map(cleanFile).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  if (sorted.length !== 2) return '';
  return crypto.createHash('sha256').update(sorted.join('\0')).digest('hex').slice(0, 24);
}

function reasonFor(left, right, leftSignature, rightSignature) {
  const sameTitle = leftSignature.title && leftSignature.title === rightSignature.title;
  const sameArtist = leftSignature.artist && leftSignature.artist === rightSignature.artist;
  const durationGap = leftSignature.duration && rightSignature.duration
    ? Math.abs(leftSignature.duration - rightSignature.duration) : null;
  if (sameTitle && sameArtist && durationGap !== null && durationGap <= 1) {
    return { confidence: 'high', reason: 'Même titre, même artiste et durée presque identique.' };
  }
  if (sameTitle && sameArtist) {
    return { confidence: 'high', reason: 'Même titre et même artiste, avec une durée compatible.' };
  }
  if (leftSignature.orig && leftSignature.orig === rightSignature.orig && sameArtist) {
    return { confidence: 'high', reason: 'Même titre source et même artiste.' };
  }
  return { confidence: 'medium', reason: 'Titre et artiste semblent répartis différemment entre les deux fiches.' };
}

function publicTrack(track) {
  return {
    id: String(track.id || ''),
    fileName: cleanFile(track.fileName),
    title: String(track.title || '').slice(0, 200),
    artist: String(track.artist || '').slice(0, 200),
    duration: Math.max(0, Number(track.duration) || 0),
    genre: String(track.genre || 'Autre').slice(0, 80),
    year: Number(track.year) || null,
    hasCover: track.hasCover === true,
    size: Math.max(0, Number(track.size) || 0),
  };
}

function findComparisons(tracks, dismissedKeys = [], limit = 200) {
  const source = (Array.isArray(tracks) ? tracks : [])
    .filter(track => track && track.fileName)
    .map(track => ({ track: publicTrack(track), signature: dupes.signature(track, track.fileName) }));
  const dismissed = new Set(Array.isArray(dismissedKeys) ? dismissedKeys.map(String) : []);
  const comparisons = [];
  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      if (!dupes.memeMorceau(source[i].signature, source[j].signature)) continue;
      const files = [source[i].track.fileName, source[j].track.fileName];
      const key = decisionKey(files);
      if (!key || dismissed.has(key)) continue;
      comparisons.push({
        key,
        files,
        ...reasonFor(source[i].track, source[j].track, source[i].signature, source[j].signature),
        exactFile: false,
        tracks: [source[i].track, source[j].track],
      });
      if (comparisons.length >= Math.max(1, Number(limit) || 200)) return comparisons;
    }
  }
  return comparisons;
}

module.exports = { decisionKey, findComparisons };
