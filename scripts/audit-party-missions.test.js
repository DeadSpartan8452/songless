'use strict';

const assert = require('assert');
const missions = require('../lib/party-missions');
const partyStore = require('../lib/party');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK  ${name}`); }
  catch (error) { console.error(`KO  ${name}`); throw error; }
}

function party(totalRounds = 8) { return { seed: 'missions-audit', totalRounds, players: [] }; }

function activeParty() {
  const created = partyStore.create({
    mode: 'missions', totalRounds: 4, seed: 'missions-party-audit',
    settings: { answer: 'titre', points: 1000, paliers: [1, 3, 6, 10] },
  });
  const first = partyStore.join(created.party.code, {
    id: 'mission-p1', nom: 'Agent un', emoji: '🕶️', multiplayer: {},
  }).player;
  const second = partyStore.join(created.party.code, {
    id: 'mission-p2', nom: 'Agent deux', emoji: '🕵️', multiplayer: {},
  }).player;
  partyStore.command(created.party, created.hostToken, 'start-round', {
    round: 1, trackId: 'mission-track', playback: { offset: 3 },
    answer: { title: 'Bonne réponse', artist: 'Artiste', mode: 'titre' },
  });
  created.party.roundStartedAt = Date.now() - 1;
  created.party.playback.startedAt = Date.now() - 1;
  return { ...created, first, second };
}

test('le catalogue contient trois niveaux réellement croissants', () => {
  const levels = new Set(missions.CATALOG.map(item => item.level));
  assert.deepStrictEqual([...levels], ['easy', 'hard', 'expert']);
  const minimum = level => Math.min(...missions.CATALOG
    .filter(item => item.level === level).map(item => item.target));
  assert.ok(minimum('hard') > minimum('easy'));
  assert.ok(minimum('expert') > minimum('hard'));
});

test('l’attribution est stable et ne dépend pas du navigateur', () => {
  const first = { profileId: 'p1' };
  const second = { profileId: 'p1' };
  assert.strictEqual(missions.assign(party(), first).id, missions.assign(party(), second).id);
});

test('une mission impossible revient à un objectif facile réalisable', () => {
  const value = party(1);
  const player = { profileId: 'expert-court' };
  assert.ok(missions.assign(value, player).target <= 1);
});

test('les progrès suivent les réponses sans encourager un ralentissement', () => {
  const value = party();
  const player = { profileId: 'progression', secretMission: {
    ...missions.CATALOG.find(item => item.id === 'hard_streak_2'),
    progress: 0, currentStreak: 0, completed: false, rewarded: false,
  } };
  missions.recordAnswer(value, player, { correct: true, attempt: 0 });
  missions.recordAnswer(value, player, { correct: true, attempt: 1 });
  assert.strictEqual(player.secretMission.completed, true);
  assert.strictEqual(player.secretMission.progress, 2);
});

test('la récompense du podium est unique et calculée côté serveur', () => {
  const value = party();
  const player = { profileId: 'reward', score: 100, secretMission: {
    ...missions.CATALOG[0], progress: 1, completed: true, rewarded: false,
  } };
  value.players = [player];
  missions.finish(value);
  missions.finish(value);
  assert.strictEqual(player.score, 100 + player.secretMission.reward);
});

test('chaque contrôleur voit sa mission mais jamais celle des autres', () => {
  const context = activeParty();
  const firstView = partyStore.publicState(context.party, context.first.token, null);
  const own = firstView.players.find(player => player.profileId === context.first.profileId);
  const other = firstView.players.find(player => player.profileId === context.second.profileId);
  assert.ok(own.mission && own.mission.description);
  assert.strictEqual(other.mission, null);
  const tvView = partyStore.publicState(context.party, null, null);
  assert.ok(tvView.players.every(player => player.mission === null));
});

test('le podium révèle les missions et applique la récompense serveur', () => {
  const context = activeParty();
  context.first.secretMission = {
    ...missions.CATALOG[0], progress: 0, currentStreak: 0, completed: false, rewarded: false,
  };
  partyStore.playerAction(context.party, context.first.token, 'answer', {
    answer: 'Bonne réponse', reward: 999999,
  });
  const before = context.first.score;
  partyStore.command(context.party, context.hostToken, 'finish');
  assert.strictEqual(context.first.score, before + context.first.secretMission.reward);
  const podium = partyStore.publicState(context.party, null, null);
  assert.ok(podium.players.every(player => player.mission));
  assert.strictEqual(podium.players.find(player => (
    player.profileId === context.first.profileId)).mission.rewarded, true);
});

console.log(`\n${passed} tests Missions secrètes réussis.`);
