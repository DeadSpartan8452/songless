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
  const tutorialSeen = new Set();
  const partyAudio = byId('party-audio');
  let audioUnlocked = false;
  let audioRoundKey = '';
  let audioPlaybackSignature = '';
  let audioStartTimer = null;
  let audioStopTimer = null;
  let reverseAudioContext = null;
  let reverseSource = null;
  let reverseBuffer = null;
  let reverseBufferKey = '';
  let reverseBufferPromise = null;
  let answerSuggestionTimer = null;
  let lastChatId = 0;

  // Nettoie l'ancienne association créée par les versions précédentes.
  try { localStorage.removeItem('songless_controller_profile'); } catch (_) {}

  if (pair) {
    writeText(PAIR_KEY, pair);
  }
  if (params.get('party') && params.get('invite')) {
    writeSession('songless_invited_party', invitedCode);
    writeSession('songless_invite', invite);
  }
  if (params.has('pair')) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('pair');
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

  function safeTeamColor(value, fallback = '#8b5cf6') {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
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
      if (!context.paired) {
        throw new Error(invitedCode || invite
          ? 'Invitation invalide ou expirée : demande un nouveau lien à l’hôte.'
          : 'Appairage absent : rescane le QR code affiché sur le PC.');
      }
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
    pollTimer = setInterval(pollParty, 250);
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
    maybeShowPartyTutorial(next);
    syncPartyAudio(next);
  }

  function tutorialStorageKey(current) {
    if (!party || !current) return '';
    return `songless_tutorial_${party.code}_${party.profileId}_${current.mode}`;
  }

  function maybeShowPartyTutorial(current) {
    const key = tutorialStorageKey(current);
    if (!key || tutorialSeen.has(key)) return;
    tutorialSeen.add(key);
    showPartyTutorial(current);
  }

  function showPartyTutorial(current = state) {
    if (!current) return;
    const answerLabel = {
      titre: 'le titre de la musique',
      artiste: 'l’artiste',
      annee: 'l’année (à deux ans près)',
    }[(current.settings || {}).answer] || 'le titre de la musique';
    const points = Number((current.settings || {}).points) || 1000;
    const modeRules = current.mode === 'buzzer'
      ? `
        <div class="tutorial-rule"><span>🎧</span><p>Le son démarre <strong>en même temps</strong> sur ton téléphone et le PC.</p></div>
        <div class="tutorial-rule"><span>🔴</span><p><strong>Buzze en premier.</strong><br>Quand quelqu’un buzze, les autres attendent.</p></div>
        <div class="tutorial-rule"><span>⌨️</span><p><strong>Tu as 10 secondes</strong> pour écrire ${answerLabel}. La musique reprend ensuite si personne n’a trouvé.</p></div>
        <div class="tutorial-rule"><span>⏳</span><p><strong>Mauvaise réponse :</strong> toi seul es bloqué 3 secondes. À partir de la 3ᵉ erreur, tu perds aussi 10 % des points de la manche.</p></div>
        <div class="tutorial-rule"><span>🗳️</span><p>Vote pour <strong>passer</strong> le morceau.</p></div>
        <div class="tutorial-rule"><span>⭐</span><p>Une bonne réponse rapporte <strong>${points} points</strong>.</p></div>`
      : `
        <div class="tutorial-rule"><span>🎧</span><p>Écoute l’extrait sur ton téléphone ou le PC, puis écris <strong>${answerLabel}</strong>.</p></div>
        <div class="tutorial-rule"><span>📨</span><p><strong>Envoie une seule réponse</strong>, puis attends la révélation de l’hôte.</p></div>
        <div class="tutorial-rule"><span>🗳️</span><p>Vote pour <strong>passer</strong> le morceau.</p></div>
        <div class="tutorial-rule"><span>⭐</span><p>Une réponse rapide rapporte davantage, jusqu’à <strong>${points} points</strong>.</p></div>`;
    const infiniteRule = current.infinite
      ? '<div class="tutorial-rule"><span>∞</span><p><strong>Mode infini :</strong> les manches continuent jusqu’à ce que l’hôte termine la partie.</p></div>'
      : `<div class="tutorial-rule"><span>🏁</span><p>La partie dure <strong>${Number(current.totalRounds) || 1} manches</strong>.</p></div>`;

    byId('tutorial-content').innerHTML = modeRules + infiniteRule;
    byId('tutorial-title').innerText = current.mode === 'buzzer'
      ? 'Mode Buzzer' : 'Réponses simultanées';
    byId('tutorial-gate').classList.remove('hidden');
  }

  function closePartyTutorial() {
    byId('tutorial-gate').classList.add('hidden');
    unlockPartyAudio();
  }

  async function unlockPartyAudio() {
    if (audioUnlocked) return syncPartyAudio(state, true);
    try {
      partyAudio.volume = 1;
      partyAudio.src = '/silence.wav';
      await partyAudio.play();
      if (!reverseAudioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) reverseAudioContext = new AudioContextClass();
      }
      if (reverseAudioContext && reverseAudioContext.state === 'suspended') {
        await reverseAudioContext.resume();
      }
      audioUnlocked = true;
      byId('audio-sync-status').innerText = '🔊 Son synchronisé activé.';
      syncPartyAudio(state, true);
    } catch (_) {
      byId('audio-sync-status').innerText = '🔇 Son bloqué : touche « Règles », puis active-le à nouveau.';
    }
  }

  function partyAudioUrl(current) {
    const query = new URLSearchParams({
      playerToken: party.playerToken,
      round: String(current.round),
    });
    return `/api/party/${encodeURIComponent(party.code)}/audio?${query}`;
  }

  function stopPartyAudio(message = '') {
    clearTimeout(audioStartTimer);
    clearTimeout(audioStopTimer);
    partyAudio.pause();
    if (reverseSource) {
      try { reverseSource.stop(); } catch (_) {}
      reverseSource = null;
    }
    if (message) byId('audio-sync-status').innerText = message;
  }

  function markPhoneRoundStarted(playback) {
    if (!state) return;
    state.serverNow = Math.max(Number(state.serverNow) || 0,
      Number(playback.startedAt) || 0);
    actionSignature = '';
    renderAction();
  }

  function syncPartyAudio(current, force = false) {
    if (!current || !party) return;
    if (!['round', 'reveal'].includes(current.status) || !current.playback) {
      if (audioRoundKey) stopPartyAudio(audioUnlocked
        ? '🔊 Son prêt pour la prochaine manche.'
        : '🔇 Active le son dans les règles.');
      audioRoundKey = '';
      audioPlaybackSignature = '';
      reverseBuffer = null;
      reverseBufferKey = '';
      reverseBufferPromise = null;
      return;
    }

    const key = `${current.code}:${current.round}`;
    const playback = current.playback;
    const signature = `${key}:${current.status}:${Number(playback.startedAt) || 0}:${Number(playback.pausedAt) || 0}:${Number(playback.duration) || 0}:${(current.buzzer || {}).solvedByProfileId || ''}`;
    if (!force && audioPlaybackSignature === signature) return;
    const newRound = audioRoundKey !== key;
    audioRoundKey = key;
    audioPlaybackSignature = signature;
    stopPartyAudio(playback.pausedAt
      ? '⏸️ Musique en pause pendant la réponse…'
      : current.status === 'reveal'
        ? '🎵 Le passage le plus connu arrive…'
        : '⏱️ Synchronisation de l’extrait…');
    if (playback.pausedAt) return;

    const receivedAt = Date.now();
    const serverAtReceipt = Number(current.serverNow) || receivedAt;
    const estimatedServerNow = () => serverAtReceipt + (Date.now() - receivedAt);
    const elapsedMusic = () => Math.max(0,
      (estimatedServerNow() - Number(playback.startedAt)) / 1000 * Number(playback.speed || 1));
    const delay = Math.max(0, Number(playback.startedAt) - serverAtReceipt);
    const url = partyAudioUrl(current);

    if (playback.direction === 'inverse') {
      prepareReversePartyAudio(url, playback, elapsedMusic, delay, key, receivedAt, signature);
      return;
    }

    if (newRound || !partyAudio.src.includes(`/api/party/${encodeURIComponent(party.code)}/audio`)) {
      partyAudio.src = url;
      partyAudio.load();
    }
    partyAudio.playbackRate = Number(playback.speed) || 1;
    partyAudio.preservesPitch = false;
    const start = () => {
      if (!audioUnlocked || audioRoundKey !== key || audioPlaybackSignature !== signature) return;
      const elapsed = elapsedMusic();
      const remaining = Number(playback.duration) - elapsed;
      if (remaining <= 0) return stopPartyAudio('Extrait terminé. En attente de la révélation.');
      if (partyAudio.readyState < 2) {
        partyAudio.addEventListener('canplay', start, { once: true });
        return;
      }
      markPhoneRoundStarted(playback);
      const position = (Number(playback.offset) || 0) + elapsed;
      const playable = Math.min(remaining, Math.max(0, partyAudio.duration - position));
      if (playable <= 0) return stopPartyAudio('Extrait terminé. En attente de la révélation.');
      partyAudio.currentTime = position;
      partyAudio.play().then(() => {
        byId('audio-sync-status').innerText = current.status === 'reveal'
          ? '🎵 Passage connu joué avec le PC.'
          : '🔊 Lecture synchronisée avec le PC.';
        audioStopTimer = setTimeout(() => {
          if (current.status === 'round' && !playback.reveal) {
            partyAudio.pause();
            byId('audio-sync-status').innerText = '🔁 Relecture automatique de l’extrait…';
            const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + Number(playback.duration) * 0.15));
            audioStartTimer = setTimeout(start, loopDelay * 1000);
          } else {
            stopPartyAudio(current.status === 'reveal'
              ? 'Passage connu terminé.'
              : 'Extrait terminé. En attente de la révélation.');
          }
        }, playable / (Number(playback.speed) || 1) * 1000);
      }).catch(() => {
        byId('audio-sync-status').innerText = '🔇 Touche « Règles » pour autoriser le son.';
      });
    };
    audioStartTimer = setTimeout(start, delay);
  }

  async function prepareReversePartyAudio(url, playback, elapsedMusic, delay, key, receivedAt, signature) {
    try {
      const reversed = await getReversePartyBuffer(url, key);
      if (audioPlaybackSignature !== signature) return;
      const wait = Math.max(0, delay - (Date.now() - receivedAt));
      const startReverse = () => {
        if (!audioUnlocked || audioRoundKey !== key || audioPlaybackSignature !== signature) return;
        const elapsed = elapsedMusic();
        const remaining = Number(playback.duration) - elapsed;
        if (remaining <= 0) return stopPartyAudio('Extrait terminé. En attente de la révélation.');
        markPhoneRoundStarted(playback);
        reverseSource = reverseAudioContext.createBufferSource();
        reverseSource.buffer = reversed;
        reverseSource.playbackRate.value = Number(playback.speed) || 1;
        reverseSource.connect(reverseAudioContext.destination);
        const offset = Math.max(0, reversed.duration - (Number(playback.offset) || 0) + elapsed);
        const playable = Math.min(remaining, Math.max(0, reversed.duration - offset));
        if (playable <= 0) return stopPartyAudio('Extrait terminé. En attente de la révélation.');
        reverseSource.start(0, offset, playable);
        byId('audio-sync-status').innerText = '🔊 Lecture inversée synchronisée avec le PC.';
        audioStopTimer = setTimeout(() => {
          if (party && state && state.status === 'round' && !playback.reveal) {
            byId('audio-sync-status').innerText = '🔁 Relecture automatique de l’extrait…';
            const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + Number(playback.duration) * 0.15));
            audioStartTimer = setTimeout(startReverse, loopDelay * 1000);
          } else {
            stopPartyAudio(state && state.status === 'reveal'
              ? 'Passage connu terminé.'
              : 'Extrait terminé. En attente de la révélation.');
          }
        }, playable / (Number(playback.speed) || 1) * 1000);
      };
      audioStartTimer = setTimeout(startReverse, wait);
    } catch (_) {
      byId('audio-sync-status').innerText = 'Impossible de préparer l’extrait inversé sur ce téléphone.';
    }
  }

  function getReversePartyBuffer(url, key) {
    if (reverseBufferKey === key && reverseBuffer) return Promise.resolve(reverseBuffer);
    if (reverseBufferKey === key && reverseBufferPromise) return reverseBufferPromise;
    reverseBufferKey = key;
    reverseBuffer = null;
    reverseBufferPromise = (async () => {
      if (!reverseAudioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Audio inversé non supporté');
        reverseAudioContext = new AudioContextClass();
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio ${response.status}`);
      const decoded = await reverseAudioContext.decodeAudioData(await response.arrayBuffer());
      const reversed = reverseAudioContext.createBuffer(
        decoded.numberOfChannels, decoded.length, decoded.sampleRate);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const source = decoded.getChannelData(channel);
        const target = reversed.getChannelData(channel);
        for (let left = 0, right = source.length - 1; left < source.length; left++, right--) {
          target[left] = source[right];
        }
      }
      if (reverseBufferKey === key) reverseBuffer = reversed;
      return reversed;
    })();
    return reverseBufferPromise;
  }

  let lastReactionId = 0;

  function spawnMobileFloatingReaction(emoji) {
    const overlay = byId('mobile-reactions-overlay');
    if (!overlay) return;
    const el = document.createElement('div');
    el.className = 'mobile-floating-reaction';
    const left = Math.round(10 + Math.random() * 80);
    el.style.left = `${left}%`;
    el.innerText = emoji;
    overlay.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2000);
  }

  function renderReactions() {
    if (!state || !Array.isArray(state.reactions)) return;
    const newReactions = state.reactions.filter(r => Number(r.id) > lastReactionId);
    if (newReactions.length) {
      newReactions.forEach(r => spawnMobileFloatingReaction(r.emoji));
      lastReactionId = Math.max(...state.reactions.map(r => Number(r.id) || 0));
    }
  }

  function renderModifierPill() {
    const pill = byId('mobile-modifier-pill');
    if (!pill) return;
    if (state && state.status === 'round' && state.roundModifier) {
      const mod = state.roundModifier;
      pill.innerHTML = `<span>🃏 ${escapeHtml(mod.name)}</span>`;
      pill.classList.remove('hidden');
    } else {
      pill.classList.add('hidden');
      pill.innerHTML = '';
    }
  }

  function renderMobileModeBadge() {
    const badge = byId('mobile-mode-badge');
    if (!badge || !state) return;
    const me = currentPlayer();
    if (state.mode === 'royale') {
      if (me && me.isGhost) {
        badge.innerHTML = '<span>👻 Fantôme / Spectateur</span>';
        badge.className = 'mobile-mode-badge ghost';
      } else {
        const lives = me && me.lives !== undefined ? me.lives : 3;
        badge.innerHTML = `<span>👑 ${'💖'.repeat(lives)}${'🖤'.repeat(3 - lives)}</span>`;
        badge.className = 'mobile-mode-badge royale';
      }
      badge.classList.remove('hidden');
    } else if (state.mode === 'duel') {
      badge.innerHTML = '<span>🥊 Mode Duel</span>';
      badge.className = 'mobile-mode-badge duel';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderMobileDuel() {
    const card = byId('mobile-duel-card');
    if (!card || !state) return;
    if (state.mode !== 'duel') {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    const teams = state.teams || [];
    let nameA = 'Camp A', nameB = 'Camp B';
    let badgeA = '🔴', badgeB = '🔵';
    let scoreA = 0, scoreB = 0;

    if (teams.length >= 2) {
      nameA = teams[0].name;
      badgeA = teams[0].emoji || '🔴';
      scoreA = state.players.filter(p => p.teamId === teams[0].id).reduce((s, p) => s + (p.score || 0), 0);
      nameB = teams[1].name;
      badgeB = teams[1].emoji || '🔵';
      scoreB = state.players.filter(p => p.teamId === teams[1].id).reduce((s, p) => s + (p.score || 0), 0);
    } else if (state.players && state.players.length >= 2) {
      const p1 = state.players[0];
      const p2 = state.players[1];
      nameA = p1.nom;
      badgeA = p1.emoji || '🔴';
      scoreA = p1.score || 0;
      nameB = p2.nom;
      badgeB = p2.emoji || '🔵';
      scoreB = p2.score || 0;
    }

    if (byId('mobile-duel-a-name')) byId('mobile-duel-a-name').innerText = nameA;
    if (byId('mobile-duel-a-badge')) byId('mobile-duel-a-badge').innerText = badgeA;
    if (byId('mobile-duel-a-score')) byId('mobile-duel-a-score').innerText = `${scoreA} pts`;

    if (byId('mobile-duel-b-name')) byId('mobile-duel-b-name').innerText = nameB;
    if (byId('mobile-duel-b-badge')) byId('mobile-duel-b-badge').innerText = badgeB;
    if (byId('mobile-duel-b-score')) byId('mobile-duel-b-score').innerText = `${scoreB} pts`;

    const score = Math.min(100, Math.max(-100, Number(state.duelScore) || 0));
    const positionPercent = 50 + (score / 2);
    const knot = byId('mobile-duel-knot');
    if (knot) knot.style.left = `${positionPercent}%`;

    const sub = byId('mobile-duel-subtext');
    if (sub) {
      if (score <= -90) sub.innerText = `🔥 ${nameA} va l'emporter !`;
      else if (score >= 90) sub.innerText = `🔥 ${nameB} va l'emporter !`;
      else sub.innerText = 'Tire la corde vers ton camp !';
    }
  }

  function renderTeamCard() {
    const card = byId('mobile-team-card');
    if (!card) return;
    const me = currentPlayer();
    const isTeamsMode = Boolean(state && state.settings && state.settings.teamsMode);
    if (!me || !isTeamsMode) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    const teams = (state && state.teams) || [];
    const myTeam = teams.find(t => t.id === me.teamId);
    const badge = byId('my-team-badge');
    const nameEl = byId('my-team-name');
    if (myTeam) {
      if (badge) badge.innerText = myTeam.emoji || '👥';
      if (nameEl) {
        nameEl.innerText = myTeam.name;
        nameEl.style.color = safeTeamColor(myTeam.color, '#a855f7');
      }
    } else {
      if (badge) badge.innerText = '⚪';
      if (nameEl) {
        nameEl.innerText = 'Sans équipe';
        nameEl.style.color = 'var(--text-muted)';
      }
    }

    const details = byId('mobile-team-details');
    if (!details || details.classList.contains('hidden')) return;

    if (myTeam) {
      const isCaptain = myTeam.captainProfileId === me.profileId;
      const members = myTeam.members || [];
      const requests = myTeam.joinRequests || [];
      let reqHtml = '';
      if (isCaptain && requests.length) {
        reqHtml = `
          <div class="team-requests-box">
            <strong>Demandes à rejoindre (${requests.length})</strong>
            ${requests.map(r => `
              <div class="team-request-row">
                <span>${escapeHtml(r.emoji)} ${escapeHtml(r.nom)}</span>
                <div class="request-actions">
                  <button type="button" class="action-accept" data-accept-join="${r.profileId}" data-team-id="${myTeam.id}">✓ Accepter</button>
                  <button type="button" class="action-refuse" data-refuse-join="${r.profileId}" data-team-id="${myTeam.id}">✕</button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      details.innerHTML = `
        <div class="team-details-content">
          ${reqHtml}
          <div class="team-members-header">Membres de l'équipe :</div>
          <div class="team-members-grid">
            ${members.map(m => `
              <div class="team-member-chip">
                <span>${escapeHtml(m.emoji)} ${escapeHtml(m.nom)}${m.profileId === myTeam.captainProfileId ? ' 👑' : ''}${m.locked ? ' 🔒' : ''}</span>
                ${isCaptain && m.profileId !== me.profileId && !m.locked ? `<button type="button" class="member-kick-btn" data-kick-member="${m.profileId}" data-team-id="${myTeam.id}">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
          ${!me.teamLockedByHost ? `<button type="button" class="secondary-btn leave-team-btn" id="mobile-leave-team-btn">Quitter l’équipe</button>` : '<small class="locked-note">Assigné par l’hôte 🔒</small>'}
        </div>
      `;
    } else {
      details.innerHTML = `
        <div class="team-details-content">
          ${teams.length ? `
            <div class="team-list-header">Rejoindre une équipe :</div>
            <div class="teams-pick-list">
              ${teams.map(t => `
                <div class="team-pick-item" style="border-color: ${safeTeamColor(t.color, '#8b5cf6')}44;">
                  <div>
                    <strong style="color: ${safeTeamColor(t.color, '#a855f7')};">${escapeHtml(t.emoji)} ${escapeHtml(t.name)}</strong>
                    <small>${(t.members || []).length} joueur${(t.members || []).length > 1 ? 's' : ''} · Cap: ${escapeHtml(t.captainNom)}</small>
                  </div>
                  <button type="button" class="primary-btn pick-join-btn" data-join-team="${t.id}">Rejoindre</button>
                </div>
              `).join('')}
            </div>
            <div class="divider"><span>ou créer</span></div>
          ` : '<div class="wait-note">Aucune équipe pour l’instant. Crée la première ci-dessous :</div>'}
          <div class="team-create-mini">
            <input type="text" id="mobile-new-team-name" maxlength="30" placeholder="Nom de ton équipe">
            <button type="button" class="primary-btn" id="mobile-create-team-btn">Créer</button>
          </div>
        </div>
      `;
    }
  }

  function renderRoom() {
    if (!state) return;
    byId('room-code').innerText = state.code;
    const roundLabel = state.infinite
      ? `MANCHE ${state.round} · INFINI`
      : `MANCHE ${state.round} / ${state.totalRounds}`;
    const labels = {
      lobby: ['SALON', 'En attente de l’hôte…', 'Le PC lancera la première manche.'],
      round: [roundLabel, state.mode === 'buzzer' ? 'Prêt à buzzer ?' : 'Quelle est ta réponse ?', 'Le son joue ici et sur le PC au même moment.'],
      reveal: [roundLabel, 'Réponse révélée', 'Regarde le résultat et le classement.'],
      finished: ['TERMINÉ', 'Partie terminée !', 'Voici le classement final.'],
    };
    const label = labels[state.status] || labels.lobby;
    byId('room-status').innerText = label[0];
    byId('room-title').innerText = label[1];
    byId('room-subtitle').innerText = label[2];
    renderModifierPill();
    renderMobileModeBadge();
    renderMobileDuel();
    renderTeamCard();
    renderReactions();
    renderAction();
    renderVotes();
    renderReveal();
    renderRanking();
    renderChat();

    if (state.status === 'finished' && window.songlessTrophies) {
      window.songlessTrophies.unlock('party_first_join');
      const sorted = [...(state.players || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
      const me = currentPlayer();
      if (me && sorted[0] && sorted[0].profileId === me.profileId) {
        window.songlessTrophies.unlock('party_podium_gold');
        if (state.mode === 'royale') window.songlessTrophies.unlock('battle_royale_win');
        if (state.mode === 'duel') window.songlessTrophies.unlock('duel_win');
      }
    }
  }

  function currentPlayer() {
    return state && state.players.find(item => item.profileId === state.viewerProfileId);
  }

  function renderAction() {
    const zone = byId('player-action');
    const me = currentPlayer();
    const buzzer = state.buzzer || {};
    const startsIn = state.playback
      ? Math.max(0, Math.ceil((Number(state.playback.startedAt) - Number(state.serverNow)) / 1000)) : 0;
    const signature = `${state.status}:${state.round}:${state.mode}:${startsIn > 0 ? 'wait' : 'go'}:${me ? me.currentAttempt : 0}:${me ? me.found : false}:${me ? me.finished : false}:${me ? me.answer : ''}:${me ? me.lastAnswer : ''}:${me ? me.buzzPosition : ''}:${me ? me.buzzerBlockedSeconds : 0}:${buzzer.activeProfileId || ''}:${buzzer.solvedByProfileId || ''}:${buzzer.solvedByProfileId && Number(buzzer.answerSecondsRemaining) > 0 ? 'paused' : 'played'}`;
    
    const currentInput = byId('answer-input');
    const hadFocus = currentInput && document.activeElement === currentInput;
    const previousVal = currentInput ? currentInput.value : '';
    const selStart = currentInput ? currentInput.selectionStart : 0;
    const selEnd = currentInput ? currentInput.selectionEnd : 0;

    if (signature === actionSignature) {
      updateActionTimer();
      return;
    }
    actionSignature = signature;
    zone.innerHTML = '';
    if (!me || state.status !== 'round') return;
    if (state.playback && Number(state.serverNow) < Number(state.playback.startedAt)) {
      zone.innerHTML = '<div class="wait-note">Prépare-toi… départ dans <span id="action-timer">—</span> s.</div>';
      updateActionTimer();
      return;
    }
    if (state.mode === 'buzzer') {
      const active = state.players.find(item => item.profileId === buzzer.activeProfileId);
      if (buzzer.solvedByProfileId) {
        const resume = Number(buzzer.answerSecondsRemaining) > 0
          ? ' La musique reprend dans <span id="action-timer">—</span> s.' : '';
        zone.innerHTML = `<div class="wait-note">${buzzer.solvedByProfileId === me.profileId ? 'Bonne réponse !' : 'Bonne réponse trouvée.'}${resume}</div>`;
        updateActionTimer();
        return;
      }
      if (buzzer.activeProfileId) {
        if (buzzer.activeProfileId !== me.profileId) {
          zone.innerHTML = `<div class="wait-note">${escapeHtml(active ? active.nom : 'Un joueur')} répond · <span id="action-timer">—</span> s</div>`;
          updateActionTimer();
          return;
        }
        zone.innerHTML = `
          <div class="wait-note">Tu as <span id="action-timer">—</span> s pour répondre.</div>
          ${answerBox()}`;
        updateActionTimer();
        const inp = byId('answer-input');
        if (inp) {
          if (previousVal && !inp.value) inp.value = previousVal;
          if (hadFocus || document.activeElement !== inp) inp.focus();
          try { if (previousVal) inp.setSelectionRange(selStart, selEnd); } catch (_) {}
        }
        return;
      }
      if (me.buzzerBlockedSeconds) {
        const points = Number(me.lastPenaltyPoints) || 0;
        zone.innerHTML = `<div class="wait-note">Mauvaise réponse : ta pénalité dure encore ${Number(me.buzzerBlockedSeconds)} s.${points ? ` Tu perds aussi ${points} point${points > 1 ? 's' : ''}.` : ''} Les autres peuvent buzzer.</div>`;
        return;
      }
      zone.innerHTML = '<button id="buzz-btn" class="buzz-btn" type="button">BUZZER</button>';
      return;
    }

    // Mode classique (réponses simultanées)
    if (me.found) {
      const count = Array.isArray(me.attempts) ? me.attempts.length : 1;
      zone.innerHTML = `<div class="wait-note success">🎉 Trouvé en ${count} essai${count > 1 ? 's' : ''} (+${Number(me.earnedPoints) || 0} pt) ! En attente des autres…</div>`;
      return;
    }
    if (me.finished) {
      zone.innerHTML = '<div class="wait-note">❌ Tous tes essais sont épuisés. Attends la révélation.</div>';
      return;
    }

    const paliers = state.paliers || [0.2, 0.7, 2.5, 5, 9, 15];
    const attemptIndex = Number(me.currentAttempt) || 0;
    const currentDur = paliers[attemptIndex] !== undefined ? paliers[attemptIndex] : paliers[0];
    const nextDur = paliers[attemptIndex + 1];
    const skipLabel = nextDur !== undefined
      ? `Passer (+${(nextDur - currentDur).toFixed(1).replace('.0', '')}s)`
      : 'Dernier essai !';
    const attemptsList = Array.isArray(me.attempts) && me.attempts.length
      ? `<div class="attempts-history">${me.attempts.map(att => `<span class="attempt-badge ${att.type}">${att.type === 'skipped' ? '↷ Passé' : `❌ ${escapeHtml(att.text || 'Raté')}`}</span>`).join('')}</div>`
      : '';

    zone.innerHTML = `
      <div class="step-indicator">Essai <strong>${attemptIndex + 1} / ${paliers.length}</strong> · <strong>${currentDur} s</strong></div>
      ${attemptsList}
      ${answerBox(skipLabel)}
    `;
    const inp = byId('answer-input');
    if (inp) {
      if (previousVal && !inp.value) inp.value = previousVal;
      if (hadFocus || document.activeElement !== inp) inp.focus();
      try { if (previousVal) inp.setSelectionRange(selStart, selEnd); } catch (_) {}
    }
  }

  function updateActionTimer() {
    const timer = byId('action-timer');
    if (!timer || !state) return;
    if (state.playback && Number(state.serverNow) < Number(state.playback.startedAt)) {
      timer.innerText = Math.max(1, Math.ceil(
        (state.playback.startedAt - state.serverNow) / 1000));
      return;
    }
    timer.innerText = Number((state.buzzer || {}).answerSecondsRemaining) || 0;
  }

  function renderVotes() {
    const zone = byId('round-votes');
    const me = currentPlayer();
    const votes = state && state.votes;
    if (!zone || !me || state.status !== 'round' || !votes || !votes.skip) {
      if (zone) zone.classList.add('hidden');
      return;
    }
    const threshold = Number(votes.threshold) || 1;
    zone.innerHTML = `
      <button type="button" class="vote-btn${votes.skip.voted ? ' voted' : ''}"
              id="vote-skip-btn"${votes.skip.passed ? ' disabled' : ''}>
        ⏭ Passer le morceau · ${Number(votes.skip.count) || 0}/${threshold}
      </button>`;
    zone.classList.remove('hidden');
  }

  function answerBox(skipLabel = '') {
    const mode = state.settings && state.settings.answer;
    const placeholder = mode === 'artiste' ? 'Rechercher un artiste…'
      : mode === 'annee' ? 'Donner une année…' : 'Rechercher une chanson…';
    const inputMode = mode === 'annee' ? ' inputmode="numeric"' : '';
    const skipBtnHtml = skipLabel
      ? `<button id="skip-btn" class="secondary-btn skip-btn" type="button">${skipLabel}</button>`
      : '';
    return `
      <div class="answer-block">
        <div class="answer-search">
          <span class="answer-search-icon" aria-hidden="true">⌕</span>
          <input id="answer-input" class="answer-input" maxlength="200"
                 placeholder="${placeholder}" autocomplete="off"${inputMode}>
          <div id="answer-suggestions" class="answer-suggestions hidden"></div>
        </div>
        <div class="answer-buttons">
          <button id="answer-btn" class="primary-btn" type="button">Envoyer</button>
          ${skipBtnHtml}
        </div>
      </div>`;
  }

  function scheduleAnswerSuggestions() {
    clearTimeout(answerSuggestionTimer);
    const input = byId('answer-input');
    const list = byId('answer-suggestions');
    if (!input || !list) return;
    const query = input.value.trim();
    if (!query) {
      list.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    answerSuggestionTimer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ playerToken: party.playerToken, q: query });
        const result = await api(
          `/api/party/${encodeURIComponent(party.code)}/suggestions?${params}`);
        const currentInput = byId('answer-input');
        if (!currentInput || currentInput.value.trim() !== query) return;
        renderAnswerSuggestions(result.suggestions || []);
      } catch (_) {
        list.classList.add('hidden');
      }
    }, 60);
  }

  function renderAnswerSuggestions(suggestions) {
    const list = byId('answer-suggestions');
    if (!list) return;
    list.innerHTML = suggestions.length
      ? suggestions.map((item, index) => `
          <button type="button" class="answer-suggestion${index === 0 ? ' active' : ''}"
                  data-answer-suggestion="${escapeHtml(item.value)}">
            <strong>${escapeHtml(item.primary || item.value)}</strong>
            <small>${escapeHtml(item.secondary || '')}</small>
          </button>`).join('')
      : '<div class="answer-suggestion-empty">Aucune suggestion</div>';
    list.classList.remove('hidden');
  }

  function renderReveal() {
    const card = byId('reveal-card');
    if (state.status !== 'reveal' || !state.revealedTrack) {
      card.classList.add('hidden');
      card.innerHTML = '';
      return;
    }
    const me = currentPlayer();
    const won = Boolean(me && me.correct);
    if (won && window.songlessTrophies) {
      window.songlessTrophies.unlock('party_win_round');
      if (state.mode === 'buzzer') window.songlessTrophies.unlock('party_buzz_win');
      if (state.mode === 'royale') window.songlessTrophies.unlock('battle_royale_round');
      if (state.mode === 'duel') window.songlessTrophies.unlock('battle_duel_round');
      if (me.attempts && me.attempts.length === 1) window.songlessTrophies.unlock('speed_first');
    }
    const verdict = won
      ? '<span class="round-result-icon" aria-hidden="true">🏆</span><span class="correct">Gagné !</span>'
      : '<span class="round-result-icon" aria-hidden="true">❌</span><span class="wrong">Perdu pour cette manche</span>';
    card.innerHTML = `
      ${verdict}
      <strong>${escapeHtml(state.revealedTrack.title)}</strong>
      ${state.revealedTrack.originalTitle
        ? `<span class="original-title">Titre original : ${escapeHtml(state.revealedTrack.originalTitle)}</span>` : ''}
      <span>${escapeHtml(state.revealedTrack.artist)}</span>`;
    card.classList.remove('hidden');
  }

  function renderRanking() {
    const sorted = [...state.players].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || a.nom.localeCompare(b.nom));
    const me = currentPlayer();
    let podiumHeader = '';
    if (state.status === 'finished') {
      const myRank = sorted.findIndex(item => item.profileId === state.viewerProfileId) + 1;
      const medal = myRank === 1 ? '🥇 1er' : myRank === 2 ? '🥈 2e' : myRank === 3 ? '🥉 3e' : `${myRank}e`;
      if (myRank === 1 && window.songlessTrophies) {
        window.songlessTrophies.unlock('party_first_place');
        if (state.mode === 'royale') window.songlessTrophies.unlock('battle_royale_win');
        if (state.mode === 'duel') window.songlessTrophies.unlock('battle_duel_win');
      }
      if (sorted.length >= 4 && window.songlessTrophies) {
        window.songlessTrophies.unlock('party_full_house');
      }
      let badgesHtml = '';
      if (me && me.accolades) {
        if (me.accolades.lightningWins > 0) badgesHtml += `<span class="controller-badge">⚡ L'Éclair (${me.accolades.lightningWins}x à 0,2s)</span>`;
        if (me.accolades.firstCorrectCount > 0) badgesHtml += `<span class="controller-badge">🚀 Le Rapide (${me.accolades.firstCorrectCount}x 1er)</span>`;
        if (me.accolades.clutchWins > 0) badgesHtml += `<span class="controller-badge">🛡️ Le Survivant (${me.accolades.clutchWins}x au 6e)</span>`;
      }
      podiumHeader = `
        <div class="controller-podium">
          <div class="podium-rank-highlight">🏆 Tu termines <strong>${medal}</strong> avec <strong>${Number(me ? me.score : 0)} pts</strong></div>
          ${badgesHtml ? `<div class="controller-badges-row">${badgesHtml}</div>` : ''}
        </div>
      `;
    }

    byId('ranking').innerHTML = podiumHeader + (sorted.length
      ? sorted.map((item, index) => `
          <div class="rank-row${item.profileId === state.viewerProfileId ? ' me' : ''}">
            <span>${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</span>
            <span>${escapeHtml(item.emoji || '🎧')} ${escapeHtml(item.nom)}</span>
            <span class="rank-score">${Number(item.score) || 0}<small>${Number(item.session && item.session.correct) || 0}/${Number(item.session && item.session.rounds) || 0}</small></span>
          </div>`).join('')
      : '<div class="wait-note">Aucun joueur n’a encore rejoint.</div>');
  }

  function renderChat() {
    const zone = byId('chat-messages');
    if (!zone || !state) return;
    const messages = Array.isArray(state.chat) ? state.chat.slice(-40) : [];
    zone.innerHTML = messages.length
      ? messages.map(message => `
          <div class="chat-message">
            <strong>${escapeHtml(message.emoji || '🎧')} ${escapeHtml(message.nom || 'Joueur')}</strong>
            ${escapeHtml(message.message || '')}
          </div>`).join('')
      : '<div class="chat-empty">Aucun message pour le moment.</div>';
    const newest = messages.length ? Number(messages[messages.length - 1].id) || 0 : 0;
    if (newest !== lastChatId) {
      lastChatId = newest;
      zone.scrollTop = zone.scrollHeight;
    }
  }

  async function sendChat() {
    const input = byId('chat-input');
    const message = input && input.value.trim();
    if (!message) return;
    if (await playerAction('chat', { message })) {
      input.value = '';
      input.focus();
    }
  }

  async function playerAction(action, data = {}) {
    try {
      receiveState(await api(`/api/party/${encodeURIComponent(party.code)}/action`, {
        method: 'POST',
        body: JSON.stringify({ playerToken: party.playerToken, action, data }),
      }));
      return true;
    } catch (error) {
      toast(error.message);
      return false;
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
          if (event === 'list' && data.compilation) {
            setGiftStatus(`Compilation détectée : ${data.total} morceaux à rechercher…`);
          }
          if (event === 'approval') {
            setGiftStatus(`Cette compilation contient ${data.total} morceaux. En attente de l'accord du PC pour dépasser les ${data.freeLimit} premiers…`);
          }
          if (event === 'approval-result') {
            setGiftStatus(data.accepted
              ? `Accord reçu : import jusqu'à ${data.limit} morceaux…`
              : `Import limité aux ${data.limit} premiers morceaux…`);
          }
          if (event === 'item') {
            const prefix = `${Number(data.index) || 0}/${Number(data.total) || 0}`;
            if (data.etat === 'en-cours') setGiftStatus(`${prefix} · recherche de ${data.titre}…`);
            if (data.etat === 'ajoute') setGiftStatus(`${prefix} · ${data.titre} ajouté.`);
            if (data.etat === 'doublon') setGiftStatus(`${prefix} · ${data.titre} était déjà présent.`);
            if (data.etat === 'erreur') setGiftStatus(`${prefix} · ${data.titre} ignoré.`);
          }
          if (event === 'error') throw new Error(data.error || 'Ajout impossible.');
          if (event === 'done') result = data;
        }
        if (part.done) break;
      }
      if (!result) throw new Error('Songless n’a pas confirmé l’ajout.');
      byId('gift-query').value = '';
      if (result.compilation) {
        const added = (result.ajoutes || []).length;
        const duplicates = (result.doublons || []).length;
        const errors = (result.erreurs || []).length;
        setGiftStatus(`${added} ajouté${added > 1 ? 's' : ''}, ${duplicates} déjà présent${duplicates > 1 ? 's' : ''}, ${errors} ignoré${errors > 1 ? 's' : ''}.`, added ? 'success' : '');
      } else {
        setGiftStatus('Musique ajoutée à Songless.', 'success');
      }
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
    const suggestions = byId('answer-suggestions');
    if (suggestions) suggestions.classList.add('hidden');
    playerAction('answer', { answer });
  }

  function leaveParty() {
    clearInterval(pollTimer);
    pollTimer = null;
    party = null;
    state = null;
    actionSignature = '';
    audioRoundKey = '';
    audioPlaybackSignature = '';
    reverseBuffer = null;
    reverseBufferKey = '';
    reverseBufferPromise = null;
    lastChatId = 0;
    stopPartyAudio('🔊 Son prêt pour une autre partie.');
    writeJson(PARTY_KEY, null);
    byId('room-screen').classList.add('hidden');
    byId('join-screen').classList.remove('hidden');
    byId('party-code').value = invitedCode || '';
  }

  document.addEventListener('click', event => {
    const answerSuggestion = event.target.closest('[data-answer-suggestion]');
    if (answerSuggestion) {
      const input = byId('answer-input');
      if (input) {
        input.value = answerSuggestion.getAttribute('data-answer-suggestion') || '';
        byId('answer-suggestions').classList.add('hidden');
        submitAnswer();
      }
      return;
    }
    const emojiBtn = event.target.closest('#mobile-emoji-picker [data-emoji]');
    if (emojiBtn) {
      const picker = byId('mobile-emoji-picker');
      if (picker) picker.querySelectorAll('.emoji-pick-btn').forEach(b => b.classList.remove('active'));
      emojiBtn.classList.add('active');
      const input = byId('new-emoji');
      if (input) input.value = emojiBtn.getAttribute('data-emoji') || '🎧';
      return;
    }
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
    if (event.target.closest('#tutorial-open-btn')) showPartyTutorial();
    if (event.target.closest('#tutorial-close-btn')) closePartyTutorial();
    if (event.target.closest('#buzz-btn')) playerAction('buzz');
    if (event.target.closest('#answer-btn')) submitAnswer();
    if (event.target.closest('#skip-btn')) playerAction('skip');
    if (event.target.closest('#vote-skip-btn')) playerAction('vote-skip');
    if (event.target.closest('#chat-send-btn')) sendChat();
    if (event.target.closest('#gift-link-btn')) giveMusicLink();
    if (event.target.closest('#gift-file-btn')) giveMusicFile();

    const reactionBtn = event.target.closest('.mobile-quick-reactions [data-reaction]');
    if (reactionBtn) {
      const emoji = reactionBtn.getAttribute('data-reaction');
      playerAction('reaction', { emoji });
      return;
    }

    if (event.target.closest('#mobile-team-btn')) {
      const details = byId('mobile-team-details');
      if (details) {
        details.classList.toggle('hidden');
        renderTeamCard();
      }
      return;
    }

    const joinTeamBtn = event.target.closest('[data-join-team]');
    if (joinTeamBtn) {
      const teamId = joinTeamBtn.getAttribute('data-join-team');
      playerAction('request-join-team', { teamId }).then(() => toast('Demande envoyée au capitaine !'));
      return;
    }

    const acceptJoinBtn = event.target.closest('[data-accept-join]');
    if (acceptJoinBtn) {
      const profileId = acceptJoinBtn.getAttribute('data-accept-join');
      const teamId = acceptJoinBtn.getAttribute('data-team-id');
      playerAction('accept-team-request', { profileId, teamId });
      return;
    }

    const refuseJoinBtn = event.target.closest('[data-refuse-join]');
    if (refuseJoinBtn) {
      const profileId = refuseJoinBtn.getAttribute('data-refuse-join');
      const teamId = refuseJoinBtn.getAttribute('data-team-id');
      playerAction('refuse-team-request', { profileId, teamId });
      return;
    }

    const kickMemberBtn = event.target.closest('[data-kick-member]');
    if (kickMemberBtn) {
      const profileId = kickMemberBtn.getAttribute('data-kick-member');
      const teamId = kickMemberBtn.getAttribute('data-team-id');
      playerAction('kick-team-member', { profileId, teamId });
      return;
    }

    if (event.target.closest('#mobile-leave-team-btn')) {
      playerAction('leave-team');
      return;
    }

    if (event.target.closest('#mobile-create-team-btn')) {
      const nameInput = byId('mobile-new-team-name');
      const name = nameInput && nameInput.value.trim();
      if (!name) return toast('Donne un nom à ton équipe.');
      playerAction('create-team', { name }).then(() => toast(`Équipe « ${name} » créée !`));
      return;
    }

    const suggestions = byId('answer-suggestions');
    if (suggestions && !event.target.closest('.answer-search')) {
      suggestions.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.id === 'party-code') joinParty();
    if (event.key === 'Enter' && event.target.id === 'new-name') createProfile();
    if (event.key === 'Enter' && event.target.id === 'chat-input') {
      event.preventDefault();
      sendChat();
    }
    if (event.target.id === 'answer-input') {
      const list = byId('answer-suggestions');
      const items = list ? [...list.querySelectorAll('[data-answer-suggestion]')] : [];
      let active = items.findIndex(item => item.classList.contains('active'));
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
        event.preventDefault();
        if (active >= 0) items[active].classList.remove('active');
        active = event.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length;
        items[active].classList.add('active');
        items[active].scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (active >= 0 && list && !list.classList.contains('hidden')) {
          event.target.value = items[active].getAttribute('data-answer-suggestion') || '';
          list.classList.add('hidden');
        }
        submitAnswer();
      } else if (event.key === 'Escape' && list) {
        list.classList.add('hidden');
      }
    }
    if (event.key === 'Enter' && event.target.id === 'gift-query') giveMusicLink();
  });

  byId('party-code').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'answer-input') scheduleAnswerSuggestions();
  });

  byId('profile-gate').addEventListener('click', event => {
    if (event.target !== byId('profile-gate')) return;
    event.preventDefault();
    event.stopPropagation();
    toast('Choisis un profil pour continuer.');
  });

  initialize();
})();
