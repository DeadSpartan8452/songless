'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'songless-store-audit-'));
const dataFile = path.join(tempRoot, 'songless-data.json');
const backupDir = path.join(tempRoot, 'backups');
let passed = 0;

function ok(name) {
  passed++;
  console.log(`OK  ${name}`);
}

try {
  fs.writeFileSync(dataFile, JSON.stringify({
    version: 1,
    profiles: [],
    collections: [],
    challenges: [],
    partyHistory: [{
      id: 'ph_test',
      date: '2026-09-02T00:00:00.000Z',
      code: 'ABC123',
      mode: 'classic',
      totalRounds: 3,
      winner: { nom: 'Alpha', emoji: '🎧', score: 5 },
      playersCount: 1,
      players: [{ nom: 'Alpha', emoji: '🎧', score: 5, rank: 1 }],
    }],
  }), 'utf8');

  process.env.SONGLESS_DATA_FILE = dataFile;
  process.env.SONGLESS_BACKUP_DIR = backupDir;
  const store = require('../lib/player-store');

  const loaded = store.partyHistory();
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, 'ph_test');
  assert.strictEqual(loaded[0].winner.nom, 'Alpha');
  ok('l’historique multijoueur survit au chargement');

  const alpha = store.upsertProfile({
    id: 'alpha<>',
    nom: '  Alpha  ',
    emoji: '🎧',
    stats: {
      played: 8.9,
      wins: 3,
      abandons: -4,
      distribution: [1, 2, 3],
    },
    settings: { reponse: 'titre', vitesse: 1.25, interdit: 'retiré' },
  });
  assert.strictEqual(alpha.id, 'alpha');
  assert.strictEqual(alpha.nom, 'Alpha');
  assert.strictEqual(alpha.stats.played, 8);
  assert.strictEqual(alpha.stats.abandons, 0);
  assert.deepStrictEqual(alpha.stats.distribution, [1, 2, 3, 0, 0, 0]);
  assert.deepStrictEqual(alpha.settings, { reponse: 'titre', vitesse: 1.25 });
  ok('les profils, statistiques et réglages sont normalisés');

  const updated = store.updateProfile('alpha', { nom: 'Alpha 2' });
  assert.strictEqual(updated.nom, 'Alpha 2');
  assert.strictEqual(updated.stats.played, 8);
  assert.deepStrictEqual(updated.settings, { reponse: 'titre', vitesse: 1.25 });
  assert.strictEqual(store.updateProfile('absent', { nom: 'X' }), null);
  ok('une modification conserve les statistiques existantes');

  store.upsertProfile({ id: 'beta', nom: 'Beta', emoji: '🎵' });
  const sessions = store.recordPartySessions([
    {
      profileId: 'alpha', score: 1200, sessionRounds: 3,
      sessionAnswers: 3, sessionCorrect: 2,
    },
    {
      profileId: 'beta', score: 800, sessionRounds: 3,
      sessionAnswers: 3, sessionCorrect: 1,
    },
    { profileId: 'inconnu', score: 9999 },
  ]);
  assert.strictEqual(sessions.length, 2);
  const afterSession = store.publicState();
  const alphaAfter = afterSession.profiles.find(profile => profile.id === 'alpha');
  const betaAfter = afterSession.profiles.find(profile => profile.id === 'beta');
  assert.deepStrictEqual(
    {
      sessions: alphaAfter.multiplayer.sessions,
      wins: alphaAfter.multiplayer.wins,
      score: alphaAfter.multiplayer.score,
      bestScore: alphaAfter.multiplayer.bestScore,
    },
    { sessions: 1, wins: 1, score: 1200, bestScore: 1200 }
  );
  assert.strictEqual(betaAfter.multiplayer.wins, 0);
  ok('les statistiques multijoueur sont cumulées sans créer de profil fantôme');

  const withLists = store.replaceLists({
    collections: [{
      id: 'collection<>1',
      nom: '  Favoris  ',
      trackIds: ['titre-a', 'titre-a', '', 'titre-b'],
    }],
    challenges: [{
      id: 'defi<>1',
      nom: 'Défi test',
      trackIds: ['titre-b'],
      seed: 'SEED-1',
      totalRounds: 4,
      genres: ['Rock'],
      settings: { vitesse: 1.5 },
    }],
  });
  assert.strictEqual(withLists.collections[0].id, 'collection1');
  assert.strictEqual(withLists.collections[0].nom, 'Favoris');
  assert.deepStrictEqual(withLists.collections[0].trackIds, ['titre-a', 'titre-b']);
  assert.strictEqual(withLists.challenges[0].seed, 'SEED-1');
  assert.strictEqual(withLists.challenges[0].totalRounds, 4);
  assert.deepStrictEqual(withLists.challenges[0].genres, ['Rock']);
  ok('les collections et défis gardent leurs paramètres et dédoublonnent les morceaux');

  const beforeBackup = store.publicState();
  const backupFile = store.backup();
  assert.strictEqual(path.dirname(backupFile), backupDir);
  assert.strictEqual(path.resolve(backupFile).startsWith(path.resolve(tempRoot)), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupFile, 'utf8')), beforeBackup);
  ok('la sauvegarde est complète et reste dans le dossier temporaire configuré');

  for (const invalid of [null, [], {}, { profiles: 'non' }, { profiles: [], collections: {} }]) {
    assert.throws(() => store.replaceAll(invalid), /objet JSON|profils|collections/);
  }
  assert.deepStrictEqual(store.publicState(), beforeBackup);
  ok('une importation invalide est refusée sans effacer les données');

  const imported = store.replaceAll({
    version: 1,
    profiles: [{
      id: 'import<>', nom: ' Import ', emoji: '🎤',
      stats: { played: -2, wins: 1 },
    }],
    collections: [{ id: 'c<>', nom: ' Importée ', trackIds: ['x', 'x', 'y'] }],
    challenges: [null],
    partyHistory: [],
  });
  assert.strictEqual(imported.profiles[0].id, 'import');
  assert.strictEqual(imported.profiles[0].stats.played, 0);
  assert.deepStrictEqual(imported.collections[0].trackIds, ['x', 'y']);
  assert.strictEqual(imported.challenges[0].nom, 'Sans nom');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')), imported);
  ok('l’import valide est normalisé puis persisté sur disque');

  const restored = store.replaceAll(JSON.parse(fs.readFileSync(backupFile, 'utf8')));
  assert.deepStrictEqual(
    restored.profiles.map(profile => profile.id),
    beforeBackup.profiles.map(profile => profile.id)
  );
  assert.deepStrictEqual(restored.collections[0].trackIds, ['titre-a', 'titre-b']);
  assert.strictEqual(restored.collections[0].updatedAt, beforeBackup.collections[0].updatedAt);
  assert.strictEqual(restored.partyHistory[0].id, 'ph_test');
  ok('une sauvegarde exportée restaure profils, listes, statistiques et historique');

  assert.strictEqual(store.deleteProfile('beta'), true);
  assert.strictEqual(store.deleteProfile('beta'), false);
  assert.strictEqual(store.publicState().profiles.some(profile => profile.id === 'beta'), false);
  ok('la suppression de profil est persistante et idempotente');

  console.log(`\n${passed} tests de stockage réussis.`);
} finally {
  delete process.env.SONGLESS_DATA_FILE;
  delete process.env.SONGLESS_BACKUP_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
