const assert = require('assert');
const rounds = require('../lib/party-rounds');

let passed = 0;
function test(label, run) {
  return Promise.resolve().then(run).then(() => {
    passed++;
    console.log(`OK  ${label}`);
  });
}

function makeParty(overrides = {}) {
  return {
    hostToken: 'host-test',
    trackIds: ['track-a', 'track-b'],
    round: 0,
    totalRounds: 2,
    infinite: false,
    seed: 'TEST-SEED',
    settings: { answer: 'artiste', start: 'seed' },
    playback: null,
    currentTrackId: null,
    finalDuel: null,
    ...overrides,
  };
}

function dependencies(calls) {
  return {
    async loadTrack(trackId) {
      calls.loaded.push(trackId);
      return {
        track: {
          id: trackId,
          duration: 180,
          title: 'Titre test',
          originalTitle: 'Titre original',
          artist: 'Artiste test',
          genre: 'Test',
        },
        answer: { mode: 'titre', title: 'Titre test' },
      };
    },
    command(...args) {
      calls.commands.push(args);
    },
  };
}

async function main() {
  await test('une manche charge le morceau serveur et impose le type de réponse', async () => {
    const party = makeParty();
    const calls = { loaded: [], commands: [] };
    await rounds.startNextPartyRound(party, dependencies(calls));
    assert.deepStrictEqual(calls.loaded, ['track-a']);
    assert.strictEqual(calls.commands[0][2], 'start-round');
    assert.strictEqual(calls.commands[0][3].answer.mode, 'artiste');
    assert.ok(calls.commands[0][3].playback.offset >= 0);
  });

  await test('une partie finie refuse une manche ordinaire supplémentaire', async () => {
    const party = makeParty({ round: 2 });
    await assert.rejects(
      rounds.startNextPartyRound(party, dependencies({ loaded: [], commands: [] })),
      /Toutes les manches prévues/
    );
  });

  await test('un duel final continue au-delà du nombre de manches prévu', async () => {
    const party = makeParty({ round: 2, finalDuel: { active: true } });
    const calls = { loaded: [], commands: [] };
    await rounds.startNextPartyRound(party, dependencies(calls));
    assert.deepStrictEqual(calls.loaded, ['track-a']);
    assert.strictEqual(calls.commands[0][3].round, 3);
  });

  await test('la révélation ne transmet qu’une raison autorisée', async () => {
    const party = makeParty({
      currentTrackId: 'track-b',
      playback: { offset: 12 },
    });
    const calls = { loaded: [], commands: [] };
    await rounds.revealCurrentPartyRound(
      party,
      { reason: 'raison-inventée', autoNext: true },
      dependencies(calls)
    );
    const payload = calls.commands[0][3];
    assert.strictEqual(payload.reason, 'manual');
    assert.strictEqual(payload.autoNext, true);
    assert.strictEqual(payload.highlightOffset, 12);
  });

  await test('le départ déterministe reste stable pour une même seed', () => {
    const party = makeParty();
    const track = { id: 'track-a', duration: 200 };
    assert.strictEqual(rounds.roundOffset(party, track), rounds.roundOffset(party, track));
    assert.strictEqual(rounds.roundOffset(
      makeParty({ settings: { answer: 'titre', start: 'debut' } }),
      track
    ), 0);
  });

  console.log(`\n${passed} tests de manches multijoueurs réussis.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
