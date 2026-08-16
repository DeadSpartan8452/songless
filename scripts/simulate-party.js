'use strict';

const partyStore = require('../lib/party');

function runSimulation() {
  console.log('🎮 --- SIMULATION D’UNE PARTIE SONGLESS À 6 JOUEURS ---\n');

  // 1. Création de la partie
  const { party, hostToken } = partyStore.create({
    mode: 'classic',
    totalRounds: 3,
    settings: {
      difficulty: 'normal',
      victory: 'all_steps',
      points: 1000,
    },
  });

  console.log(`✅ Salon créé avec le code [${party.code}] (Mode : Réponses simultanées, 3 manches)\n`);

  // 2. Connexion des 6 joueurs
  const playerProfiles = [
    { id: 'p_manael', nom: 'Manaël', emoji: '🎧' },
    { id: 'p_sarah', nom: 'Sarah', emoji: '⚡' },
    { id: 'p_lucas', nom: 'Lucas', emoji: '🚀' },
    { id: 'p_chloe', nom: 'Chloé', emoji: '🌸' },
    { id: 'p_thomas', nom: 'Thomas', emoji: '🛡️' },
    { id: 'p_alexandre', nom: 'Alexandre', emoji: '🎰' },
  ];

  const players = playerProfiles.map(prof => partyStore.join(party.code, prof).player);
  players[0].host = true;

  console.log('👥 6 Joueurs ont rejoint le salon :');
  players.forEach(p => console.log(`   - ${p.emoji} ${p.nom} ${p.host ? '(Hôte)' : ''}`));
  console.log('\n------------------------------------------------------------\n');

  // Morceaux simulés
  const tracks = [
    { id: 't1', title: 'Bohemian Rhapsody', artist: 'Queen', year: 1975 },
    { id: 't2', title: 'Get Lucky', artist: 'Daft Punk', year: 2013 },
    { id: 't3', title: 'Billie Jean', artist: 'Michael Jackson', year: 1982 },
  ];

  // Manches
  for (let r = 0; r < 3; r++) {
    const track = tracks[r];
    console.log(`🎵 Manche ${r + 1}/3 : "${track.artist} - ${track.title}" (${track.year})`);

    partyStore.command(party, hostToken, 'start-round', {
      round: r + 1,
      trackId: track.id,
      answer: { title: track.title, artist: track.artist, year: track.year, mode: 'titre' },
    });
    party.playback.startedAt = Date.now() - 100;
    party.roundStartedAt = party.playback.startedAt;

    // Manche 1
    if (r === 0) {
      // Sarah trouve direct au 1er palier (0.2s)
      partyStore.playerAction(party, players[1].token, 'answer', { answer: track.title });
      // Lucas trouve au 2e palier
      partyStore.playerAction(party, players[2].token, 'skip');
      partyStore.playerAction(party, players[2].token, 'answer', { answer: track.title });
      // Manaël trouve au 2e palier
      partyStore.playerAction(party, players[0].token, 'skip');
      partyStore.playerAction(party, players[0].token, 'answer', { answer: track.title });
      // Chloé trouve au 3e palier (2.5s)
      partyStore.playerAction(party, players[3].token, 'skip');
      partyStore.playerAction(party, players[3].token, 'skip');
      partyStore.playerAction(party, players[3].token, 'answer', { answer: track.title });
      // Alexandre tente des mauvaises réponses puis trouve au 4e palier
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Mauvais titre 1' });
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Mauvais titre 2' });
      partyStore.playerAction(party, players[5].token, 'skip');
      partyStore.playerAction(party, players[5].token, 'answer', { answer: track.title });
      // Thomas passe jusqu'au dernier extrait (6e palier) et trouve !
      partyStore.playerAction(party, players[4].token, 'skip');
      partyStore.playerAction(party, players[4].token, 'skip');
      partyStore.playerAction(party, players[4].token, 'skip');
      partyStore.playerAction(party, players[4].token, 'skip');
      partyStore.playerAction(party, players[4].token, 'skip');
      partyStore.playerAction(party, players[4].token, 'answer', { answer: track.title });
    } else if (r === 1) {
      // Manche 2
      // Lucas est le plus rapide au palier 1
      partyStore.playerAction(party, players[2].token, 'answer', { answer: track.title });
      // Sarah trouve au palier 1 aussi
      partyStore.playerAction(party, players[1].token, 'answer', { answer: track.title });
      // Manaël trouve au palier 2
      partyStore.playerAction(party, players[0].token, 'skip');
      partyStore.playerAction(party, players[0].token, 'answer', { answer: track.title });
      // Chloé trouve au palier 3
      partyStore.playerAction(party, players[3].token, 'skip');
      partyStore.playerAction(party, players[3].token, 'skip');
      partyStore.playerAction(party, players[3].token, 'answer', { answer: track.title });
      // Alexandre mitraille 3 mauvaises réponses et trouve au 4e
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Mauvais 1' });
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Mauvais 2' });
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Mauvais 3' });
      partyStore.playerAction(party, players[5].token, 'answer', { answer: track.title });
      // Thomas trouve encore au 6e palier
      for (let s = 0; s < 5; s++) partyStore.playerAction(party, players[4].token, 'skip');
      partyStore.playerAction(party, players[4].token, 'answer', { answer: track.title });
    } else {
      // Manche 3
      // Sarah trouve direct à 0.2s
      partyStore.playerAction(party, players[1].token, 'answer', { answer: track.title });
      // Manaël trouve direct à 0.2s
      partyStore.playerAction(party, players[0].token, 'answer', { answer: track.title });
      // Lucas trouve au 2e palier
      partyStore.playerAction(party, players[2].token, 'skip');
      partyStore.playerAction(party, players[2].token, 'answer', { answer: track.title });
      // Chloé trouve au 2e palier
      partyStore.playerAction(party, players[3].token, 'skip');
      partyStore.playerAction(party, players[3].token, 'answer', { answer: track.title });
      // Alexandre tente 2 mauvaises réponses et trouve au 3e
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Faux 1' });
      partyStore.playerAction(party, players[5].token, 'answer', { answer: 'Faux 2' });
      partyStore.playerAction(party, players[5].token, 'answer', { answer: track.title });
      // Thomas échoue au 6e
      for (let s = 0; s < 6; s++) partyStore.playerAction(party, players[4].token, 'skip');
    }

    console.log(`   -> Manche ${r + 1} terminée ! Tous les joueurs ont fini leurs essais.`);
  }

  // 3. Clôture de la partie
  partyStore.command(party, hostToken, 'finish');
  console.log('\n🏁 --- PARTIE TERMINÉE ! GÉNÉRATION DU PODIUM ET LEADERBOARD ---\n');

  const finalState = partyStore.publicState(party, null, hostToken);
  const sorted = [...finalState.players].sort((a, b) => b.score - a.score);

  console.log('🏆 PODIUM FINAL :');
  console.log(`   🥇 1ère Place : ${sorted[0].emoji} ${sorted[0].nom} (${sorted[0].score} pts)`);
  console.log(`   🥈 2ème Place : ${sorted[1].emoji} ${sorted[1].nom} (${sorted[1].score} pts)`);
  console.log(`   🥉 3ème Place : ${sorted[2].emoji} ${sorted[2].nom} (${sorted[2].score} pts)\n`);

  console.log('🎖️ DISTINCTIONS & BADGES :');
  const lightningWinner = [...finalState.players].sort((a, b) => b.accolades.lightningWins - a.accolades.lightningWins)[0];
  const clutchWinner = [...finalState.players].sort((a, b) => b.accolades.clutchWins - a.accolades.clutchWins)[0];
  const guessWinner = [...finalState.players].sort((a, b) => b.accolades.totalGuesses - a.accolades.totalGuesses)[0];
  const firstGuesser = [...finalState.players].sort((a, b) => b.accolades.firstCorrectCount - a.accolades.firstCorrectCount)[0];

  console.log(`   ⚡ L'Éclair       : ${lightningWinner.emoji} ${lightningWinner.nom} (${lightningWinner.accolades.lightningWins}x trouvé à 0,2s)`);
  console.log(`   🚀 Le Rapide      : ${firstGuesser.emoji} ${firstGuesser.nom} (${firstGuesser.accolades.firstCorrectCount}x premier à trouver)`);
  console.log(`   🛡️ Le Survivant   : ${clutchWinner.emoji} ${clutchWinner.nom} (${clutchWinner.accolades.clutchWins}x sauvetage au 6e extrait)`);
  console.log(`   🎰 Le Mitrailleur : ${guessWinner.emoji} ${guessWinner.nom} (${guessWinner.accolades.totalGuesses} tentatives envoyées)\n`);

  console.log('📊 CLASSEMENT COMPLET (LEADERBOARD) :');
  sorted.forEach((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : ` ${idx + 1}.`;
    const correct = p.session.correct;
    const rounds = p.session.rounds;
    const pct = Math.round((correct / rounds) * 100);
    console.log(`   ${medal} ${p.emoji} ${p.nom.padEnd(12)} : ${String(p.score).padStart(4)} pts  |  Réussite : ${correct}/${rounds} (${pct}%)`);
  });

  console.log('\n============================================================\n');
}

runSimulation();
