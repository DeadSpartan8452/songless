'use strict';

(function () {
  const PAIR_KEY = 'songless_pair';
  const PARTY_KEY = 'songless_controller_party';
  const params = new URLSearchParams(location.search);
  let pair = params.get('pair') || readText(PAIR_KEY);
  let invitedCode = params.get('party') || readSession('songless_invited_party');
  let invite = params.get('invite') || readSession('songless_invite');
  let profiles = [];
  let canEditProfiles = false;
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
      canEditProfiles = context.canEditProfiles === true;
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
    if (byId('edit-profile-open-btn')) {
      byId('edit-profile-open-btn').classList.toggle('hidden', !canEditProfiles);
      byId('edit-profile-open-btn').disabled = !canEditProfiles || !pendingProfile;
    }
  }

  function openEditProfile() {
    if (!canEditProfiles || !pendingProfile) return;
    const editSection = byId('edit-profile-section');
    if (!editSection) return;
    byId('edit-name').value = pendingProfile.nom || '';
    byId('edit-emoji').value = pendingProfile.emoji || '🎧';

    // Remplir le sélecteur d'emoji d'édition
    const editPicker = byId('edit-emoji-picker');
    const mainPicker = byId('mobile-emoji-picker');
    if (editPicker && mainPicker && !editPicker.children.length) {
      editPicker.innerHTML = mainPicker.innerHTML;
      editPicker.querySelectorAll('.emoji-pick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          editPicker.querySelectorAll('.emoji-pick-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          byId('edit-emoji').value = btn.dataset.emoji || '🎧';
        });
      });
    }

    if (editPicker) {
      editPicker.querySelectorAll('.emoji-pick-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.emoji === (pendingProfile.emoji || '🎧'));
      });
    }

    editSection.classList.remove('hidden');
    byId('edit-name').focus();
  }

  function cancelEditProfile() {
    const editSection = byId('edit-profile-section');
    if (editSection) editSection.classList.add('hidden');
  }

  async function saveEditProfile() {
    if (!pendingProfile) return;
    const nom = byId('edit-name').value.trim();
    const emoji = byId('edit-emoji').value.trim() || '🎧';
    if (!nom) return toast('Écris un prénom ou un pseudo.');

    try {
      const updated = await api(`/api/controller/profiles/${encodeURIComponent(pendingProfile.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ nom, emoji }),
      });
      const idx = profiles.findIndex(p => p.id === pendingProfile.id);
      if (idx >= 0) profiles[idx] = updated;
      pendingProfile = updated;
      if (profile && profile.id === updated.id) {
        profile = updated;
        byId('profile-change-btn').innerText = `${profile.emoji || '🎧'} ${profile.nom}`;
      }
      renderProfiles();
      cancelEditProfile();
      toast('Profil mis à jour avec succès !');
    } catch (error) {
      toast(error.message);
    }
  }

  function showPalmares() {
    const targetProfile = profile || pendingProfile || (profiles.length ? profiles[0] : null);
    if (!targetProfile) return toast('Crée ou choisis d’abord un profil.');
    const sheet = byId('palmares-gate');
    if (!sheet) return;

    const mp = (targetProfile && targetProfile.multiplayer) || {};
    const sessions = Number(mp.sessions) || 0;
    const wins = Number(mp.wins) || 0;
    const correct = Number(mp.correct) || 0;
    const rounds = Number(mp.rounds) || 0;
    const rate = rounds > 0 ? Math.round((correct / rounds) * 100) : 0;

    byId('palmares-summary').innerHTML = `
      <div class="palmares-stat-card">
        <div class="palmares-stat-val">${sessions}</div>
        <div class="palmares-stat-lbl">Soirées jouées</div>
      </div>
      <div class="palmares-stat-card">
        <div class="palmares-stat-val">${wins}</div>
        <div class="palmares-stat-lbl">Victoires</div>
      </div>
      <div class="palmares-stat-card">
        <div class="palmares-stat-val">${correct}</div>
        <div class="palmares-stat-lbl">Bonnes réponses</div>
      </div>
      <div class="palmares-stat-card">
        <div class="palmares-stat-val">${rate}%</div>
        <div class="palmares-stat-lbl">Taux de réussite</div>
      </div>
    `;

    const badges = [];
    if (wins >= 5) badges.push({ emoji: '👑', label: 'Maître du jeu' });
    if (correct >= 20) badges.push({ emoji: '⚡', label: 'L’Éclair' });
    if (sessions >= 10) badges.push({ emoji: '🛡️', label: 'Vétéran' });
    if (rate >= 70 && rounds >= 10) badges.push({ emoji: '🎯', label: 'Tireur d’élite' });
    if (wins >= 1) badges.push({ emoji: '🏆', label: 'Champion' });

    byId('palmares-badges').innerHTML = badges.length
      ? badges.map(b => `<div class="palmares-badge-pill"><span>${b.emoji}</span><strong>${b.label}</strong></div>`).join('')
      : '<div class="wait-note" style="margin:0;">Joue des parties pour décrocher des distinctions !</div>';

    const allTrophies = typeof SONGLESS_TROPHIES !== 'undefined' ? SONGLESS_TROPHIES : [];
    const unlockedIds = new Set(window.songlessTrophies
      && typeof window.songlessTrophies.getUnlockedIds === 'function'
      ? window.songlessTrophies.getUnlockedIds()
      : []);
    const unlockedCount = unlockedIds.size;
    const totalCount = allTrophies.length || 105;
    const percent = Math.min(100, Math.round((unlockedCount / totalCount) * 100));

    byId('palmares-count-label').innerText = `${unlockedCount} / ${totalCount} (${percent}%)`;
    byId('palmares-bar-fill').style.width = `${percent}%`;

    byId('palmares-trophies-list').innerHTML = allTrophies.length
      ? allTrophies.map(t => {
          const unlocked = unlockedIds.has(t.id);
          return `
            <div class="trophy-item-mobile ${unlocked ? 'unlocked' : 'locked'}">
              <span class="trophy-mobile-icon">${t.icon || '🏆'}</span>
              <div class="trophy-mobile-info">
                <div class="trophy-mobile-title">${escapeHtml(t.name || t.id)}</div>
                <div class="trophy-mobile-desc">${escapeHtml(t.desc || '')}</div>
              </div>
              <span class="trophy-mobile-status">${unlocked ? '✓ Débloqué' : '🔒'}</span>
            </div>
          `;
        }).join('')
      : '<div class="wait-note">105 trophées à débloquer au fil des soirées !</div>';

    sheet.classList.remove('hidden');
  }

  function hidePalmares() {
    const sheet = byId('palmares-gate');
    if (sheet) sheet.classList.add('hidden');
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
    cancelEditProfile();
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
    const finalDuel = current.finalDuel && current.finalDuel.active;
    const modeRules = finalDuel
      ? `
        <div class="tutorial-rule"><span>⚔️</span><p>Vous êtes les <strong>deux derniers survivants</strong>.</p></div>
        <div class="tutorial-rule"><span>2️⃣</span><p>Le premier à gagner <strong>${Number(current.finalDuel.targetWins) || 2} manches</strong> remporte la partie.</p></div>
        <div class="tutorial-rule"><span>🤝</span><p>Si vous trouvez ou ratez tous les deux, <strong>personne ne marque</strong> et le duel continue.</p></div>
        <div class="tutorial-rule"><span>🎧</span><p>Réponds normalement avec <strong>${answerLabel}</strong>.</p></div>`
      : current.mode === 'buzzer'
      ? `
        <div class="tutorial-rule"><span>🎧</span><p>Le son démarre <strong>en même temps</strong> sur ton téléphone et le PC.</p></div>
        <div class="tutorial-rule"><span>🔴</span><p><strong>Buzze en premier.</strong><br>Quand quelqu’un buzze, les autres attendent.</p></div>
        <div class="tutorial-rule"><span>⌨️</span><p><strong>Tu as 10 secondes</strong> pour écrire ${answerLabel}. La musique reprend ensuite si personne n’a trouvé.</p></div>
        <div class="tutorial-rule"><span>⏳</span><p><strong>Mauvaise réponse :</strong> toi seul es bloqué 3 secondes. À partir de la 3ᵉ erreur, tu perds aussi 10 % des points de la manche.</p></div>
        <div class="tutorial-rule"><span>🗳️</span><p>Vote pour <strong>passer</strong> le morceau.</p></div>
        <div class="tutorial-rule"><span>⭐</span><p>Une bonne réponse rapporte <strong>${points} points</strong>.</p></div>`
      : current.mode === 'royale'
      ? `
        <div class="tutorial-rule"><span>👑</span><p>Tu commences avec <strong>3 vies</strong>.</p></div>
        <div class="tutorial-rule"><span>💔</span><p>Une manche ratée retire une vie. À zéro, tu deviens spectateur.</p></div>
        <div class="tutorial-rule"><span>⚔️</span><p>Quand il ne reste que deux survivants, le <strong>duel final</strong> commence automatiquement.</p></div>
        <div class="tutorial-rule"><span>🎧</span><p>Écoute l’extrait puis écris <strong>${answerLabel}</strong>.</p></div>`
      : current.mode === 'confidence'
      ? `
        <div class="tutorial-rule"><span>🎲</span><p>Choisis <strong>×1, ×2 ou ×3</strong> avant chaque réponse.</p></div>
        <div class="tutorial-rule"><span>📈</span><p>Une bonne réponse multiplie tes points par ta mise.</p></div>
        <div class="tutorial-rule"><span>🛡️</span><p>Une erreur peut coûter des points, mais jamais plus de <strong>30 % de ton score</strong>.</p></div>
        <div class="tutorial-rule"><span>👀</span><p>Le gain possible et la perte maximale sont affichés <strong>avant l’envoi</strong>.</p></div>`
      : current.mode === 'cooperation'
      ? `
        <div class="tutorial-rule"><span>🤝</span><p>Vous poursuivez <strong>le même objectif de points et de série</strong>.</p></div>
        <div class="tutorial-rule"><span>💖</span><p>L’équipe partage <strong>3 vies</strong>. Une manche sans bonne réponse peut en coûter une.</p></div>
        <div class="tutorial-rule"><span>🎭</span><p>Ton rôle donne un bonus positif selon le moment où tu trouves.</p></div>
        <div class="tutorial-rule"><span>🏅</span><p>Le résultat est collectif, mais chaque contribution reste visible.</p></div>`
      : current.mode === 'intruder'
      ? `
        <div class="tutorial-rule"><span>🕵️</span><p>Observe les <strong>quatre fiches</strong> et trouve celle qui ne partage pas le même point commun.</p></div>
        <div class="tutorial-rule"><span>🔐</span><p>Il existe toujours <strong>un seul intrus certain</strong>, calculé avec les métadonnées de la bibliothèque.</p></div>
        <div class="tutorial-rule"><span>☝️</span><p>Tu n’as droit qu’à <strong>un choix par manche</strong>.</p></div>
        <div class="tutorial-rule"><span>💡</span><p>La réponse et sa justification apparaissent uniquement à la révélation.</p></div>`
      : current.mode === 'auction'
      ? `
        <div class="tutorial-rule"><span>🔨</span><p>Annonce le <strong>plus court extrait</strong> dont tu penses avoir besoin.</p></div>
        <div class="tutorial-rule"><span>🔐</span><p>Les enchères restent <strong>secrètes</strong> jusqu’à leur clôture.</p></div>
        <div class="tutorial-rule"><span>⏱️</span><p>La plus petite durée répond en premier ; une égalité favorise l’enchère reçue en premier.</p></div>
        <div class="tutorial-rule"><span>🔁</span><p>En cas d’erreur, la main passe à l’enchère suivante avec son propre extrait.</p></div>`
      : `
        <div class="tutorial-rule"><span>🎧</span><p>Écoute l’extrait sur ton téléphone ou le PC, puis écris <strong>${answerLabel}</strong>.</p></div>
        <div class="tutorial-rule"><span>📨</span><p><strong>Envoie une seule réponse</strong>, puis attends la révélation de l’hôte.</p></div>
        <div class="tutorial-rule"><span>🗳️</span><p>Vote pour <strong>passer</strong> le morceau.</p></div>
        <div class="tutorial-rule"><span>⭐</span><p>Une réponse rapide rapporte davantage, jusqu’à <strong>${points} points</strong>.</p></div>`;
    const infiniteRule = finalDuel
      ? '<div class="tutorial-rule"><span>🏁</span><p>Le nombre de manches s’adapte jusqu’à la victoire.</p></div>'
      : current.infinite
      ? '<div class="tutorial-rule"><span>∞</span><p><strong>Mode infini :</strong> les manches continuent jusqu’à ce que l’hôte termine la partie.</p></div>'
      : `<div class="tutorial-rule"><span>🏁</span><p>La partie dure <strong>${Number(current.totalRounds) || 1} manches</strong>.</p></div>`;

    byId('tutorial-content').innerHTML = modeRules + infiniteRule;
    byId('tutorial-title').innerText = finalDuel
      ? 'Duel final'
      : current.mode === 'buzzer'
        ? 'Mode Buzzer'
        : current.mode === 'royale' ? 'Battle Royale'
          : current.mode === 'confidence' ? 'Mode Confiance'
            : current.mode === 'cooperation' ? 'Mode Coopération'
              : current.mode === 'intruder' ? 'Mode Intrus'
                : current.mode === 'auction' ? 'Mode Enchères' : 'Réponses simultanées';
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
    const start = (isFirstPlay = true) => {
      if (!audioUnlocked || audioRoundKey !== key || audioPlaybackSignature !== signature) return;
      if (partyAudio.readyState < 2) {
        partyAudio.addEventListener('canplay', () => start(isFirstPlay), { once: true });
        return;
      }
      markPhoneRoundStarted(playback);
      const startOffset = Number(playback.offset) || 0;
      const fullDuration = Number(playback.duration) || 0.2;
      const speed = Number(playback.speed) || 1;

      const elapsed = isFirstPlay ? elapsedMusic() : 0;
      const remaining = fullDuration - elapsed;
      if (remaining <= 0 && isFirstPlay) {
        if (current.status === 'round' && !playback.reveal) {
          const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + fullDuration * 0.15));
          clearTimeout(audioStartTimer);
          audioStartTimer = setTimeout(() => start(false), loopDelay * 1000);
          return;
        }
        return stopPartyAudio('Extrait terminé. En attente de la révélation.');
      }

      const position = startOffset + elapsed;
      const playable = Math.min(Math.max(0.1, remaining), Math.max(0.1, partyAudio.duration - position));
      partyAudio.currentTime = position;
      partyAudio.play().then(() => {
        byId('audio-sync-status').innerText = current.status === 'reveal'
          ? '🎵 Passage connu joué avec le PC.'
          : '🔊 Lecture synchronisée avec le PC.';
        clearTimeout(audioStopTimer);
        audioStopTimer = setTimeout(() => {
          if (current.status === 'round' && !playback.reveal) {
            partyAudio.pause();
            partyAudio.currentTime = startOffset;
            byId('audio-sync-status').innerText = '🔁 Relecture automatique de l’extrait…';
            const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + fullDuration * 0.15));
            clearTimeout(audioStartTimer);
            audioStartTimer = setTimeout(() => start(false), (loopDelay / speed) * 1000);
          } else {
            stopPartyAudio(current.status === 'reveal'
              ? 'Passage connu terminé.'
              : 'Extrait terminé. En attente de la révélation.');
          }
        }, (playable / speed) * 1000);
      }).catch(() => {
        byId('audio-sync-status').innerText = '🔇 Touche « Règles » pour autoriser le son.';
      });
    };
    clearTimeout(audioStartTimer);
    audioStartTimer = setTimeout(() => start(true), delay);
  }

  async function prepareReversePartyAudio(url, playback, elapsedMusic, delay, key, receivedAt, signature) {
    try {
      const reversed = await getReversePartyBuffer(url, key);
      if (audioPlaybackSignature !== signature) return;
      const wait = Math.max(0, delay - (Date.now() - receivedAt));
      const startReverse = (isFirstPlay = true) => {
        if (!audioUnlocked || audioRoundKey !== key || audioPlaybackSignature !== signature) return;
        markPhoneRoundStarted(playback);
        const fullDuration = Number(playback.duration) || 0.2;
        const speed = Number(playback.speed) || 1;
        const elapsed = isFirstPlay ? elapsedMusic() : 0;
        const remaining = fullDuration - elapsed;

        if (remaining <= 0 && isFirstPlay) {
          if (party && state && state.status === 'round' && !playback.reveal) {
            const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + fullDuration * 0.15));
            clearTimeout(audioStartTimer);
            audioStartTimer = setTimeout(() => startReverse(false), loopDelay * 1000);
            return;
          }
          return stopPartyAudio('Extrait terminé. En attente de la révélation.');
        }

        try { if (reverseSource) reverseSource.stop(); } catch (_) {}
        reverseSource = reverseAudioContext.createBufferSource();
        reverseSource.buffer = reversed;
        reverseSource.playbackRate.value = speed;
        reverseSource.connect(reverseAudioContext.destination);
        const offset = Math.max(0, reversed.duration - (Number(playback.offset) || 0) + elapsed);
        const playable = Math.min(Math.max(0.1, remaining), Math.max(0.1, reversed.duration - offset));
        reverseSource.start(0, offset, playable);
        byId('audio-sync-status').innerText = '🔊 Lecture inversée synchronisée avec le PC.';
        clearTimeout(audioStopTimer);
        audioStopTimer = setTimeout(() => {
          if (party && state && state.status === 'round' && !playback.reveal) {
            byId('audio-sync-status').innerText = '🔁 Relecture automatique de l’extrait…';
            const loopDelay = Math.min(4.2, Math.max(2.2, 2.0 + fullDuration * 0.15));
            clearTimeout(audioStartTimer);
            audioStartTimer = setTimeout(() => startReverse(false), (loopDelay / speed) * 1000);
          } else {
            stopPartyAudio(state && state.status === 'reveal'
              ? 'Passage connu terminé.'
              : 'Extrait terminé. En attente de la révélation.');
          }
        }, (playable / speed) * 1000);
      };
      clearTimeout(audioStartTimer);
      audioStartTimer = setTimeout(() => startReverse(true), wait);
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
      const finalDuel = state.finalDuel;
      if (finalDuel && (finalDuel.active || finalDuel.winnerProfileId)) {
        const scores = (finalDuel.contenders || []).map(item => Number(item.wins) || 0).join(' — ');
        badge.innerHTML = `<span>⚔️ DUEL FINAL · ${escapeHtml(scores)}</span>`;
        badge.className = 'mobile-mode-badge final-duel';
      } else if (me && me.isGhost) {
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
    } else if (state.mode === 'confidence') {
      const stake = me && me.confidence ? me.confidence.preview.multiplier : 1;
      badge.innerHTML = `<span>🎲 Confiance · mise ×${Number(stake) || 1}</span>`;
      badge.className = 'mobile-mode-badge confidence';
      badge.classList.remove('hidden');
    } else if (state.mode === 'cooperation') {
      const coop = state.cooperation || {};
      badge.innerHTML = `<span>🤝 ${Number(coop.sharedPoints) || 0}/${Number(coop.targetPoints) || 0} · ${'💖'.repeat(Number(coop.lives) || 0)}${'🖤'.repeat(Math.max(0, 3 - (Number(coop.lives) || 0)))}</span>`;
      badge.className = 'mobile-mode-badge cooperation';
      badge.classList.remove('hidden');
    } else if (state.mode === 'intruder') {
      const challenge = state.intruderChallenge || {};
      const difficulty = { easy: 'Facile', medium: 'Intermédiaire', hard: 'Difficile' }[challenge.difficulty] || 'Intrus';
      badge.innerHTML = `<span>🕵️ Intrus · ${difficulty}</span>`;
      badge.className = 'mobile-mode-badge intruder';
      badge.classList.remove('hidden');
    } else if (state.mode === 'auction') {
      const auctionState = state.auction || {};
      const active = state.players.find(player => player.profileId === auctionState.activeProfileId);
      badge.innerHTML = `<span>🔨 ${auctionState.phase === 'bidding' ? 'Enchères ouvertes' : active ? `${escapeHtml(active.nom)} · ${Number(auctionState.activeSeconds)} s` : 'Enchères'}</span>`;
      badge.className = 'mobile-mode-badge auction';
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
    renderTyping();

    if (state.status === 'finished' && window.songlessTrophies) {
      window.songlessTrophies.unlock('party_first_join');
      const sorted = [...(state.players || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
      const me = currentPlayer();
      const winnerProfileId = state.winnerProfileId || (sorted[0] && sorted[0].profileId);
      if (me && winnerProfileId === me.profileId) {
        window.songlessTrophies.unlock('party_podium_gold');
        if (state.mode === 'royale') window.songlessTrophies.unlock('battle_royale_win');
        if (state.mode === 'duel') window.songlessTrophies.unlock('duel_win');
      }
    }
  }

  function currentPlayer() {
    return state && state.players.find(item => item.profileId === state.viewerProfileId);
  }

  function intruderCardsHtml(me) {
    const challenge = state && state.intruderChallenge;
    if (!challenge || !Array.isArray(challenge.options)) return '';
    const revealed = state.status !== 'round' && Boolean(challenge.answerId);
    const selectedId = me && me.answer ? String(me.answer) : '';
    const dimension = {
      artist: 'artiste', genre: 'genre', theme: 'thème', year: 'époque',
    }[challenge.dimension] || 'point commun';
    const difficulty = {
      easy: 'Facile', medium: 'Intermédiaire', hard: 'Difficile',
    }[challenge.difficulty] || 'Progressif';
    const cards = challenge.options.map((option, index) => {
      const correct = revealed && option.id === challenge.answerId;
      const selected = option.id === selectedId;
      const classes = `intruder-option${selected ? ' selected' : ''}${correct ? ' correct' : ''}${revealed && selected && !correct ? ' wrong' : ''}`;
      const meta = [option.artist, option.year, option.genre, option.theme]
        .filter(Boolean).map(value => escapeHtml(String(value))).join(' · ');
      return `<button type="button" class="${classes}" data-intruder-option="${escapeHtml(String(option.id))}"
                ${revealed || (me && me.finished) ? 'disabled' : ''}
                aria-pressed="${selected}" aria-label="Choisir ${escapeHtml(String(option.title))}">
          <span class="intruder-number">0${index + 1}</span>
          <strong>${escapeHtml(String(option.title))}</strong>
          <small>${meta}</small>
          ${correct ? '<span class="intruder-verdict">L’INTRUS</span>' : ''}
        </button>`;
    }).join('');
    const verdict = revealed
      ? `<div class="intruder-explanation"><strong>${me && me.correct ? '✅ Bien vu !' : '💡 Le point commun'}</strong><span>${escapeHtml(String(challenge.explanation || ''))}</span></div>`
      : me && me.finished
        ? '<div class="wait-note">Choix verrouillé. La réponse reste secrète jusqu’à la révélation.</div>'
        : '<div class="wait-note">Un seul choix possible : observe les quatre fiches.</div>';
    return `<section class="intruder-challenge" aria-labelledby="intruder-prompt">
      <div class="intruder-heading"><span>🕵️ ${difficulty}</span><small>Point commun : ${dimension}</small></div>
      <p class="intruder-prompt" id="intruder-prompt">${escapeHtml(String(challenge.prompt || 'Quel est l’intrus ?'))}</p>
      <div class="intruder-grid">${cards}</div>
      ${verdict}
    </section>`;
  }

  function auctionActionHtml(me) {
    const auctionState = state && state.auction;
    if (!auctionState) return '';
    const ownBid = (auctionState.bids || []).find(bid => (
      me && bid.profileId === me.profileId));
    if (auctionState.phase === 'bidding') {
      return `<section class="auction-panel" aria-labelledby="auction-prompt">
        <div class="auction-heading"><span>🔨 Enchères scellées</span><strong><span id="auction-timer">—</span> s</strong></div>
        <p id="auction-prompt">De combien de secondes as-tu besoin ?</p>
        <div class="auction-options">
          ${(auctionState.options || []).map(option => `<button type="button"
            data-auction-bid="${Number(option.seconds)}" ${ownBid && ownBid.submitted ? 'disabled' : ''}>
            <strong>${Number(option.seconds).toLocaleString('fr-FR')} s</strong>
            <small>jusqu’à ${Number(option.points) || 0} pt</small>
          </button>`).join('')}
        </div>
        <div class="auction-bid-status">${ownBid && ownBid.submitted
          ? `🔒 Ton enchère de <strong>${Number(ownBid.seconds).toLocaleString('fr-FR')} s</strong> est verrouillée.`
          : 'Les durées adverses restent cachées jusqu’à la clôture.'}</div>
      </section>`;
    }
    if (auctionState.phase === 'answering') {
      const active = state.players.find(player => (
        player.profileId === auctionState.activeProfileId));
      const tie = auctionState.tie
        ? `<small class="auction-tie">Égalité départagée : ${escapeHtml(auctionState.tieBreak)}</small>` : '';
      if (me && me.profileId === auctionState.activeProfileId) {
        return `<section class="auction-panel active"><div class="auction-turn"><strong>🔨 Ton enchère gagne : ${Number(auctionState.activeSeconds).toLocaleString('fr-FR')} s</strong><span>À toi de répondre.</span>${tie}</div>${answerBox()}</section>`;
      }
      return `<section class="auction-panel"><div class="auction-turn"><strong>${escapeHtml(active ? active.nom : 'Un joueur')} joue ${Number(auctionState.activeSeconds).toLocaleString('fr-FR')} s</strong><span>Une erreur transmettra la main à l’enchère suivante.</span>${tie}</div></section>`;
    }
    return `<div class="auction-result">${auctionState.result === 'solved'
      ? `✅ Enchère remportée · +${Number(auctionState.points) || 0} pt`
      : '⌛ Aucune enchère n’a trouvé cette manche.'}</div>`;
  }

  function renderAction() {
    const zone = byId('player-action');
    const me = currentPlayer();
    const buzzer = state.buzzer || {};
    const startsIn = state.playback
      ? Math.max(0, Math.ceil((Number(state.playback.startedAt) - Number(state.serverNow)) / 1000)) : 0;
    const confidenceKey = me && me.confidence
      ? `${me.confidence.preview.multiplier}:${me.confidence.lastDelta}` : '';
    const cooperationKey = state.cooperation
      ? `${state.cooperation.sharedPoints}:${state.cooperation.streak}:${state.cooperation.lives}` : '';
    const intruderKey = state.intruderChallenge
      ? `${state.intruderChallenge.id}:${state.intruderChallenge.answerId || ''}` : '';
    const auctionKey = state.auction
      ? `${state.auction.phase}:${state.auction.activeProfileId || ''}:${(state.auction.bids || []).map(bid => `${bid.profileId}:${bid.submitted}`).join(',')}` : '';
    const signature = `${state.status}:${state.round}:${state.mode}:${startsIn > 0 ? 'wait' : 'go'}:${me ? me.currentAttempt : 0}:${me ? me.found : false}:${me ? me.finished : false}:${me ? me.answer : ''}:${me ? me.lastAnswer : ''}:${me ? me.buzzPosition : ''}:${me ? me.buzzerBlockedSeconds : 0}:${confidenceKey}:${cooperationKey}:${intruderKey}:${auctionKey}:${buzzer.activeProfileId || ''}:${buzzer.solvedByProfileId || ''}:${buzzer.solvedByProfileId && Number(buzzer.answerSecondsRemaining) > 0 ? 'paused' : 'played'}`;
    
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
    if (state.mode === 'intruder' && state.intruderChallenge
        && (state.status === 'round' || state.status === 'reveal')) {
      zone.innerHTML = intruderCardsHtml(me);
      return;
    }
    if (!me || state.status !== 'round') return;
    if (state.playback && Number(state.serverNow) < Number(state.playback.startedAt)) {
      zone.innerHTML = '<div class="wait-note">Prépare-toi… départ dans <span id="action-timer">—</span> s.</div>';
      updateActionTimer();
      return;
    }
    if (state.mode === 'auction' && state.auction) {
      zone.innerHTML = auctionActionHtml(me);
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
    const auctionTimer = byId('auction-timer');
    if (auctionTimer && state && state.auction && state.auction.deadlineAt) {
      auctionTimer.innerText = Math.max(0, Math.ceil(
        (Number(state.auction.deadlineAt) - Number(state.serverNow)) / 1000));
    }
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
    if (!zone || !me || state.status !== 'round' || !votes) {
      if (zone) zone.classList.add('hidden');
      return;
    }
    const threshold = Number(votes.threshold) || 1;
    let buttonsHtml = '';

    if (['classic', 'confidence'].includes(state.mode)
        && votes.nextStep && votes.nextStep.nextDuration) {
      buttonsHtml += `
        <button type="button" class="vote-btn${votes.nextStep.voted ? ' voted' : ''}"
                id="vote-step-btn">
          ⏭ Débloquer palier suivant (${votes.nextStep.nextDuration}s) · ${Number(votes.nextStep.count) || 0}/${threshold}
        </button>
      `;
    }

    if (votes.skip && state.mode !== 'auction') {
      buttonsHtml += `
        <button type="button" class="vote-btn${votes.skip.voted ? ' voted' : ''}"
                id="vote-skip-btn"${votes.skip.passed ? ' disabled' : ''}>
          ⏭ Passer la manche entière · ${Number(votes.skip.count) || 0}/${threshold}
        </button>
      `;
    }

    if (buttonsHtml) {
      zone.innerHTML = buttonsHtml;
      zone.classList.remove('hidden');
    } else {
      zone.classList.add('hidden');
    }
  }

  function answerBox(skipLabel = '') {
    const mode = state.settings && state.settings.answer;
    const placeholder = mode === 'artiste' ? 'Rechercher un artiste…'
      : mode === 'annee' ? 'Donner une année…' : 'Rechercher une chanson…';
    const inputMode = mode === 'annee' ? ' inputmode="numeric"' : '';
    const skipBtnHtml = skipLabel
      ? `<button id="skip-btn" class="secondary-btn skip-btn" type="button">${skipLabel}</button>`
      : '';
    const me = currentPlayer();
    const confidenceState = me && me.confidence;
    const confidenceHtml = state.mode === 'confidence' && confidenceState
      ? `<fieldset class="confidence-picker">
          <legend>Ta mise avant de répondre</legend>
          <div class="confidence-options">
            ${(state.confidenceLevels || []).map(level => `
              <button type="button" data-confidence="${level.multiplier}"
                      class="confidence-option${confidenceState.preview.multiplier === level.multiplier ? ' selected' : ''}"
                      aria-pressed="${confidenceState.preview.multiplier === level.multiplier}">
                <span>${level.emoji}</span><strong>×${level.multiplier}</strong><small>${level.label}</small>
              </button>`).join('')}
          </div>
          <div class="confidence-preview" aria-live="polite">
            <strong>Jusqu’à +${Number(confidenceState.preview.potentialGain) || 0} pts</strong>
            <span>Perte max −${Number(confidenceState.preview.maximumLoss) || 0} pts</span>
          </div>
        </fieldset>` : '';
    const coop = state.cooperation;
    const playerCoop = me && me.cooperation;
    const cooperationHtml = state.mode === 'cooperation' && coop && playerCoop
      ? `<div class="cooperation-card">
          <div class="cooperation-role"><span>${playerCoop.role.emoji}</span><div><strong>${escapeHtml(playerCoop.role.label)}</strong><small>${escapeHtml(playerCoop.role.description)}</small></div></div>
          <div class="cooperation-progress"><span style="width:${Number(coop.progress) || 0}%"></span></div>
          <div class="cooperation-numbers"><strong>${Number(coop.sharedPoints) || 0} / ${Number(coop.targetPoints) || 0} pts</strong><span>Série ${Number(coop.streak) || 0}/${Number(coop.targetStreak) || 0} · contribution +${Number(playerCoop.contribution) || 0}</span></div>
        </div>` : '';
    return `
      <div class="answer-block">
        ${confidenceHtml}
        ${cooperationHtml}
        <div class="answer-search">
          <span class="answer-search-icon" aria-hidden="true">⌕</span>
          <input id="answer-input" class="answer-input" maxlength="200"
                 placeholder="${placeholder}" autocomplete="off"${inputMode}
                 role="combobox" aria-autocomplete="list"
                 aria-controls="answer-suggestions" aria-expanded="false">
          <div id="answer-suggestions" class="answer-suggestions hidden"
               role="listbox" aria-label="Suggestions de réponses"></div>
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
      setAnswerSuggestionsOpen(false);
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
        setAnswerSuggestionsOpen(false);
      }
    }, 60);
  }

  function setAnswerSuggestionsOpen(open) {
    const list = byId('answer-suggestions');
    const input = byId('answer-input');
    if (list) list.classList.toggle('hidden', !open);
    if (input) {
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) input.removeAttribute('aria-activedescendant');
    }
  }

  function setAnswerSuggestionActive(items, activeIndex) {
    items.forEach((item, index) => {
      const active = index === activeIndex;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const input = byId('answer-input');
    if (input && items[activeIndex]) {
      input.setAttribute('aria-activedescendant', items[activeIndex].id);
    }
  }

  function renderAnswerSuggestions(suggestions) {
    const list = byId('answer-suggestions');
    if (!list) return;
    list.innerHTML = suggestions.length
      ? suggestions.map((item, index) => `
          <button type="button" tabindex="-1"
                  class="answer-suggestion${index === 0 ? ' active' : ''}"
                  id="answer-suggestion-${index}" role="option"
                  aria-selected="${index === 0 ? 'true' : 'false'}"
                  data-answer-suggestion="${escapeHtml(item.value)}">
            <strong>${escapeHtml(item.primary || item.value)}</strong>
            <small>${escapeHtml(item.secondary || '')}</small>
          </button>`).join('')
      : '<div class="answer-suggestion-empty">Aucune suggestion</div>';
    setAnswerSuggestionsOpen(true);
    const input = byId('answer-input');
    if (input) {
      input.setAttribute('aria-expanded', 'true');
      if (suggestions.length) input.setAttribute('aria-activedescendant', 'answer-suggestion-0');
      else input.removeAttribute('aria-activedescendant');
    }
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
    const sorted = [...state.players].sort((a, b) => {
      if (state.winnerProfileId && a.profileId === state.winnerProfileId) return -1;
      if (state.winnerProfileId && b.profileId === state.winnerProfileId) return 1;
      return (Number(b.score) || 0) - (Number(a.score) || 0) || a.nom.localeCompare(b.nom);
    });
    const rankByProfileId = new Map(sorted.map(item => [
      item.profileId,
      state.winnerProfileId ? sorted.indexOf(item) + 1
        : 1 + sorted.filter(other => (Number(other.score) || 0) > (Number(item.score) || 0)).length,
    ]));
    const me = currentPlayer();
    let podiumHeader = '';
    if (state.status === 'finished') {
      const myRank = rankByProfileId.get(state.viewerProfileId) || 0;
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
      const confidenceStats = me && me.confidence && me.confidence.stats;
      const confidenceHtml = state.mode === 'confidence' && confidenceStats
        ? `<div class="confidence-report">
            <span>🎲 Audace <strong>×${Number(confidenceStats.audacity).toFixed(2)}</strong></span>
            <span>🎯 Précision <strong>${Number(confidenceStats.precision) || 0} %</strong></span>
            <span>📈 Rentabilité <strong>${Number(confidenceStats.profitability) >= 0 ? '+' : ''}${Number(confidenceStats.profitability) || 0} pts</strong></span>
          </div>` : '';
      const coop = state.cooperation;
      const cooperationHtml = state.mode === 'cooperation' && coop
        ? `<div class="cooperation-final ${coop.result === 'won' ? 'won' : 'lost'}">
            <strong>${coop.result === 'won' ? '🤝 Objectif collectif atteint !' : '💔 Défi collectif manqué'}</strong>
            <span>${Number(coop.sharedPoints) || 0}/${Number(coop.targetPoints) || 0} pts · meilleure série ${Number(coop.bestStreak) || 0}</span>
          </div>` : '';
      const intruderHtml = state.mode === 'intruder' && me
        ? `<div class="intruder-final">
            <strong>🕵️ Tes enquêtes</strong>
            <span>${Number(me.session && me.session.correct) || 0} intrus trouvé${Number(me.session && me.session.correct) > 1 ? 's' : ''} sur ${Number(me.session && me.session.rounds) || 0}</span>
          </div>` : '';
      podiumHeader = `
        <div class="controller-podium">
          <div class="podium-rank-highlight">🏆 Tu termines <strong>${medal}</strong> avec <strong>${Number(me ? me.score : 0)} pts</strong></div>
          ${badgesHtml ? `<div class="controller-badges-row">${badgesHtml}</div>` : ''}
          ${confidenceHtml}
          ${cooperationHtml}
          ${intruderHtml}
        </div>
      `;
    }

    byId('ranking').innerHTML = podiumHeader + (sorted.length
      ? sorted.map(item => {
          const rank = rankByProfileId.get(item.profileId) || 0;
          return `
          <div class="rank-row${item.profileId === state.viewerProfileId ? ' me' : ''}">
            <span>${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</span>
            <span>${escapeHtml(item.emoji || '🎧')} ${escapeHtml(item.nom)}</span>
            <span class="rank-score">${Number(item.score) || 0}<small>${item.cooperation ? `+${Number(item.cooperation.contribution) || 0} équipe` : `${Number(item.session && item.session.correct) || 0}/${Number(item.session && item.session.rounds) || 0}`}</small></span>
          </div>`;
        }).join('')
      : '<div class="wait-note">Aucun joueur n’a encore rejoint.</div>');
  }

  function formatTypingText(typers) {
    if (!typers || !typers.length) return '';
    const dots = '<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
    if (typers.length === 1) {
      return `<span><strong>${escapeHtml(typers[0].nom)}</strong> est en train d'écrire ${dots}</span>`;
    }
    if (typers.length === 2) {
      return `<span><strong>${escapeHtml(typers[0].nom)}</strong> et <strong>${escapeHtml(typers[1].nom)}</strong> sont en train d'écrire ${dots}</span>`;
    }
    if (typers.length === 3) {
      return `<span><strong>${escapeHtml(typers[0].nom)}</strong>, <strong>${escapeHtml(typers[1].nom)}</strong> et <strong>${escapeHtml(typers[2].nom)}</strong> sont en train d'écrire ${dots}</span>`;
    }
    return `<span>Plusieurs personnes sont en train d'écrire ${dots}</span>`;
  }

  function renderTyping() {
    const indicator = byId('chat-typing-indicator');
    if (!indicator || !state) return;
    const typers = Array.isArray(state.typing) ? state.typing : [];
    if (typers.length > 0) {
      indicator.innerHTML = formatTypingText(typers);
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
      indicator.innerHTML = '';
    }
  }

  let lastTypingSent = 0;
  function notifyTyping() {
    const now = Date.now();
    if (party && now - lastTypingSent > 1200) {
      lastTypingSent = now;
      playerAction('typing');
    }
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
    if (suggestions) setAnswerSuggestionsOpen(false);
    playerAction('answer', { answer });
  }

  function leaveParty() {
    const leavingParty = party;
    if (leavingParty && leavingParty.code && leavingParty.playerToken) {
      void api(`/api/party/${encodeURIComponent(leavingParty.code)}/action`, {
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          playerToken: leavingParty.playerToken,
          action: 'leave',
          data: {},
        }),
      }).catch(() => {});
    }
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
        setAnswerSuggestionsOpen(false);
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
    if (event.target.closest('#palmares-open-btn') || event.target.closest('#palmares-room-btn')) showPalmares();
    if (event.target.closest('#palmares-close-btn') || event.target.closest('#palmares-close-bottom-btn')) hidePalmares();
    if (event.target.closest('#edit-profile-open-btn')) openEditProfile();
    if (event.target.closest('#edit-profile-save-btn')) saveEditProfile();
    if (event.target.closest('#edit-profile-cancel-btn')) cancelEditProfile();
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
    const intruderOption = event.target.closest('[data-intruder-option]');
    if (intruderOption) {
      playerAction('intruder-answer', {
        optionId: intruderOption.getAttribute('data-intruder-option'),
      });
      return;
    }
    const auctionBid = event.target.closest('[data-auction-bid]');
    if (auctionBid) {
      playerAction('auction-bid', { seconds: Number(auctionBid.getAttribute('data-auction-bid')) });
      return;
    }
    const confidenceBtn = event.target.closest('[data-confidence]');
    if (confidenceBtn) {
      playerAction('set-confidence', {
        multiplier: Number(confidenceBtn.getAttribute('data-confidence')),
      });
    }
    if (event.target.closest('#skip-btn')) playerAction('skip');
    if (event.target.closest('#vote-step-btn')) playerAction('vote-next-step');
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
      playerAction('request-join-team', { teamId }).then(success => {
        if (success) toast('Demande envoyée au capitaine !');
      });
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
      playerAction('create-team', { name }).then(success => {
        if (success) toast(`Équipe « ${name} » créée !`);
      });
      return;
    }

    const suggestions = byId('answer-suggestions');
    if (suggestions && !event.target.closest('.answer-search')) {
      setAnswerSuggestionsOpen(false);
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
        active = event.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length;
        setAnswerSuggestionActive(items, active);
        items[active].scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (active >= 0 && list && !list.classList.contains('hidden')) {
          event.target.value = items[active].getAttribute('data-answer-suggestion') || '';
          setAnswerSuggestionsOpen(false);
        }
        submitAnswer();
      } else if (event.key === 'Escape' && list) {
        setAnswerSuggestionsOpen(false);
      }
    }
    if (event.key === 'Enter' && event.target.id === 'gift-query') giveMusicLink();
  });

  byId('party-code').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'answer-input') {
      scheduleAnswerSuggestions();
      notifyTyping();
    }
    if (event.target.id === 'chat-input') {
      notifyTyping();
    }
  });

  byId('profile-gate').addEventListener('click', event => {
    if (event.target !== byId('profile-gate')) return;
    event.preventDefault();
    event.stopPropagation();
    toast('Choisis un profil pour continuer.');
  });

  initialize();
})();
