'use strict';

const crypto = require('crypto');

const TEAM_PRESETS = [
  { id: 'team_red', name: 'Les Diables Rouges', color: '#ef4444', emoji: '🔴' },
  { id: 'team_blue', name: 'Les Faucons Bleus', color: '#3b82f6', emoji: '🔵' },
  { id: 'team_green', name: 'Les Vipères Vertes', color: '#10b981', emoji: '🟢' },
  { id: 'team_yellow', name: 'Les Éclairs Dorés', color: '#f59e0b', emoji: '🟡' },
  { id: 'team_purple', name: 'Les Ombres Violettes', color: '#8b5cf6', emoji: '🟣' },
  { id: 'team_orange', name: 'Les Tigres Orange', color: '#f97316', emoji: '🟠' },
  { id: 'team_pink', name: 'Les Flamants Roses', color: '#ec4899', emoji: '💖' },
  { id: 'team_cyan', name: 'Les Sirènes Cyan', color: '#06b6d4', emoji: '🩵' },
  { id: 'team_gold', name: 'L’Ordre d’Or', color: '#eab308', emoji: '🪙' },
  { id: 'team_silver', name: 'Les Loups d’Argent', color: '#94a3b8', emoji: '⚪' },
  { id: 'team_forest', name: 'Les Gardiens de la Forêt', color: '#15803d', emoji: '🌲' },
  { id: 'team_ocean', name: 'Les Abysses', color: '#0284c7', emoji: '🌊' },
  { id: 'team_magma', name: 'Le Volcan', color: '#dc2626', emoji: '🌋' },
  { id: 'team_galaxy', name: 'La Nébuleuse', color: '#6366f1', emoji: '🌌' },
  { id: 'team_lightning', name: 'Les Foudroyants', color: '#818cf8', emoji: '⚡' },
  { id: 'team_retro', name: 'Les Rétro 80s', color: '#d946ef', emoji: '🕹️' },
];
const COLOR_FALLBACK = '#8b5cf6';
const COLOR_PRESETS = new Set(TEAM_PRESETS.map(preset => preset.color.toLowerCase()));
const HOST_ACTIONS = new Set([
  'host-create-team', 'host-update-team', 'host-delete-team',
  'host-assign-player', 'host-randomize-teams',
]);
const PLAYER_ACTIONS = new Set([
  'create-team', 'request-join-team', 'accept-team-request',
  'refuse-team-request', 'kick-team-member', 'leave-team',
]);

function sanitizeColor(value, fallback = COLOR_FALLBACK) {
  const color = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(color) || COLOR_PRESETS.has(color)) return color;
  return fallback;
}

function ensureTeams(party) {
  if (!Array.isArray(party.teams)) party.teams = [];
  return party.teams;
}

