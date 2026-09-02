const assert = require('assert');
const access = require('../lib/party-access');

let passed = 0;
function ok(message) {
  passed++;
  console.log(`OK  ${message}`);
}

function makeParty() {
  return { hostToken: 'host-test', accessTokens: [], updatedAt: 0 };
}

const party = makeParty();
const issued = access.issueAccessToken(party, 'host-test', 'tv', 1);
assert.strictEqual(issued.role, 'tv');
assert.ok(issued.expiresAt - issued.createdAt >= 5 * 60 * 1000);
assert.strictEqual(access.accessRole(party, issued.accessToken), 'tv');
assert.ok(!JSON.stringify(party).includes(issued.accessToken));
assert.match(party.accessTokens[0].tokenHash, /^[a-f0-9]{64}$/);
ok('un jeton temporaire est borné et seul son condensat est conservé');

assert.throws(
  () => access.issueAccessToken(party, 'faux-hôte', 'tv'),
  /réservé à l’hôte/
);
assert.throws(
  () => access.issueAccessToken(party, 'host-test', 'bibliotheque'),
  /Rôle d’appairage inconnu/
);
ok('un faux hôte et un rôle inconnu sont refusés');

access.revokeAccessToken(party, 'host-test', issued.id);
assert.strictEqual(access.accessRole(party, issued.accessToken), null);
ok('un jeton révoqué perd immédiatement son accès');

const remote = access.issueAccessToken(party, 'host-test', 'remote_admin');
party.accessTokens[0].expiresAt = Date.now() - 1;
assert.strictEqual(access.accessRole(party, remote.accessToken), null);
assert.strictEqual(party.accessTokens.length, 0);
ok('un jeton expiré est refusé puis purgé');

console.log(`\n${passed} tests d’accès multijoueur réussis.`);
