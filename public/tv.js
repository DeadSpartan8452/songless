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
      points.textContent = `${Number(player.score) || 0} PT`;
      item.append(rank, name, points);
      return item;
    }));
    setText('player-count', `${sorted.length} JOUEUR${sorted.length > 1 ? 'S' : ''}`);
  }

  function render(state) {
    setText('party-code', state.code);
    setText('round-label', state.status === 'lobby'
      ? 'SALON OUVERT'
      : state.status === 'finished'
        ? 'SOIRÉE TERMINÉE'
        : `MANCHE ${state.round}${state.infinite ? '' : ` / ${state.totalRounds}`}`);
    const hero = byId('hero');
    hero.className = `hero ${state.status}`;
    if (state.status === 'round') {
      setText('eyebrow', 'À VOUS DE JOUER');
      setText('hero-title', state.mode === 'buzzer' ? 'Buzzez maintenant.' : 'Qui reconnaît ce morceau ?');
      setText('hero-subtitle', 'Titre, artiste ou année : la régie attend vos réponses.');
    } else if (state.status === 'reveal' && state.revealedTrack) {
      setText('eyebrow', 'RÉPONSE');
      setText('hero-title', state.revealedTrack.title || 'Morceau révélé');
      setText('hero-subtitle', state.revealedTrack.artist || 'Artiste inconnu');
    } else if (state.status === 'finished') {
      const winner = [...(state.players || [])].sort((a, b) => Number(b.score) - Number(a.score))[0];
      setText('eyebrow', 'VERDICT FINAL');
      setText('hero-title', winner ? `${winner.emoji || '🏆'} ${winner.nom}` : 'Fin de partie');
      setText('hero-subtitle', winner ? `${Number(winner.score) || 0} points — quelle machine.` : 'Merci d’avoir joué.');
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