function teamId() {
  return `team_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function presetFor(party, presetId) {
  return TEAM_PRESETS.find(preset => preset.id === presetId)
    || TEAM_PRESETS[ensureTeams(party).length % TEAM_PRESETS.length];
}

function makeTeam(party, data, captainProfileId = null, hostCreated = false) {
  const list = ensureTeams(party);
  if (list.length >= 16) throw new Error('Nombre maximal de 16 équipes atteint.');
  const preset = presetFor(party, data.presetId);
  return {
    id: teamId(),
    name: String(data.name || preset.name).slice(0, 30),
    color: sanitizeColor(data.color || preset.color),
    emoji: String(data.emoji || preset.emoji).slice(0, 4),
    captainProfileId: captainProfileId ? String(captainProfileId) : null,
    lockedByHost: Boolean(hostCreated && data.locked),
    joinRequests: [],
    invites: [],
  };
}

function reconcileCaptains(party) {
  for (const team of ensureTeams(party)) {
    const members = party.players.filter(player => player.teamId === team.id);
    if (!members.length) {
      team.captainProfileId = null;
    } else if (!team.captainProfileId || !members.some(member => (
      String(member.profileId) === String(team.captainProfileId)
    ))) {
      team.captainProfileId = members[0].profileId;
    }
  }
}

function removePlayerFromTeam(party, player, allowLocked = false) {
  if (player.teamLockedByHost && !allowLocked) {
    throw new Error('Ce joueur a été assigné par l’hôte et ne peut pas changer d’équipe.');
  }
  const oldTeamId = player.teamId;
  player.teamId = null;
  player.teamLockedByHost = false;
  if (!oldTeamId) return;
  const oldTeam = ensureTeams(party).find(team => team.id === oldTeamId);
  if (!oldTeam) return;
  const members = party.players.filter(candidate => candidate.teamId === oldTeam.id);
  if (!members.length) {
    party.teams = party.teams.filter(team => team.id !== oldTeam.id);
  } else if (oldTeam.captainProfileId === player.profileId) {
    oldTeam.captainProfileId = members[0].profileId;
  }
}

function assignPlayer(party, player, targetTeamId, lockedByHost) {
  const targetTeam = targetTeamId
    ? ensureTeams(party).find(team => team.id === String(targetTeamId)) : null;
  if (targetTeamId && !targetTeam) throw new Error('Équipe introuvable.');
  if (targetTeam && player.teamId === targetTeam.id) {
    player.teamLockedByHost = Boolean(lockedByHost);
    reconcileCaptains(party);
    return;
  }
  removePlayerFromTeam(party, player, true);
  player.teamId = targetTeam ? targetTeam.id : null;
  player.teamLockedByHost = Boolean(targetTeam && lockedByHost);
  reconcileCaptains(party);
}

function requireCaptainOrHost(team, actor, message) {
  if (team.captainProfileId !== actor.profileId && !actor.host) throw new Error(message);
}

function hostCommand(party, action, data = {}) {
  if (!HOST_ACTIONS.has(action)) return false;
  if (action === 'host-create-team') {
    const captainId = data.captainProfileId ? String(data.captainProfileId) : null;
    const captain = captainId
      ? party.players.find(player => String(player.profileId) === captainId) : null;
    if (captainId && !captain) throw new Error('Joueur introuvable.');
    const team = makeTeam(party, data, captainId, true);
    party.teams.push(team);
    if (captain) assignPlayer(party, captain, team.id, true);
  } else if (action === 'host-update-team') {
    const team = ensureTeams(party).find(candidate => candidate.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    if (data.name) team.name = String(data.name).slice(0, 30);
    if (data.color) team.color = sanitizeColor(data.color, team.color);
    if (data.emoji) team.emoji = String(data.emoji).slice(0, 4);
    if (data.captainProfileId !== undefined) {
      const captainId = data.captainProfileId ? String(data.captainProfileId) : null;
      const captain = captainId
        ? party.players.find(player => String(player.profileId) === captainId) : null;
      if (captainId && !captain) throw new Error('Joueur introuvable.');
      team.captainProfileId = captainId;
      if (captain) assignPlayer(party, captain, team.id, true);
    }
  } else if (action === 'host-delete-team') {
    const id = String(data.teamId || '');
    party.teams = ensureTeams(party).filter(team => team.id !== id);
    for (const player of party.players) {
      if (player.teamId === id) {
        player.teamId = null;
        player.teamLockedByHost = false;
      }
    }
  } else if (action === 'host-assign-player') {
    const player = party.players.find(candidate => (
      String(candidate.profileId) === String(data.profileId)
    ));
    if (!player) throw new Error('Joueur introuvable.');
    assignPlayer(party, player, data.teamId, Boolean(data.locked));
  } else if (action === 'host-randomize-teams') {
    if (!party.players.length) throw new Error('Aucun joueur dans la partie.');
    const count = party.players.length;
    const requested = Number(data.numTeams) || (party.teams && party.teams.length
      ? party.teams.length : count <= 4 ? 2 : count <= 8 ? 3 : 4);
    const teamCount = Math.min(16, Math.max(2, requested));
    const list = ensureTeams(party);
    while (list.length < teamCount && list.length < 16) {
      const preset = TEAM_PRESETS[list.length % TEAM_PRESETS.length];
      list.push(makeTeam(party, { ...preset, presetId: preset.id }, null, true));
    }
    const availableTeams = list.slice(0, teamCount);
    const eligible = party.players.filter(player => !player.teamLockedByHost);
    for (let index = eligible.length - 1; index > 0; index--) {
      const target = crypto.randomInt(index + 1);
      [eligible[index], eligible[target]] = [eligible[target], eligible[index]];
    }
    eligible.forEach((player, index) => {
      player.teamId = availableTeams[index % availableTeams.length].id;
    });
    reconcileCaptains(party);
  }
  return true;
}

function playerAction(party, actor, action, data = {}) {
  if (!PLAYER_ACTIONS.has(action)) return false;
  if (action === 'create-team') {
    if (actor.teamLockedByHost) {
      throw new Error('Tu as été assigné par l’hôte et ne peux pas changer d’équipe.');
    }
    removePlayerFromTeam(party, actor);
    const team = makeTeam(party, data, actor.profileId, false);
    party.teams.push(team);
    actor.teamId = team.id;
  } else if (action === 'request-join-team') {
    const team = ensureTeams(party).find(candidate => candidate.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    if (!team.joinRequests.includes(actor.profileId)) team.joinRequests.push(actor.profileId);
  } else if (action === 'accept-team-request') {
    const team = ensureTeams(party).find(candidate => candidate.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    requireCaptainOrHost(team, actor, 'Seul le capitaine de l’équipe peut accepter des joueurs.');
    const target = party.players.find(player => player.profileId === data.profileId);
    if (!target) throw new Error('Joueur introuvable.');
    if (target.teamLockedByHost && !actor.host) {
      throw new Error('Ce joueur a été assigné par l’hôte et ne peut pas changer d’équipe.');
    }
    assignPlayer(party, target, team.id, Boolean(actor.host && target.teamLockedByHost));
    for (const candidate of party.teams) {
      candidate.joinRequests = (candidate.joinRequests || [])
        .filter(id => id !== target.profileId);
    }
  } else if (action === 'refuse-team-request') {
    const team = ensureTeams(party).find(candidate => candidate.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    requireCaptainOrHost(team, actor, 'Seul le capitaine de l’équipe peut refuser des joueurs.');
    team.joinRequests = (team.joinRequests || []).filter(id => id !== data.profileId);
  } else if (action === 'kick-team-member') {
    const team = ensureTeams(party).find(candidate => candidate.id === data.teamId);
    if (!team) throw new Error('Équipe introuvable.');
    requireCaptainOrHost(team, actor, 'Seul le capitaine ou l’hôte peut exclure un membre.');
    const target = party.players.find(player => player.profileId === data.profileId);
    if (!target) throw new Error('Joueur introuvable.');
    if (target.teamLockedByHost && !actor.host) {
      throw new Error('Ce joueur a été assigné par l’hôte et ne peut être exclu par le capitaine.');
    }
    removePlayerFromTeam(party, target, Boolean(actor.host));
  } else if (action === 'leave-team') {
    removePlayerFromTeam(party, actor, false);
  }
  return true;
}

function publicState(party) {
  return ensureTeams(party).map(team => {
    const members = party.players.filter(player => player.teamId === team.id);
    const captain = party.players.find(player => player.profileId === team.captainProfileId);
    return {
      id: team.id,
      name: team.name,
      color: sanitizeColor(team.color),
      emoji: team.emoji,
      captainProfileId: team.captainProfileId,
      captainNom: captain ? captain.nom : 'Capitaine',
      lockedByHost: Boolean(team.lockedByHost),
      membersCount: members.length,
      members: members.map(member => ({
        profileId: member.profileId,
        nom: member.nom,
        emoji: member.emoji,
        score: member.score,
        host: member.host,
        locked: Boolean(member.teamLockedByHost),
      })),
      joinRequests: (team.joinRequests || []).map(profileId => {
        const player = party.players.find(candidate => candidate.profileId === profileId);
        return {
          profileId,
          nom: player ? player.nom : 'Joueur',
          emoji: player ? player.emoji : '🎧',
        };
      }),
      score: members.reduce((total, member) => total + (Number(member.score) || 0), 0),
    };
  }).sort((left, right) => right.score - left.score);
}

module.exports = {
  HOST_ACTIONS,
  PLAYER_ACTIONS,
  TEAM_PRESETS,
  hostCommand,
  playerAction,
  publicState,
  sanitizeColor,
};
