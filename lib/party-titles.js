'use strict';

function safeText(value, fallback = 'inconnu') {
  return String(value || fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || fallback;
}

function topEntry(map) {
  return Object.entries(map || {}).sort((a, b) => Number(b[1]) - Number(a[1])
    || a[0].localeCompare(b[0], 'fr'))[0] || ['', 0];
}

function increment(map, key) {
  const cleaned = safeText(key, 'Inconnu');
  map[cleaned] = (Number(map[cleaned]) || 0) + 1;
}

function decade(year) {
  const value = Number(year);
  return value >= 1900 && value <= 2200 ? String(Math.floor(value / 10) * 10) : '';
}

function stats(player) {
  if (!player.portraitStats || typeof player.portraitStats !== 'object') {
    player.portraitStats = {
      correctArtists: {}, missedArtists: {}, correctGenres: {}, correctDecades: {},
      firstTry: 0, lateWins: 0,
    };
  }
  return player.portraitStats;
}

function recordRound(party) {
  const track = party.revealedTrack || {};
  for (const player of party.players || []) {
    const value = stats(player);
    const attempts = Array.isArray(player.attempts) ? player.attempts.length : 0;
    if (player.correct || player.found) {
      if (track.artist) increment(value.correctArtists, track.artist);
      if (track.genre) increment(value.correctGenres, track.genre);
      const trackDecade = decade(track.year);
      if (trackDecade) increment(value.correctDecades, trackDecade);
      if (attempts <= 1) value.firstTry++;
      if (attempts >= 5) value.lateWins++;
    } else if (track.artist) {
      increment(value.missedArtists, track.artist);
    }
  }
}

const TEMPLATES = [
  { id: 'champion', priority: 100, title: 'Patron du blind test', when: c => c.rank === 1, evidence: c => `1er avec ${c.score} points.` },
  { id: 'second', priority: 55, title: 'À une marche du trône', when: c => c.rank === 2, evidence: c => `2e avec ${c.score} points.` },
  { id: 'third', priority: 50, title: 'Bronze, mais brillant', when: c => c.rank === 3, evidence: c => `3e avec ${c.score} points.` },
  { id: 'perfect', priority: 120, title: 'Copie sans rature', when: c => c.rounds >= 3 && c.correct === c.rounds, evidence: c => `${c.correct}/${c.rounds} réponses correctes.` },
  { id: 'precision', priority: 85, title: 'Métronome de précision', when: c => c.rounds >= 5 && c.accuracy >= .8, evidence: c => `${c.percent}% de réussite.` },
  { id: 'balanced', priority: 35, title: 'Pile dans le tempo', when: c => c.rounds >= 4 && c.accuracy >= .5 && c.accuracy < .8, evidence: c => `${c.percent}% de réussite.` },
  { id: 'vista', priority: 42, title: 'Shazam sous Windows Vista', when: c => c.rounds >= 4 && c.accuracy < .25, evidence: c => `${c.correct} bonne réponse sur ${c.rounds}.` },
  { id: 'lightning', priority: 105, title: 'Flash avant le refrain', when: c => c.lightning >= 3, evidence: c => `${c.lightning} réponses au premier palier.` },
  { id: 'first', priority: 92, title: 'Toujours le premier mot', when: c => c.firstCorrect >= 3, evidence: c => `${c.firstCorrect} premières bonnes réponses.` },
  { id: 'clutch', priority: 98, title: 'Un cœur, zéro peur', when: c => c.clutch >= 2, evidence: c => `${c.clutch} sauvetages au dernier palier.` },
  { id: 'machinegun', priority: 48, title: 'Mitraillette à propositions', when: c => c.rounds >= 3 && c.guesses >= c.rounds * 3, evidence: c => `${c.guesses} tentatives en ${c.rounds} manches.` },
  { id: 'score', priority: 72, title: 'Banquier des décibels', when: c => c.score >= Math.max(1000, c.averageScore * 1.5), evidence: c => `${c.score} points, moyenne ${Math.round(c.averageScore)}.` },
  { id: 'host', priority: 25, title: 'Régisseur qui joue aussi', when: c => c.player.host, evidence: () => 'A hébergé et joué la soirée.' },
  { id: 'marathon', priority: 88, title: 'Endurance en stéréo', when: c => c.rounds >= 20, evidence: c => `${c.rounds} manches disputées.` },
  { id: 'tie', priority: 68, title: 'Ex æquo, ex aequo', when: c => c.tied, evidence: c => `Score partagé à ${c.score} points.` },

  { id: 'classic_play', priority: 30, title: 'Puriste sans filtre', when: c => c.mode === 'classic', evidence: () => 'Partie jouée en mode Classique.' },
  { id: 'classic_win', priority: 75, title: 'Classique instantané', when: c => c.mode === 'classic' && c.rank === 1, evidence: () => 'Victoire en mode Classique.' },
  { id: 'buzzer_play', priority: 45, title: 'Doigt à ressort', when: c => c.mode === 'buzzer', evidence: () => 'Partie jouée au Buzzer.' },
  { id: 'buzzer_win', priority: 90, title: 'Buzzer d’acier', when: c => c.mode === 'buzzer' && c.rank === 1, evidence: () => 'Victoire en mode Buzzer.' },
  { id: 'royale_one_life', priority: 115, title: 'Un cœur, toujours debout', when: c => c.mode === 'royale' && c.rank === 1 && c.lives === 1, evidence: () => 'Victoire Royale avec un seul cœur.' },
  { id: 'royale_flawless', priority: 118, title: 'Couronne sans égratignure', when: c => c.mode === 'royale' && c.rank === 1 && c.lives >= 3, evidence: () => 'Victoire Royale avec trois cœurs.' },
  { id: 'duel_play', priority: 45, title: 'Tireur de corde certifié', when: c => c.mode === 'duel', evidence: () => 'Partie jouée en Duel.' },
  { id: 'duel_win', priority: 96, title: 'K.O. en clé de sol', when: c => c.mode === 'duel' && c.rank === 1, evidence: () => 'Victoire finale en Duel.' },
  { id: 'confidence_profit', priority: 112, title: 'Audace avec intérêts', when: c => c.mode === 'confidence' && c.audacity >= 2.5 && c.profitability > 0, evidence: c => `Audace ×${c.audacity.toFixed(2)}, rentabilité +${c.profitability}.` },
  { id: 'confidence_loss', priority: 108, title: 'Confiance injustifiée', when: c => c.mode === 'confidence' && c.audacity >= 2.5 && c.profitability < 0, evidence: c => `Audace ×${c.audacity.toFixed(2)}, rentabilité ${c.profitability}.` },
  { id: 'coop_contributor', priority: 102, title: 'Moteur du collectif', when: c => c.mode === 'cooperation' && c.coopLeader && c.contribution > 0, evidence: c => `${c.contribution} points apportés à l’équipe.` },
  { id: 'coop_win', priority: 93, title: 'Même tempo, même victoire', when: c => c.mode === 'cooperation' && c.party.cooperation && c.party.cooperation.result === 'won', evidence: c => `${c.party.cooperation.sharedPoints}/${c.party.cooperation.targetPoints} points collectifs.` },
  { id: 'intruder_eye', priority: 104, title: 'Détective des fréquences', when: c => c.mode === 'intruder' && c.rounds >= 3 && c.accuracy >= .75, evidence: c => `${c.correct}/${c.rounds} intrus identifiés.` },
  { id: 'intruder_self', priority: 62, title: 'L’intrus, c’était lui', when: c => c.mode === 'intruder' && c.rounds >= 3 && c.accuracy < .4, evidence: c => `${c.correct}/${c.rounds} intrus identifiés.` },
  { id: 'auction_win', priority: 94, title: 'Adjugé au bon tempo', when: c => c.mode === 'auction' && c.rank === 1, evidence: () => 'Victoire en mode Enchères.' },
  { id: 'auction_play', priority: 46, title: 'Commissaire des secondes', when: c => c.mode === 'auction', evidence: () => 'Partie jouée en mode Enchères.' },
  { id: 'joker_three', priority: 110, title: 'Main entièrement jouée', when: c => c.mode === 'joker' && c.jokerUses >= 3, evidence: c => `${c.jokerUses} jokers utilisés.` },
  { id: 'joker_win', priority: 91, title: 'Atout maître', when: c => c.mode === 'joker' && c.rank === 1, evidence: () => 'Victoire en mode Joker.' },
  { id: 'mission_done', priority: 116, title: 'Agent au rapport', when: c => c.mode === 'missions' && c.mission && c.mission.completed, evidence: c => `Mission « ${safeText(c.mission.label)} » accomplie.` },
  { id: 'mission_missed', priority: 52, title: 'Couverture presque parfaite', when: c => c.mode === 'missions' && c.mission && !c.mission.completed, evidence: c => `Mission « ${safeText(c.mission.label)} » non accomplie.` },

  { id: 'artist_friend', priority: 101, title: c => `Répondeur officiel de ${safeText(c.bestArtist[0])}`, when: c => c.bestArtist[1] >= 2, evidence: c => `${c.bestArtist[1]} bonnes réponses sur cet artiste.` },
  { id: 'artist_nemesis', priority: 103, title: c => `Ennemi juré de ${safeText(c.nemesis[0])}`, when: c => c.nemesis[1] >= 2, evidence: c => `${c.nemesis[1]} manches manquées sur cet artiste.` },
  { id: 'genre_friend', priority: 89, title: c => `Ambassadeur ${safeText(c.bestGenre[0])}`, when: c => c.bestGenre[1] >= 3, evidence: c => `${c.bestGenre[1]} bonnes réponses dans ce genre.` },
  { id: 'decade_friend', priority: 90, title: c => `Bloqué dans les années ${safeText(c.bestDecade[0])}`, when: c => c.bestDecade[1] >= 3, evidence: c => `${c.bestDecade[1]} bonnes réponses sur cette décennie.` },
  { id: 'artist_explorer', priority: 84, title: 'Tourneur de scènes', when: c => c.artistCount >= 5, evidence: c => `${c.artistCount} artistes reconnus.` },
  { id: 'genre_explorer', priority: 86, title: 'Passeport sans genre', when: c => c.genreCount >= 3, evidence: c => `${c.genreCount} genres reconnus.` },
  { id: 'decade_explorer', priority: 87, title: 'Machine à voyager dans le son', when: c => c.decadeCount >= 3, evidence: c => `${c.decadeCount} décennies reconnues.` },
  { id: 'vintage', priority: 82, title: 'Antenne sur le siècle dernier', when: c => Object.entries(c.portrait.correctDecades).some(([key, value]) => Number(key) <= 1980 && value >= 2), evidence: () => 'Au moins deux titres des années 1980 ou antérieures.' },
  { id: 'modern', priority: 82, title: 'Branché sur demain', when: c => Object.entries(c.portrait.correctDecades).some(([key, value]) => Number(key) >= 2020 && value >= 2), evidence: () => 'Au moins deux titres des années 2020.' },
  { id: 'artist_perfect', priority: 107, title: c => `${safeText(c.bestArtist[0])}, dossier maîtrisé`, when: c => c.bestArtist[1] >= 3 && !c.portrait.missedArtists[c.bestArtist[0]], evidence: c => `${c.bestArtist[1]} bonnes réponses et aucune erreur sur cet artiste.` },

  { id: 'team_champion', priority: 111, title: 'Pilier de l’équipe championne', when: c => c.team && c.teamChampion, evidence: c => `Membre de l’équipe ${safeText(c.team.name)}.` },
  { id: 'team_captain', priority: 88, title: 'Capitaine sur la bonne fréquence', when: c => c.team && c.team.captainProfileId === c.player.profileId, evidence: c => `Capitaine de ${safeText(c.team.name)}.` },
  { id: 'handicap_boost', priority: 64, title: 'Coup de pouce transformé', when: c => c.handicap > 1 && c.correct > 0, evidence: c => `Multiplicateur ×${c.handicap.toFixed(2)} et ${c.correct} bonne(s) réponse(s).` },
  { id: 'handicap_challenge', priority: 97, title: 'Défi relevé sans roulettes', when: c => c.handicap < 1 && c.correct > 0, evidence: c => `Multiplicateur ×${c.handicap.toFixed(2)} et ${c.correct} bonne(s) réponse(s).` },
  { id: 'joker_untouched', priority: 74, title: 'Joue sans carte cachée', when: c => c.mode === 'joker' && c.jokerUses === 0 && c.correct > 0, evidence: c => `${c.correct} bonne(s) réponse(s), aucun joker utilisé.` },
];

function context(party, player, rankByProfileId) {
  const rounds = Number(player.sessionRounds) || 0;
  const correct = Number(player.sessionCorrect) || 0;
  const scores = (party.players || []).map(item => Number(item.score) || 0);
  const portrait = stats(player);
  const team = (party.teams || []).find(item => item.id === player.teamId) || null;
  const teamScores = (party.teams || []).map(item => ({
    id: item.id,
    score: (party.players || []).filter(p => p.teamId === item.id)
      .reduce((sum, p) => sum + (Number(p.score) || 0), 0),
  }));
  const winningTeamScore = Math.max(0, ...teamScores.map(item => item.score));
  const confidence = player.confidenceStats || {};
  const answers = Number(confidence.answers) || 0;
  const audacity = answers ? (Number(confidence.totalStaked) || 0) / answers : 0;
  const contribution = Number(player.cooperationContribution) || 0;
  const maxContribution = Math.max(0, ...(party.players || []).map(item => (
    Number(item.cooperationContribution) || 0)));
  return {
    party, player, mode: party.mode, score: Number(player.score) || 0,
    rank: rankByProfileId.get(player.profileId) || 0,
    rounds, correct, accuracy: rounds ? correct / rounds : 0,
    percent: rounds ? Math.round(correct * 100 / rounds) : 0,
    averageScore: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
    tied: scores.filter(value => value === (Number(player.score) || 0)).length > 1,
    lives: Number(player.lives) || 0,
    lightning: Number(player.lightningWins) || 0,
    clutch: Number(player.clutchWins) || 0,
    firstCorrect: Number(player.firstCorrectCount) || 0,
    guesses: Number(player.totalGuesses) || 0,
    audacity, profitability: (Number(confidence.pointsWon) || 0) - (Number(confidence.pointsLost) || 0),
    contribution, coopLeader: contribution > 0 && contribution === maxContribution,
    jokerUses: Number(player.jokerUses) || 0,
    mission: player.secretMission || null,
    handicap: Number(player.smartHandicap && player.smartHandicap.multiplier) || 1,
    portrait,
    bestArtist: topEntry(portrait.correctArtists),
    nemesis: topEntry(portrait.missedArtists),
    bestGenre: topEntry(portrait.correctGenres),
    bestDecade: topEntry(portrait.correctDecades),
    artistCount: Object.keys(portrait.correctArtists).length,
    genreCount: Object.keys(portrait.correctGenres).length,
    decadeCount: Object.keys(portrait.correctDecades).length,
    team,
    teamChampion: Boolean(team && teamScores.find(item => item.id === team.id)
      && teamScores.find(item => item.id === team.id).score === winningTeamScore),
  };
}

function assign(party) {
  const sorted = [...(party.players || [])].sort((a, b) => (Number(b.score) || 0)
    - (Number(a.score) || 0) || a.profileId.localeCompare(b.profileId));
  const rankByProfileId = new Map(sorted.map(player => [
    player.profileId,
    1 + sorted.filter(other => (Number(other.score) || 0) > (Number(player.score) || 0)).length,
  ]));
  for (const player of party.players || []) {
    const value = context(party, player, rankByProfileId);
    player.portraitTitles = TEMPLATES.filter(template => {
      try { return template.when(value); } catch (_) { return false; }
    }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 3)
      .map(template => ({
        id: template.id,
        label: safeText(typeof template.title === 'function' ? template.title(value) : template.title),
        evidence: safeText(template.evidence(value)),
      }));
  }
  return party.players.map(player => ({
    profileId: player.profileId,
    titles: player.portraitTitles,
  }));
}

module.exports = { TEMPLATES, assign, context, decade, recordRound, safeText, stats, topEntry };
