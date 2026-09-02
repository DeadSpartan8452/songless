'use strict';

const crypto = require('crypto');

const CATALOG = Object.freeze([
  Object.freeze({ id: 'easy_correct_1', level: 'easy', emoji: '🌱', label: 'Premier flair', description: 'Trouve au moins 1 morceau.', target: 1, metric: 'correct', reward: 250 }),
  Object.freeze({ id: 'easy_first_1', level: 'easy', emoji: '⚡', label: 'Départ éclair', description: 'Trouve 1 morceau dès le premier extrait.', target: 1, metric: 'firstTry', reward: 300 }),
  Object.freeze({ id: 'hard_correct_3', level: 'hard', emoji: '🔥', label: 'Triplé propre', description: 'Trouve 3 morceaux pendant la partie.', target: 3, metric: 'correct', reward: 600 }),
  Object.freeze({ id: 'hard_streak_2', level: 'hard', emoji: '🔗', label: 'Sans trembler', description: 'Enchaîne 2 bonnes réponses sans erreur.', target: 2, metric: 'bestStreak', reward: 700 }),
  Object.freeze({ id: 'expert_first_3', level: 'expert', emoji: '💎', label: 'Lecture parfaite', description: 'Trouve 3 morceaux dès le premier extrait.', target: 3, metric: 'firstTry', reward: 1100 }),
  Object.freeze({ id: 'expert_streak_4', level: 'expert', emoji: '👑', label: 'Inarrêtable', description: 'Enchaîne 4 bonnes réponses sans erreur.', target: 4, metric: 'bestStreak', reward: 1400 }),
]);

function hashIndex(value, length) {
  const digest = crypto.createHash('sha256').update(String(value)).digest();
  return length ? digest.readUInt32BE(0) % length : 0;
}

function assign(party, player) {
  if (player.secretMission) return player.secretMission;
  const levels = ['easy', 'hard', 'expert'];
  const level = levels[hashIndex(`${party.seed}:${player.profileId}:level`, levels.length)];
  const candidates = CATALOG.filter(item => item.level === level
    && item.target <= Math.max(1, Number(party.totalRounds) || 1));
  const fallback = CATALOG.filter(item => item.level === 'easy');
  const pool = candidates.length ? candidates : fallback;
  const selected = pool[hashIndex(`${party.seed}:${player.profileId}:mission`, pool.length)];
  player.secretMission = {
    ...selected, progress: 0, currentStreak: 0, completed: false, rewarded: false,
  };
  return player.secretMission;
}

function joinPlayer(party, player) { assign(party, player); }

function recordAnswer(party, player, { correct, attempt = 0 } = {}) {
  const mission = assign(party, player);
  if (correct) {
    mission.correct = (Number(mission.correct) || 0) + 1;
    if (Number(attempt) === 0) mission.firstTry = (Number(mission.firstTry) || 0) + 1;
    mission.currentStreak = (Number(mission.currentStreak) || 0) + 1;
    mission.bestStreak = Math.max(Number(mission.bestStreak) || 0, mission.currentStreak);
  } else {
    mission.currentStreak = 0;
  }
  mission.progress = Math.min(mission.target, Number(mission[mission.metric]) || 0);
  mission.completed = mission.progress >= mission.target;
  return mission;
}

function finish(party) {
  for (const player of party.players || []) {
    const mission = assign(party, player);
    if (mission.completed && !mission.rewarded) {
      player.score += mission.reward;
      mission.rewarded = true;
    }
  }
}

function publicMission(party, player, viewer, revealAll = false) {
  const mission = assign(party, player);
  if (!revealAll && (!viewer || viewer.profileId !== player.profileId)) return null;
  return {
    id: mission.id, level: mission.level, emoji: mission.emoji,
    label: mission.label, description: mission.description,
    target: mission.target, progress: mission.progress,
    completed: mission.completed, reward: mission.reward, rewarded: mission.rewarded,
  };
}

module.exports = { CATALOG, assign, finish, joinPlayer, publicMission, recordAnswer };
