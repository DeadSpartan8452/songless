'use strict';

const assert = require('assert');
const teams = require('../lib/party-teams');

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`OK  ${name}`);
}

function player(profileId, nom) {
  return {
    profileId, nom, emoji: '🎧', score: 0, host: false,
    teamId: null, teamLockedByHost: false,
  };
}

function fixture(count = 3) {
  return {
    players: Array.from({ length: count }, (_, index) => (
      player(`p${index + 1}`, `Joueur ${index + 1}`)
    )),
    teams: [],
  };
}

test('un joueur crée une équipe et en devient capitaine', () => {
  const party = fixture();
  teams.playerAction(party, party.players[0], 'create-team', { name: 'Les Tests' });
  assert.strictEqual(party.teams.length, 1);
  assert.strictEqual(party.players[0].teamId, party.teams[0].id);
  assert.strictEqual(party.teams[0].captainProfileId, 'p1');
});

test('la limite de seize équipes est appliquée', () => {
  const party = fixture(16);
  party.players.forEach((member, index) => {
    teams.playerAction(party, member, 'create-team', { name: `Équipe ${index + 1}` });
  });
  assert.throws(
    () => teams.hostCommand(party, 'host-create-team', { name: 'En trop' }),
    /16 équipes/i
  );
});

test('une demande acceptée rejoint l’équipe et disparaît partout', () => {
  const party = fixture();
  teams.playerAction(party, party.players[0], 'create-team', { name: 'A' });
  teams.playerAction(party, party.players[2], 'create-team', { name: 'B' });
  const [first, second] = party.teams;
  teams.playerAction(party, party.players[1], 'request-join-team', { teamId: first.id });
  teams.playerAction(party, party.players[1], 'request-join-team', { teamId: second.id });
  teams.playerAction(party, party.players[0], 'accept-team-request', {
    teamId: first.id, profileId: 'p2',
  });
  assert.strictEqual(party.players[1].teamId, first.id);
  assert.deepStrictEqual(first.joinRequests, []);
  assert.deepStrictEqual(second.joinRequests, []);
});

test('un joueur ordinaire ne peut pas refuser une demande', () => {
  const party = fixture();
  teams.playerAction(party, party.players[0], 'create-team', { name: 'A' });
  const team = party.teams[0];
  teams.playerAction(party, party.players[1], 'request-join-team', { teamId: team.id });
  assert.throws(
    () => teams.playerAction(party, party.players[1], 'refuse-team-request', {
      teamId: team.id, profileId: 'p2',
    }),
    /capitaine/i
  );
});

test('un capitaine ne déplace ni exclut un joueur verrouillé par l’hôte', () => {
  const party = fixture();
  teams.hostCommand(party, 'host-create-team', { name: 'A' });
  teams.hostCommand(party, 'host-create-team', { name: 'B', captainProfileId: 'p1' });
  const [lockedTeam, captainTeam] = party.teams;
  teams.hostCommand(party, 'host-assign-player', {
    profileId: 'p2', teamId: lockedTeam.id, locked: true,
  });
  lockedTeam.joinRequests.push('p2');
  assert.throws(
    () => teams.playerAction(party, party.players[0], 'accept-team-request', {
      teamId: captainTeam.id, profileId: 'p2',
    }),
    /assigné par l.hôte/i
  );
  assert.throws(
    () => teams.playerAction(party, party.players[0], 'kick-team-member', {
      teamId: lockedTeam.id, profileId: 'p2',
    }),
    /capitaine|assigné par l.hôte/i
  );
});

test('le départ du capitaine promeut un membre restant', () => {
  const party = fixture();
  teams.playerAction(party, party.players[0], 'create-team', { name: 'A' });
  const team = party.teams[0];
  teams.playerAction(party, party.players[1], 'request-join-team', { teamId: team.id });
  teams.playerAction(party, party.players[0], 'accept-team-request', {
    teamId: team.id, profileId: 'p2',
  });
  teams.playerAction(party, party.players[0], 'leave-team');
  assert.strictEqual(team.captainProfileId, 'p2');
});

test('réassigner le seul membre dans la même équipe conserve l’équipe', () => {
  const party = fixture();
  teams.hostCommand(party, 'host-create-team', { name: 'A', captainProfileId: 'p1' });
  const teamId = party.teams[0].id;
  teams.hostCommand(party, 'host-assign-player', {
    profileId: 'p1', teamId, locked: false,
  });
  assert.strictEqual(party.teams[0].id, teamId);
  assert.strictEqual(party.players[0].teamId, teamId);
});

test('la répartition aléatoire conserve les assignations verrouillées', () => {
  const party = fixture(8);
  teams.hostCommand(party, 'host-create-team', { name: 'A' });
  teams.hostCommand(party, 'host-create-team', { name: 'B' });
  const lockedTeamId = party.teams[0].id;
  teams.hostCommand(party, 'host-assign-player', {
    profileId: 'p1', teamId: lockedTeamId, locked: true,
  });
  teams.hostCommand(party, 'host-randomize-teams', { numTeams: 3 });
  assert.strictEqual(party.players[0].teamId, lockedTeamId);
  assert.strictEqual(party.players[0].teamLockedByHost, true);
  assert.strictEqual(party.players.every(member => member.teamId), true);
});

test('l’état public ne contient pas les invitations internes', () => {
  const party = fixture();
  teams.playerAction(party, party.players[0], 'create-team', { name: 'A' });
  party.teams[0].invites.push('secret-interne');
  const state = teams.publicState(party);
  assert.strictEqual(JSON.stringify(state).includes('secret-interne'), false);
  assert.strictEqual(Object.hasOwn(state[0], 'invites'), false);
});

console.log(`\n${passed} tests équipes réussis.`);
