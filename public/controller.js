'use strict';

(function () {
  const PAIR_KEY = 'songless_pair';
  const PARTY_KEY = 'songless_controller_party';
  const params = new URLSearchParams(location.search);
  let pair = params.get('pair') || readText(PAIR_KEY);
  let invitedCode = params.get('party') || readSession('songless_invited_party');
  let invite = params.get('invite') || readSession('songless_invite');
  let profiles = [];
  let pendingProfile = null;
  // Le profil est volontairement propre à cette page. Une actualisation doit
  // toujours redemander qui tient le téléphone.
  let profile = null;
  let party = readJson(PARTY_KEY);
  let state = null;
  let pollTimer = null;
  let toastTimer = null;
  let actionSignature = '';

  // Nettoie l'ancienne association créée par les versions précédentes.
  try { localStorage.removeItem('songless_controller_profile'); } catch (_) {}

  if (pair) {
    writeText(PAIR_KEY, pair);
  }
  if (params.get('party') && params.get('invite')) {
    writeSession('songless_invited_party', invitedCode);
    writeSession('songless_invite', invite);
  }
  if (params.has('pair') || params.has('party') || params.has('invite')) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('pair');
    cleanUrl.searchParams.delete('party');
    cleanUrl.searchParams.delete('invite');
    history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  function byId(id) { return document.getElementById(id); }
  function readText(key) { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function writeText(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function readSession(key) { try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function writeSession(key, value) { try { sessionStorage.setItem(key, value); } catch (_) {} }
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function writeJson(key, value) {
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch (_) {}
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[char]);
  }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (pair) headers.set('X-Songless-Pair', pair);
    if (invite && invitedCode) {
      headers.set('X-Songless-Invite', invite);
      headers.set('X-Songless-Party', invitedCode);
    }
    if (typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
    return data;
  }

  function toast(message) {
    const element = byId('toast');
    element.innerText = message;
    element.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.add('hidden'), 3500);
  }

  async function initialize() {
    try {
      const context = await api('/api/context');
      if (!context.paired) throw new Error('Appairage absent : rescane le QR code affiché sur le PC.');
      const result = await api('/api/controller/profiles');
      profiles = Array.isArray(result.profiles) ? result.profiles : [];
      renderProfiles();
      showProfileGate();
    } catch (error) {
      byId('connection-error').innerText = error.message;
      byId('connection-error').classList.remove('hidden');
    }
  }

  function renderProfiles() {
    const list = byId('profile-list');
    list.innerHTML = profiles.length
      ? profiles.map(item => `
          <button class="profile-pick${pendingProfile && pendingProfile.id === item.id ? ' selected' : ''}"
                  type="button" data-profile="${escapeHtml(item.id)}"
                  aria-pressed="${pendingProfile && pendingProfile.id === item.id ? 'true' : 'false'}">
            <span class="profile-pick-emoji">${escapeHtml(item.emoji || '🎧')}</span>
            <span class="profile-pick-copy">
              <strong>${escapeHtml(item.nom || 'Joueur')}</strong>
              <small>${globalStatsLabel(item.multiplayer)}</small>
            </span>
          </button>`).join('')
      : '<div class="wait-note">Aucun profil pour le moment. Crée le premier ci-dessous.</div>';
    byId('confirm-profile-btn').disabled = !pendingProfile;
  }

  function globalStatsLabel(stats) {
    const value = stats && typeof stats === 'object' ? stats : {};
    const sessions = Number(value.sessions) || 0;
    const wins = Number(value.wins) || 0;
    const correct = Number(value.correct) || 0;
    return `${sessions} soirée${sessions > 1 ? 's' : ''} · ${wins} victoire${wins > 1 ? 's' : ''} · ${correct} bonnes réponses`;
  }

  function showProfileGate() {
    pendingProfile = null;
    renderProfiles();
    byId('join-screen').setAttribute('inert', '');
    byId('profile-gate').classList.remove('hidden');
    setTimeout(() => byId('new-name').focus(), 50);
  }

  function selectProfile(next, resume = true) {
    profile = next;
    byId('profile-gate').classList.add('hidden');
    byId('join-screen').removeAttribute('inert');
    byId('music-gift').classList.remove('hidden');
    byId('profile-change-btn').innerText = `${profile.emoji || '🎧'} ${profile.nom}`;
    byId('join-screen').classList.remove('hidden');
    if (resume && party && party.profileId !== profile.id) leaveParty();
    if (party && party.profileId === profile.id) startPolling();
    else if (invitedCode) {
      byId('party-code').value = invitedCode;
      byId('party-code').readOnly = true;
      setTimeout(joinParty, 0);
    }
  }

  async function createProfile() {
    const nom = byId('new-name').value.trim();
    const emoji = byId('new-emoji').value.trim() || '🎧';
    if (!nom) return toast('Écris un prénom ou un pseudo.');
    try {
      const created = await api('/api/controller/profiles', {
        method: 'POST',
        body: JSON.stringify({ nom, emoji }),
      });
      profiles.push(created);
      pendingProfile = created;
      renderProfiles();
      byId('new-name').value = '';
      toast('Profil créé. Valide ton choix pour continuer.');
    } catch (error) {
      toast(error.message);
    }
  }

  async function joinParty() {
    if (!profile) {
      showProfileGate();
      return toast('Choisis d’abord ton profil.');
    }
    const code = byId('party-code').value.trim().toUpperCase();
    if (code.length !== 5) return toast('Le code contient 5 caractères.');
    try {
      const result = await api(`/api/party/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      });
      party = { code, playerToken: result.playerToken, profileId: profile.id };
      writeJson(PARTY_KEY, party);
      receiveState(result.state);
      startPolling();
    } catch (error) {
      toast(error.message);
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    if (!party) return;
    byId('join-screen').classList.add('hidden');
    byId('room-screen').classList.remove('hidden');
    pollTimer = setInterval(pollParty, 1000);
    pollParty();
  }

  async function pollParty() {
    if (!party) return;
    try {
      const query = new URLSearchParams({ playerToken: party.playerToken });
      receiveState(await api(`/api/party/${encodeURIComponent(party.code)}?${query}`));
    } catch (error) {
      if (/introuvable|terminée/i.test(error.message)) leaveParty();
      else console.warn(error.message);
    }
  }

  function receiveState(next) {
    state = next;
    renderRoom();
  }

  function renderRoom() {
    if (!state) return;
    byId('room-code').innerText = state.code;
    const roundLabel = state.infinite
      ? `MANCHE ${state.round} · INFINI`
      : `MANCHE ${state.round} / ${state.totalRounds}`;
    const labels = {
      lobby: ['SALON', 'En attente de l’hôte…', 'Le PC lancera la première manche.'],
      round: [roundLabel, state.mode === 'buzzer' ? 'Prêt à buzzer ?' : 'Quelle est ta réponse ?', 'Écoute la musique sur le PC.'],
      reveal: [roundLabel, 'Réponse révélée', 'Regarde le résultat et le classement.'],
      finished: ['TERMINÉ', 'Partie terminée !', 'Voici le classement final.'],
    };
    const label = labels[state.status] || labels.lobby;
    byId('room-status').innerText = label[0];
    byId('room-title').innerText = label[1];
    byId('room-subtitle').innerText = label[2];
    renderAction();
    renderReveal();
    renderRanking();
  }

  function currentPlayer() {
    return state && state.players.find(item => item.profileId === state.viewerProfileId);
  }

  function renderAction() {
    const zone = byId('player-action');
    const me = currentPlayer();
    const signature = `${state.status}:${state.round}:${state.mode}:${me ? me.answer : ''}:${me ? me.buzzPosition : ''}`;
    if (signature === actionSignature) return;
    actionSignature = signature;
    zone.innerHTML = '';
    if (!me || state.status !== 'round') return;
    if (me.answer !== null) {
      zone.innerHTML = '<div class="wait-note">Réponse envoyée. Attends la révélation du PC.</div>';
      return;
    }
    if (state.mode === 'buzzer' && !me.buzzPosition) {
      zone.innerHTML = '<button id="buzz-btn" class="buzz-btn" type="button">BUZZER</button>';
      return;
    }
    if (state.mode === 'buzzer' && me.buzzPosition !== 1) {
      zone.innerHTML = `<div class="wait-note">Buzzer n°${me.buzzPosition}. Un autre joueur répond.</div>`;
      return;
    }
    zone.innerHTML = `
      <input id="answer-input" class="answer-input" maxlength="200" placeholder="Ta réponse" autocomplete="off">
      <button id="answer-btn" class="primary-btn" type="button">Envoyer</button>`;
    setTimeout(() => byId('answer-input') && byId('answer-input').focus(), 30);
  }

  function renderReveal() {
    const card = byId('reveal-card');
    if (state.status !== 'reveal' || !state.revealedTrack) {
      card.classList.add('hidden');
      card.innerHTML = '';
      return;
    }
    const me = currentPlayer();
    const verdict = me && me.correct
      ? '<span class="correct">Bonne réponse !</span>'
      : '<span class="wrong">Raté pour cette manche</span>';
    card.innerHTML = `
      ${verdict}
      <strong>${escapeHtml(state.revealedTrack.title)}</strong>
      <span>${escapeHtml(state.revealedTrack.artist)}</span>`;
    card.classList.remove('hidden');
  }

  function renderRanking() {
    const sorted = [...state.players].sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom));
    byId('ranking').innerHTML = sorted.length
      ? sorted.map((item, index) => `
          <div class="rank-row${item.profileId === state.viewerProfileId ? ' me' : ''}">
            <span>${index + 1}</span>
            <span>${escapeHtml(item.emoji || '🎧')} ${escapeHtml(item.nom)}</span>
            <span class="rank-score">${Number(item.score) || 0}<small>${Number(item.session && item.session.correct) || 0}/${Number(item.session && item.session.rounds) || 0}</small></span>
          </div>`).join('')
      : '<div class="wait-note">Aucun joueur n’a encore rejoint.</div>';
  }

  async function playerAction(action, data = {}) {
    try {
      receiveState(await api(`/api/party/${encodeURIComponent(party.code)}/action`, {
        method: 'POST',
        body: JSON.stringify({ playerToken: party.playerToken, action, data }),
      }));
    } catch (error) {
      toast(error.message);
    }
  }

  function setGiftStatus(message, type = '') {
    const status = byId('gift-status');
    status.innerText = message;
    status.className = `gift-status${type ? ` ${type}` : ''}`;
  }

  async function giveMusicLink() {
    const query = byId('gift-query').value.trim();
    if (!query) return toast('Écris un titre, un artiste ou colle une URL.');
    const button = byId('gift-link-btn');
    button.disabled = true;
    setGiftStatus('Recherche et ajout en cours…');
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Songless-Pair': pair,
          'X-Songless-Invite': invite,
          'X-Songless-Party': invitedCode,
        },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Erreur ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const raw of events) {
          const event = (raw.match(/^event:\s*(.+)$/m) || [])[1];
          const json = (raw.match(/^data:\s*(.+)$/m) || [])[1];
          const data = json ? JSON.parse(json) : {};
          if (event === 'progress' && data.message) setGiftStatus(data.message);
          if (event === 'error') throw new Error(data.error || 'Ajout impossible.');
          if (event === 'done') result = data;
        }
        if (part.done) break;
      }
      if (!result) throw new Error('Songless n’a pas confirmé l’ajout.');
      byId('gift-query').value = '';
      setGiftStatus('Musique ajoutée à Songless.', 'success');
    } catch (error) {
      setGiftStatus(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function giveMusicFile() {
    const input = byId('gift-file');
    const file = input.files && input.files[0];
    if (!file) return toast('Choisis un fichier audio.');
    const button = byId('gift-file-btn');
    button.disabled = true;
    setGiftStatus(`Envoi de ${file.name}…`);
    try {
      const body = new FormData();
      body.append('audio', file);
      const result = await api('/api/upload', { method: 'POST', body });
      const count = Array.isArray(result.ajoutes) ? result.ajoutes.length : 0;
      const duplicates = Array.isArray(result.doublons) ? result.doublons.length : 0;
      if (count) setGiftStatus('Musique ajoutée à Songless.', 'success');
      else if (duplicates) setGiftStatus('Cette musique était déjà dans Songless.', 'success');
      else setGiftStatus('Fichier reçu, mais aucune musique n’a été ajoutée.', 'error');
      input.value = '';
    } catch (error) {
      setGiftStatus(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function submitAnswer() {
    const input = byId('answer-input');
    const answer = input && input.value.trim();
    if (!answer) return toast('Écris une réponse.');
    playerAction('answer', { answer });
  }

  function leaveParty() {
    clearInterval(pollTimer);
    pollTimer = null;
    party = null;
    state = null;
    actionSignature = '';
    writeJson(PARTY_KEY, null);
    byId('room-screen').classList.add('hidden');
    byId('join-screen').classList.remove('hidden');
    byId('party-code').value = invitedCode || '';
  }

  document.addEventListener('click', event => {
    const pick = event.target.closest('[data-profile]');
    if (pick) {
      const found = profiles.find(item => item.id === pick.getAttribute('data-profile'));
      if (found) {
        pendingProfile = found;
        renderProfiles();
      }
    }
    if (event.target.closest('#confirm-profile-btn') && pendingProfile) selectProfile(pendingProfile);
    if (event.target.closest('#create-profile-btn')) createProfile();
    if (event.target.closest('#profile-change-btn')) {
      if (party) leaveParty();
      showProfileGate();
    }
    if (event.target.closest('#join-btn')) joinParty();
    if (event.target.closest('#leave-btn')) leaveParty();
    if (event.target.closest('#buzz-btn')) playerAction('buzz');
    if (event.target.closest('#answer-btn')) submitAnswer();
    if (event.target.closest('#gift-link-btn')) giveMusicLink();
    if (event.target.closest('#gift-file-btn')) giveMusicFile();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.id === 'party-code') joinParty();
    if (event.key === 'Enter' && event.target.id === 'new-name') createProfile();
    if (event.key === 'Enter' && event.target.id === 'answer-input') submitAnswer();
    if (event.key === 'Enter' && event.target.id === 'gift-query') giveMusicLink();
  });

  byId('party-code').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
  });

  byId('profile-gate').addEventListener('click', event => {
    if (event.target !== byId('profile-gate')) return;
    event.preventDefault();
    event.stopPropagation();
    toast('Choisis un profil pour continuer.');
  });

  initialize();
})();
