const assert = require('assert');
const { commitFinishedParty, partyHistoryEntry } = require('../lib/party-results');

let passed = 0;
function ok(message) {
  passed++;
  console.log(`OK  ${message}`);
}

const party = {
  code: 'ABCDE',
  mode: 'royale',
  round: 7,
  status: 'finished',
  winnerProfileId: 'beta',
  statsCommitted: false,
  teams: [],
  players: [
    { profileId: 'alpha', nom: 'Alex', emoji: '🎧', score: 2400, teamId: null },
    { profileId: 'beta', nom: 'Sam', emoji: '⚡', score: 300, teamId: null },
  ],
};
const calls = { sessions: 0, history: [] };
const fakeStore = {
  recordPartySessions(players, winnerProfileId) {
    calls.sessions++;
    assert.strictEqual(players, party.players);
    assert.strictEqual(winnerProfileId, 'beta');
    return [{ id: 'beta', multiplayer: { sessions: 4, wins: 2 } }];
  },
  recordPartyHistory(entry) {
    calls.history.push(entry);
  },
};

assert.strictEqual(commitFinishedParty(party, fakeStore), true);
assert.strictEqual(party.statsCommitted, true);
assert.deepStrictEqual(party.players[1].globalStats, { sessions: 4, wins: 2 });
assert.strictEqual(calls.history[0].winner.nom, 'Sam');
assert.deepStrictEqual(calls.history[0].players.map(player => player.rank), [1, 2]);
ok('le résultat explicite prime sur le score et met à jour les statistiques');

assert.strictEqual(commitFinishedParty(party, fakeStore), false);
assert.strictEqual(calls.sessions, 1);
assert.strictEqual(calls.history.length, 1);
ok('une partie terminée ne peut être enregistrée qu’une fois');

const tied = partyHistoryEntry({
  code: 'FGHIJ',
  mode: 'classic',
  round: 3,
  players: [
    { profileId: 'one', nom: 'Joueur un', emoji: '1️⃣', score: 500 },
    { profileId: 'two', nom: 'Joueur deux', emoji: '2️⃣', score: 500 },
    { profileId: 'three', nom: 'Joueur trois', emoji: '3️⃣', score: 100 },
  ],
});
assert.deepStrictEqual(tied.players.map(player => player.rank), [1, 1, 3]);
ok('les égalités ordinaires conservent le même rang');

console.log(`\n${passed} tests de résultats multijoueurs réussis.`);
