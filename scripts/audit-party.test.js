'use strict';

const assert = require('assert');
const partyStore = require('../lib/party');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK  ${name}`);
  } catch (error) {
    console.error(`KO  ${name}`);
    throw error;
  }
}

function profile(id, nom) {
  return { id, nom, emoji: '🎧', multiplayer: {} };
}

function makeParty(mode = 'classic', settings = {}) {
  const created = partyStore.create({
    mode,
    totalRounds: 10,
    seed: 'audit',
    settings: {
      answer: 'titre',
      paliers: [0.2, 0.7, 2.5, 5, 9, 15],
      points: 1000,
      excerpt: 15,
      ...settings,
    },
  });
  const first = partyStore.join(created.party.code, profile('p1', 'Alex')).player;
  const second = partyStore.join(created.party.code, profile('p2', 'Sam')).player;
  return { ...created, first, second };
}

function startRound(ctx, round = 1) {
  partyStore.command(ctx.party, ctx.hostToken, 'start-round', {
    round,
    trackId: `track-${round}`,
    answer: {
      title: 'Bonne réponse',
      artist: 'Artiste test',
      year: 2000,
      mode: 'titre',
    },
  });
  ctx.party.roundStartedAt = Date.now() - 10;
  ctx.party.playback.startedAt = Date.now() - 10;
}

test('un mode inconnu revient au mode classique', () => {
  const ctx = makeParty('mode-inconnu');
  assert.strictEqual(ctx.party.mode, 'classic');
});

test('une commande hôte refuse un faux jeton', () => {
  const ctx = makeParty();
  assert.throws(
    () => partyStore.command(ctx.party, 'faux-jeton', 'lobby'),
    /réservée à l.hôte/i
  );
});

test('les jetons TV et télécommande sont distincts du jeton hôte', () => {
  const ctx = makeParty();
  const tv = partyStore.issueAccessToken(ctx.party, ctx.hostToken, 'tv', 30 * 60 * 1000);
  const remote = partyStore.issueAccessToken(
    ctx.party,
    ctx.hostToken,
    'remote_admin',
    30 * 60 * 1000
  );
  assert.notStrictEqual(tv.accessToken, ctx.hostToken);
  assert.notStrictEqual(remote.accessToken, ctx.hostToken);
  assert.notStrictEqual(tv.accessToken, remote.accessToken);
  assert.strictEqual(partyStore.accessRole(ctx.party, tv.accessToken), 'tv');
  assert.strictEqual(partyStore.accessRole(ctx.party, remote.accessToken), 'remote_admin');
});

test('un jeton d’appairage révoqué cesse immédiatement de fonctionner', () => {
  const ctx = makeParty();
  const issued = partyStore.issueAccessToken(ctx.party, ctx.hostToken, 'tv');
  partyStore.revokeAccessToken(ctx.party, ctx.hostToken, issued.id);
  assert.strictEqual(partyStore.accessRole(ctx.party, issued.accessToken), null);
});

test('la TV suit la manche sans recevoir l’identifiant décodable du morceau', () => {
  const ctx = makeParty();
  const issued = partyStore.issueAccessToken(ctx.party, ctx.hostToken, 'tv');
  startRound(ctx);
  const state = partyStore.publicState(ctx.party, null, null, issued.accessToken);
  assert.strictEqual(state.viewerRole, 'tv');
  assert.strictEqual(state.round, 1);
  assert.strictEqual(state.currentTrackId, null);
  assert.strictEqual(state.canControl, false);
  assert.strictEqual(Object.hasOwn(state, 'hostToken'), false);
  assert.strictEqual(Object.hasOwn(state, 'inviteToken'), false);
  assert.strictEqual(JSON.stringify(state).includes('Bonne réponse'), false);
  assert.strictEqual(JSON.stringify(state).includes('track-1'), false);
});

test('l’état public ne divulgue aucun secret de salon', () => {
  const ctx = makeParty();
  const state = partyStore.publicState(ctx.party, ctx.first.token, null);
  assert.strictEqual(Object.hasOwn(state, 'hostToken'), false);
  assert.strictEqual(Object.hasOwn(state, 'inviteToken'), false);
  assert.strictEqual(state.currentTrackId, null);
});

test('les tentatives adverses restent secrètes pendant la manche', () => {
  const ctx = makeParty();
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
    answer: 'Tentative ultra secrète',
  });
  const state = partyStore.publicState(ctx.party, ctx.second.token, null);
  const opponent = state.players.find(player => player.profileId === 'p1');
  const serialized = JSON.stringify(opponent.attempts);
  assert.strictEqual(serialized.includes('Tentative ultra secrète'), false);
});

test('le joueur voit encore ses propres tentatives', () => {
  const ctx = makeParty();
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
    answer: 'Ma tentative',
  });
  const state = partyStore.publicState(ctx.party, ctx.first.token, null);
  const self = state.players.find(player => player.profileId === 'p1');
  assert.strictEqual(JSON.stringify(self.attempts).includes('Ma tentative'), true);
});

test('le mode classique permet de passer un palier', () => {
  const ctx = makeParty('classic');
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'skip');
  assert.strictEqual(ctx.first.currentAttempt, 1);
});

test('le buzzer impose de buzzer avant de répondre', () => {
  const ctx = makeParty('buzzer');
  startRound(ctx);
  assert.throws(
    () => partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
      answer: 'Bonne réponse',
    }),
    /pas à toi/i
  );
  partyStore.playerAction(ctx.party, ctx.first.token, 'buzz');
  partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
    answer: 'Bonne réponse',
  });
  assert.strictEqual(ctx.party.buzzerSolvedByProfileId, 'p1');
});

test('le duel déplace la corde vers le meilleur joueur', () => {
  const ctx = makeParty('duel');
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
    answer: 'Bonne réponse',
  });
  partyStore.command(ctx.party, ctx.hostToken, 'reveal', {
    reason: 'manual',
  });
  assert.strictEqual(ctx.party.duelScore, -25);
});

test('un survivant perd une seule vie par manche ratée', () => {
  const ctx = makeParty('royale');
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
    answer: 'Bonne réponse',
  });
  partyStore.command(ctx.party, ctx.hostToken, 'reveal', { reason: 'manual' });
  assert.strictEqual(ctx.first.lives, 3);
  assert.strictEqual(ctx.second.lives, 2);
});

test('un joueur éliminé ne peut plus répondre', () => {
  const ctx = makeParty('royale');
  for (let round = 1; round <= 3; round++) {
    startRound(ctx, round);
    partyStore.playerAction(ctx.party, ctx.first.token, 'answer', {
      answer: 'Bonne réponse',
    });
    partyStore.command(ctx.party, ctx.hostToken, 'reveal', { reason: 'manual' });
  }
  assert.strictEqual(ctx.second.isGhost, true);
  startRound(ctx, 4);
  assert.throws(
    () => partyStore.playerAction(ctx.party, ctx.second.token, 'answer', {
      answer: 'Bonne réponse',
    }),
    /éliminé|spectateur|fantôme/i
  );
});

test('une couleur d’équipe invalide est neutralisée', () => {
  const ctx = makeParty();
  partyStore.command(ctx.party, ctx.hostToken, 'host-create-team', {
    name: 'Équipe test',
    color: 'red; background:url(x)',
  });
  assert.match(ctx.party.teams[0].color, /^#[0-9a-f]{6}$/i);
  assert.strictEqual(ctx.party.teams[0].color.includes('url'), false);
});

test('une actualisation retrouve le même joueur avec le même jeton', () => {
  const ctx = makeParty();
  ctx.first.score = 420;
  const rejoined = partyStore.join(
    ctx.party.code,
    profile('p1', 'Alex actualisé')
  ).player;
  assert.strictEqual(rejoined, ctx.first);
  assert.strictEqual(rejoined.token, ctx.first.token);
  assert.strictEqual(rejoined.score, 420);
  assert.strictEqual(rejoined.nom, 'Alex actualisé');
  assert.strictEqual(rejoined.connected, true);
});

test('un abandon retire immédiatement le joueur des votes actifs', () => {
  const ctx = makeParty();
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'vote-skip');
  assert.deepStrictEqual(ctx.party.skipVotes, ['p1']);
  partyStore.playerAction(ctx.party, ctx.first.token, 'leave');
  assert.strictEqual(ctx.first.connected, false);
  assert.deepStrictEqual(ctx.party.skipVotes, []);
  assert.strictEqual(
    partyStore.publicState(ctx.party, ctx.second.token, null).votes.threshold,
    1
  );
});

test('un abandon libère le buzzer et une reconnexion réactive le joueur', () => {
  const ctx = makeParty('buzzer');
  startRound(ctx);
  partyStore.playerAction(ctx.party, ctx.first.token, 'buzz');
  assert.strictEqual(ctx.party.activeBuzzerProfileId, 'p1');
  partyStore.playerAction(ctx.party, ctx.first.token, 'leave');
  assert.strictEqual(ctx.party.activeBuzzerProfileId, null);
  assert.strictEqual(ctx.party.buzzerDeadline, null);
  assert.strictEqual(ctx.party.playback.pausedAt, null);
  assert.throws(
    () => partyStore.playerAction(ctx.party, ctx.first.token, 'buzz'),
    /quitté/i
  );
  const rejoined = partyStore.join(ctx.party.code, profile('p1', 'Alex')).player;
  assert.strictEqual(rejoined.token, ctx.first.token);
  partyStore.playerAction(ctx.party, rejoined.token, 'buzz');
  assert.strictEqual(ctx.party.activeBuzzerProfileId, 'p1');
});

test('un jeton d’appairage expiré est refusé et purgé', () => {
  const ctx = makeParty();
  const issued = partyStore.issueAccessToken(ctx.party, ctx.hostToken, 'tv');
  ctx.party.accessTokens[0].expiresAt = Date.now() - 1;
  assert.strictEqual(partyStore.accessRole(ctx.party, issued.accessToken), null);
  assert.strictEqual(ctx.party.accessTokens.length, 0);
});

test('la révélation Royale ne peut pas être appliquée deux fois', () => {
  const ctx = makeParty('royale');
  startRound(ctx);
  partyStore.command(ctx.party, ctx.hostToken, 'reveal', { reason: 'manual' });
  assert.strictEqual(ctx.first.lives, 2);
  assert.throws(
    () => partyStore.command(ctx.party, ctx.hostToken, 'reveal', {
      reason: 'manual',
    }),
    /aucune manche/i
  );
  assert.strictEqual(ctx.first.lives, 2);
});

test('une égalité en duel ne déplace pas la corde', () => {
  const ctx = makeParty('duel');
  startRound(ctx);
  partyStore.command(ctx.party, ctx.hostToken, 'reveal', { reason: 'manual' });
  assert.strictEqual(ctx.party.duelScore, 0);
});

test('la fin de partie efface la manche et bloque les nouvelles actions', () => {
  const ctx = makeParty();
  startRound(ctx);
  partyStore.command(ctx.party, ctx.hostToken, 'finish');
  assert.strictEqual(ctx.party.status, 'finished');
  assert.strictEqual(ctx.party.currentTrackId, null);
  assert.strictEqual(ctx.party.answerSpec, null);
  assert.strictEqual(ctx.party.playback, null);
  assert.throws(
    () => partyStore.playerAction(ctx.party, ctx.first.token, 'reaction', {
      emoji: '🔥',
    }),
    /terminée/i
  );
  assert.throws(
    () => partyStore.command(ctx.party, ctx.hostToken, 'start-round', {}),
    /terminée/i
  );
  assert.throws(
    () => partyStore.join(ctx.party.code, profile('p3', 'Nouveau')),
    /terminée/i
  );
});

test('seul le capitaine peut accepter une demande d’équipe', () => {
  const ctx = makeParty();
  partyStore.playerAction(ctx.party, ctx.first.token, 'create-team', {
    name: 'Les Tests',
  });
  const team = ctx.party.teams[0];
  partyStore.playerAction(ctx.party, ctx.second.token, 'request-join-team', {
    teamId: team.id,
  });
  assert.throws(
    () => partyStore.playerAction(ctx.party, ctx.second.token,
      'accept-team-request', { teamId: team.id, profileId: 'p2' }),
    /capitaine/i
  );
  partyStore.playerAction(ctx.party, ctx.first.token,
    'accept-team-request', { teamId: team.id, profileId: 'p2' });
  assert.strictEqual(ctx.second.teamId, team.id);
  assert.deepStrictEqual(team.joinRequests, []);
});

test('une assignation hôte verrouillée résiste au départ volontaire', () => {
  const ctx = makeParty();
  partyStore.command(ctx.party, ctx.hostToken, 'host-create-team', {
    name: 'Équipe verrouillée',
  });
  const teamId = ctx.party.teams[0].id;
  partyStore.command(ctx.party, ctx.hostToken, 'host-assign-player', {
    profileId: 'p2',
    teamId,
    locked: true,
  });
  assert.throws(
    () => partyStore.playerAction(ctx.party, ctx.second.token, 'leave-team'),
    /assigné par l.hôte/i
  );
  assert.strictEqual(ctx.second.teamId, teamId);
});

test('l’hôte ne peut pas assigner un joueur à une équipe inexistante', () => {
  const ctx = makeParty();
  assert.throws(
    () => partyStore.command(ctx.party, ctx.hostToken,
      'host-assign-player', { profileId: 'p2', teamId: 'absente' }),
    /équipe introuvable/i
  );
  assert.strictEqual(ctx.second.teamId, null);
});

test('deux équipes à égalité conservent exactement le même score', () => {
  const ctx = makeParty();
  partyStore.command(ctx.party, ctx.hostToken, 'host-create-team', {
    name: 'Équipe A',
  });
  partyStore.command(ctx.party, ctx.hostToken, 'host-create-team', {
    name: 'Équipe B',
  });
  partyStore.command(ctx.party, ctx.hostToken, 'host-assign-player', {
    profileId: 'p1', teamId: ctx.party.teams[0].id,
  });
  partyStore.command(ctx.party, ctx.hostToken, 'host-assign-player', {
    profileId: 'p2', teamId: ctx.party.teams[1].id,
  });
  ctx.first.score = 500;
  ctx.second.score = 500;
  const state = partyStore.publicState(ctx.party, ctx.first.token, null);
  assert.deepStrictEqual(state.teams.map(team => team.score), [500, 500]);
});

console.log(`\n${passed} tests réussis.`);
