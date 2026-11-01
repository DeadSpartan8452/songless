'use strict';

const path = require('path');
const store = require('./store');
const playerStore = require('./player-store');
const audioProvenance = require('./audio-provenance');
const importer = require('./importer');

const MUSIC_DIR = importer.MUSIC_DIR;

function profileOrigin(profile) {
  if (!profile || !profile.id || !profile.nom) {
    throw new Error('Le profil propriétaire est absent ou invalide.');
  }
  return {
    id: `profile:${profile.id}`,
    label: profile.nom,
    kind: 'profile',
    profileId: profile.id,
  };
}

function createOwnedImportPlaylist(origin, trackIds, kind) {
  const ids = [...new Set((trackIds || []).filter(Boolean).map(String))];
  if (!origin || !origin.profileId || !ids.length) return null;
  const now = new Date();
  const stamp = `${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit',
  })}`;
  return playerStore.createPlaylist({
    nom: `${origin.label} · ${kind} · ${stamp}`,
    description: `${ids.length} morceau(s) importé(s). Profil propriétaire : ${origin.label}.`,
    ownerProfileId: origin.profileId,
    ownerProfileName: origin.label,
    trackIds: ids,
    status: 'draft',
  });
}

async function tagImportedFiles(report, origin, playlistKind = '', options = {}) {
  const source = profileOrigin({
    id: origin && origin.profileId,
    nom: origin && origin.label,
  });
  const files = report.ajoutes || [];
  const patches = Object.fromEntries(files.map(item => [item.fichier, { importSource: source }]));
  if (Object.keys(patches).length) store.setMany(patches);

  const onProgress = options.onProgress || (() => {});
  const tagResults = [];
  onProgress({
    phase: 'profile', current: 0, total: Math.max(1, files.length),
    label: 'Association au profil',
  });
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    tagResults.push(audioProvenance.tagProfile(path.join(MUSIC_DIR, file.fichier), source));
    onProgress({
      phase: 'profile', current: index + 1,
      total: Math.max(1, files.length), label: 'Association au profil',
    });
    if ((index + 1) % 4 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  report.provenanceTags = {
    mp3Tagged: tagResults.filter(result => result.status === 'tagged').length,
    metadataJsonFallback: tagResults.filter(result => result.status !== 'tagged').length,
  };
  if (!playlistKind) return null;

  const ids = files.map(item => Buffer.from(item.fichier).toString('base64url'));
  try {
    const playlist = createOwnedImportPlaylist(source, ids, playlistKind);
    return playlist && {
      id: playlist.id,
      nom: playlist.nom,
      ownerProfileName: source.label,
      count: ids.length,
    };
  } catch (error) {
    report.playlistWarning = error.message;
    return null;
  }
}

async function importArchiveForProfile(archivePath, profile, options = {}) {
  const origin = profileOrigin(profile);
  const report = await importer.importerArchive(archivePath, options);
  const playlist = await tagImportedFiles(report, origin, options.playlistKind || 'ZIP importé', options);
  return { report, playlist };
}

module.exports = {
  createOwnedImportPlaylist,
  importArchiveForProfile,
  profileOrigin,
  tagImportedFiles,
};
