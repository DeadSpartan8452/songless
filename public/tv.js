'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('party') || '').toUpperCase();
  const accessToken = String(params.get('access') || '');
  const byId = id => document.getElementById(id);
  let stopped = false;

  function setText(id, value) {
    byId(id).textContent = String(value == null ? '' : value);
  }

  function renderPlayers(players) {
    const sorted = [...(players || [])].sort((a, b) => Number(b.score) - Number(a.score));
    const list = byId('players');
    list.replaceChildren(...sorted.slice(0, 5).map((player, index) => {
      const item = document.createElement('li');
      const rank = document.createElement('span');
      const name = document.createElement('span');
      const points = document.createElement('span');
      rank.className = 'rank';
      name.className = 'name';
      points.className = 'points';
      rank.textContent = String(index + 1).padStart(2, '0');
      name.textContent = `${player.emoji || '🎧'} ${player.nom || 'Joueur'}`;
      const stake = player.confidence && player.confidence.preview;
      const coop = player.cooperation;
      points.textContent = `${Number(player.score) || 0} PT${stake ? ` · ×${stake.multiplier}` : ''}${coop ? ` · +${Number(coop.contribution) || 0} ÉQUIPE` : ''}`;
      item.append(rank, name, points);
      return item;
    }));
    setText('player-count', `${sorted.length} JOUEUR${sorted.length > 1 ? 'S' : ''}`);
  }

  function renderIntruder(challenge, revealed) {
    const grid = byId('intruder-options');
    grid.replaceChildren();
    if (!challenge || !Array.isArray(challenge.options)) return;
    for (const [index, option] of challenge.options.entries()) {
      const card = document.createElement('article');
      card.className = `tv-intruder-option${revealed && option.id === challenge.answerId ? ' correct' : ''}`;
      const number = document.createElement('span');
      const title = document.createElement('strong');
      const meta = document.createElement('small');
      number.className = 'tv-intruder-number';
      number.textContent = `0${index + 1}`;
      title.textContent = option.title || 'Sans titre';
      meta.textContent = [option.artist, option.year, option.genre, option.theme].filter(Boolean).join(' · ');
      card.append(number, title, meta);
      grid.append(card);
    }
  }

  function render(state) {
    const finalDuel = state.finalDuel;
    const finalists = finalDuel ? (finalDuel.contenders || []).map(entry => ({
      ...entry,
      player: (state.players || []).find(player => player.profileId === entry.profileId),
    })) : [];
    const finalNames = finalists.map(item => item.player ? item.player.nom : 'Finaliste');
    const finalScore = finalists.map(item => Number(item.wins) || 0).join(' — ');
    setText('party-code', state.code);
    setText('round-label', finalDuel && finalDuel.active
      ? 'DUEL FINAL'
      : state.status === 'lobby'
      ? 'SALON OUVERT'
      : state.status === 'finished'
        ? 'SOIRÉE TERMINÉE'
        : `MANCHE ${state.round}${state.infinite ? '' : ` / ${state.totalRounds}`}`);
    const hero = byId('hero');
    hero.className = `hero ${state.status}${state.mode === 'intruder' ? ' intruder' : ''}`;
    renderIntruder(state.mode === 'intruder' ? state.intruderChallenge : null,
      state.status !== 'round');
    if (state.status === 'round') {
      setText('eyebrow', finalDuel && finalDuel.active ? '⚔️ DUEL FINAL' : 'À VOUS DE JOUER');
      setText('hero-title', finalDuel && finalDuel.active
        ? finalNames.join(' contre ')
        : state.mode === 'buzzer' ? 'Buzzez maintenant.'
          : state.mode === 'confidence' ? 'À quel point êtes-vous sûrs ?'
            : state.mode === 'cooperation' ? 'Une équipe. Un objectif.'
              : state.mode === 'intruder' ? 'Quel est l’intrus ?'
              : 'Qui reconnaît ce morceau ?');
      const coop = state.cooperation;
      setText('hero-subtitle', finalDuel && finalDuel.active
        ? `${finalScore} · premier à ${finalDuel.targetWins}. Une égalité ne rapporte rien.`
        : state.mode === 'intruder' && state.intruderChallenge
          ? `${{ easy: 'Facile', medium: 'Intermédiaire', hard: 'Difficile' }[state.intruderChallenge.difficulty] || 'Progressif'} · observez les quatre propositions, sans donner la réponse.`
        : coop
          ? `${Number(coop.sharedPoints) || 0} / ${Number(coop.targetPoints) || 0} points · série ${Number(coop.streak) || 0}/${Number(coop.targetStreak) || 0} · ${'♥'.repeat(Number(coop.lives) || 0)}${'♡'.repeat(Math.max(0, 3 - (Number(coop.lives) || 0)))}`
        : 'Titre, artiste ou année : la régie attend vos réponses.');
    } else if (state.status === 'reveal' && state.mode === 'intruder' && state.intruderChallenge) {
      setText('eyebrow', 'INTRUS RÉVÉLÉ');
      const answer = state.intruderChallenge.options.find(option => (
        option.id === state.intruderChallenge.answerId));
      setText('hero-title', answer ? answer.title : 'Intrus trouvé');
      setText('hero-subtitle', state.intruderChallenge.explanation || 'Le verdict est dévoilé.');
    } else if (state.status === 'reveal' && state.revealedTrack) {
      setText('eyebrow', finalDuel && finalDuel.roundResult === 'transition' ? '⚔️ DUEL FINAL' : 'RÉPONSE');
      setText('hero-title', finalDuel && finalDuel.roundResult === 'transition'
        ? finalNames.join(' contre ')
        : state.revealedTrack.title || 'Morceau révélé');
      setText('hero-subtitle', finalDuel
        ? `${finalScore} · premier à ${finalDuel.targetWins}.`
        : state.revealedTrack.artist || 'Artiste inconnu');
    } else if (state.status === 'finished') {
      const winner = (state.players || []).find(player => player.profileId === state.winnerProfileId)
        || [...(state.players || [])].sort((a, b) => Number(b.score) - Number(a.score))[0];
      const collective = state.mode === 'cooperation' && state.cooperation;
      setText('eyebrow', collective ? 'VERDICT COLLECTIF' : 'VERDICT FINAL');
      setText('hero-title', collective
        ? collective.result === 'won' ? 'OBJECTIF ATTEINT.' : 'DÉFI MANQUÉ.'
        : winner ? `${winner.emoji || '🏆'} ${winner.nom}` : 'Fin de partie');
      const stats = winner && winner.confidence && winner.confidence.stats;
      setText('hero-subtitle', collective
        ? `${Number(collective.sharedPoints) || 0}/${Number(collective.targetPoints) || 0} points · meilleure série ${Number(collective.bestStreak) || 0}/${Number(collective.targetStreak) || 0}.`
        : winner
        ? stats
          ? `${Number(winner.score) || 0} points · audace ×${Number(stats.audacity).toFixed(2)} · précision ${Number(stats.precision) || 0} % · rentabilité ${Number(stats.profitability) >= 0 ? '+' : ''}${Number(stats.profitability) || 0}.`
          : `${Number(winner.score) || 0} points — quelle machine.`
        : 'Merci d’avoir joué.');
    } else {
      setText('eyebrow', 'ÉCRAN SPECTATEUR');
      setText('hero-title', 'Préparez vos oreilles.');
      setText('hero-subtitle', 'Scannez le QR de la régie pour rejoindre la partie.');
    }
    renderPlayers(state.players);
    setText('status', 'TV connectée · lecture seule');
  }

  async function poll() {
    if (stopped) return;
    if (!code || !accessToken) {
      setText('status', 'Lien TV incomplet. Regénérez-le depuis le PC hôte.');
      return;
    }
    try {
      const response = await fetch(`/api/party/${encodeURIComponent(code)}?accessToken=${encodeURIComponent(accessToken)}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Connexion refusée.');
      if (body.viewerRole !== 'tv') throw new Error('Ce lien n’est pas un accès TV.');
      render(body);
    } catch (error) {
      setText('status', error.message);
      if (/expir|invalide|refus/i.test(error.message)) stopped = true;
    }
    if (!stopped) setTimeout(poll, 700);
  }

  poll();
})();
