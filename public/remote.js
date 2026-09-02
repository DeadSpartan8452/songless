'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('party') || '').toUpperCase();
  const accessToken = String(params.get('access') || '');
  const byId = id => document.getElementById(id);
  let state = null;
  let busy = false;
  let stopped = false;

  function setText(id, value) { byId(id).textContent = String(value == null ? '' : value); }

  function render(next) {
    state = next;
    setText('party-code', next.code);
    setText('connection', 'Télécommande connectée · accès temporaire');
    const finalDuel = next.finalDuel;
    const finalScore = finalDuel
      ? (finalDuel.contenders || []).map(item => Number(item.wins) || 0).join(' — ')
      : '';
    setText('round-label', finalDuel && finalDuel.active
      ? 'DUEL FINAL'
      : next.status === 'lobby' ? 'SALON' : `MANCHE ${next.round}${next.infinite ? '' : ` / ${next.totalRounds}`}`);
    if (next.status === 'round') {
      setText('state-title', finalDuel && finalDuel.active ? '⚔️ Duel final' : 'Ça joue');
      setText('state-detail', finalDuel && finalDuel.active
        ? `${finalScore} · premier à ${finalDuel.targetWins}.`
        : 'Les réponses sont ouvertes.');
    } else if (next.status === 'reveal') {
      setText('state-title', next.revealedTrack && next.revealedTrack.title || 'Réponse révélée');
      setText('state-detail', next.revealedTrack && next.revealedTrack.artist || 'Prêt pour la suite.');
    } else if (next.status === 'finished') {
      setText('state-title', 'Terminé');
      setText('state-detail', 'Le classement final est verrouillé.');
    } else {
      setText('state-title', 'En attente');
      setText('state-detail', `${(next.players || []).length} joueur${(next.players || []).length > 1 ? 's' : ''} dans le salon.`);
    }
    byId('next-btn').disabled = busy || next.status === 'round' || next.status === 'finished';
    byId('next-btn').textContent = next.round ? 'Manche suivante' : 'Lancer la manche';
    byId('reveal-btn').disabled = busy || next.status !== 'round';
    byId('lobby-btn').disabled = busy || next.status === 'lobby';
    byId('finish-btn').disabled = busy || next.status === 'finished';
    const sorted = [...(next.players || [])].sort((a, b) => Number(b.score) - Number(a.score));
    byId('players').replaceChildren(...sorted.slice(0, 5).map(player => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      const score = document.createElement('strong');
      name.textContent = `${player.emoji || '🎧'} ${player.nom || 'Joueur'}`;
      score.textContent = `${Number(player.score) || 0} pt`;
      row.append(name, score);
      return row;
    }));
  }

  async function api(route, options = {}) {
    const response = await fetch(route, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur ${response.status}`);
    return body;
  }

  async function command(action, data = {}) {
    if (busy || !state) return;
    busy = true;
    render(state);
    try {
      const next = await api(`/api/party/${encodeURIComponent(code)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, action, data }),
      });
      render(next);
    } catch (error) {
      setText('connection', error.message);
    } finally {
      busy = false;
      if (state) render(state);
    }
  }

  async function poll() {
    if (stopped) return;
    if (!code || !accessToken) {
      setText('connection', 'Lien incomplet. Regénérez-le sur le PC hôte.');
      return;
    }
    try {
      const next = await api(`/api/party/${encodeURIComponent(code)}?accessToken=${encodeURIComponent(accessToken)}`);
      if (next.viewerRole !== 'remote_admin') throw new Error('Ce lien n’est pas une télécommande administrateur.');
      render(next);
    } catch (error) {
      setText('connection', error.message);
      if (/expir|invalide|refus/i.test(error.message)) stopped = true;
    }
    if (!stopped) setTimeout(poll, 700);
  }

  byId('next-btn').addEventListener('click', () => command('start-next-round'));
  byId('reveal-btn').addEventListener('click', () => command('reveal'));
  byId('lobby-btn').addEventListener('click', () => command('lobby'));
  byId('finish-btn').addEventListener('click', () => {
    if (confirm('Terminer la partie et figer le classement ?')) command('finish');
  });
  poll();
})();
