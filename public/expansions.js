'use strict';

// Modes supplémentaires de Songless. Ce fichier reste séparé du cœur du jeu :
// app.js lui confie le filtrage de la playlist et les débuts/fins de manche.
(function () {
  const STORAGE_COLLECTIONS = 'songless_collections';
  const STORAGE_CHALLENGES = 'songless_defis';
  const STORAGE_PARTY = 'songless_party';
  const STORAGE_PARTY_OPTIONS = 'songless_party_options';

  let collections = readLocal(STORAGE_COLLECTIONS, []);
  let challenges = readLocal(STORAGE_CHALLENGES, []);
  let selectedTrackIds = null;
  let selectedKind = null;
  let limitedGame = null;
  let party = restoreParty();
  let partyState = null;
  let pollTimer = null;
  let syncingRound = false;
  let partyRoundStarting = false;
  let hostPartyPlayTimer = null;
  let partyAutoNextTimer = null;
  let partyAutoNextSignature = '';
  let partyAutoRevealRound = null;
  let partyHighlightRound = null;
  let partyHighlightPromise = null;
  let partyLastChatId = 0;
  let partyLastReactionId = 0;
  let selectedTeamPreset = null;
  let partyTeamsSignature = '';
  let hostPlaybackSignature = '';
  let partyActionSignature = '';
  let partySuggestionTimer = null;
  let listSaveQueue = Promise.resolve();
  let partyOptions = readLocal(STORAGE_PARTY_OPTIONS, {});

  function byId(id) { return document.getElementById(id); }

  function readLocal(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function uid(prefix) {
    if (window.crypto && crypto.randomUUID) return `${prefix}${crypto.randomUUID()}`;
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeTeamColor(value, fallback = '#8b5cf6') {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function currentSelectionIds() {
    return playlist.map(track => String(track.id));
  }

  function openGameTab() {
    const btn = document.querySelector('[data-tab="game-tab"]');
    if (btn) btn.click();
  }

  function startLimited(total, kind, ids) {
    const available = Array.isArray(ids) ? ids.length : playlist.length;
    if (!available) {
      showToast('Aucun morceau dans la sélection actuelle.', 'warn');
      return false;
    }
    const isInfinite = total === 'infinite' || Number(total) <= 0;
    const rounds = isInfinite ? 'infinite' : Math.min(Math.max(1, Number(total) || 10), available || 1);
    limitedGame = {
      total: rounds,
      completed: 0,
      wins: 0,
      results: [],
      finished: false,
      kind: kind || 'format',
    };
    selectedKind = kind || null;
    selectedTrackIds = Array.isArray(ids) ? [...ids] : null;
    applySeed(randomSeed());
    updateLimitedStatus();
    openGameTab();
    return true;
  }

  function startSoloDuel(opponent) {
    const opp = opponent === 'friend' ? 'Ami local' : 'Bot Solo';
    limitedGame = {
      total: 10,
      completed: 0,
      wins: 0,
      duelScore: 0,
      kind: 'duel',
      opponent: opp,
      finished: false,
    };
    selectedKind = 'duel';
    applySeed(randomSeed());
    updateLimitedStatus();
    openGameTab();
    showToast(`Duel lancé face à ${opp} ! 🥊`);
  }

  function startSoloRoyale() {
    limitedGame = {
      total: 50,
      completed: 0,
      wins: 0,
      lives: 3,
      kind: 'royale',
      finished: false,
    };
    selectedKind = 'royale';
    applySeed(randomSeed());
    updateLimitedStatus();
    openGameTab();
    showToast('Survie Battle Royale lancée : 3 cœurs ! 💖💖💖');
  }

  function updateLimitedStatus() {
    const format = byId('format-status');
    const training = byId('training-status');
    const duelStatus = byId('solo-duel-status');
    const royaleStatus = byId('solo-royale-status');
    const playlistHint = document.querySelector('.playlist-hint');

    if (format) format.classList.remove('session-finished');
    if (training) training.classList.remove('session-finished');
    if (duelStatus) duelStatus.classList.remove('session-finished');
    if (royaleStatus) royaleStatus.classList.remove('session-finished');

    if (!limitedGame) {
      if (format) format.innerText = 'Aucune partie limitée en cours.';
      if (training) training.innerText = '';
      if (duelStatus) duelStatus.innerText = '';
      if (royaleStatus) royaleStatus.innerText = '';
      if (playlistHint) {
        if (selectedKind === 'collection') {
          const col = collections.find(c => (c.trackIds || []).length === (selectedTrackIds || []).length);
          playlistHint.innerText = col ? `dans la collection « ${col.nom} »` : `dans la collection active`;
        } else {
          playlistHint.innerText = "dans l'ordre de cette seed";
        }
      }
      return;
    }

    if (limitedGame.kind === 'royale') {
      const hearts = `${'💖'.repeat(limitedGame.lives || 0)}${'🖤'.repeat(3 - (limitedGame.lives || 0))}`;
      if (royaleStatus) {
        royaleStatus.innerText = limitedGame.finished
          ? `Survie terminée : ${limitedGame.wins} trouvés sur ${limitedGame.completed} manches.`
          : `Survie en cours · Vies : ${hearts} · Manche ${limitedGame.completed + 1}`;
        if (limitedGame.finished) royaleStatus.classList.add('session-finished');
      }
      if (playlistHint) {
        playlistHint.innerText = limitedGame.finished
          ? `· 🏁 Survie terminée (${limitedGame.wins} trouvés)`
          : `· 👑 Survie : ${hearts} · Manche ${limitedGame.completed + 1} (${limitedGame.wins} trouvés)`;
      }
      return;
    }

    if (limitedGame.kind === 'duel') {
      const scoreStr = limitedGame.duelScore < 0 ? `Camp Gauche (+${Math.abs(limitedGame.duelScore)}%)` : (limitedGame.duelScore > 0 ? `Camp Droit (+${limitedGame.duelScore}%)` : 'Égalité (0%)');
      if (duelStatus) {
        duelStatus.innerText = limitedGame.finished
          ? `Duel terminé : ${limitedGame.duelScore <= -100 ? 'Victoire !' : (limitedGame.duelScore >= 100 ? 'Défaite...' : 'Égalité')} (${limitedGame.wins}/${limitedGame.completed} trouvés)`
          : `Duel en cours face à ${limitedGame.opponent || 'Adversaire'} · ${scoreStr}`;
        if (limitedGame.finished) duelStatus.classList.add('session-finished');
      }
      if (playlistHint) {
        playlistHint.innerText = limitedGame.finished
          ? `· 🏁 Duel terminé (${scoreStr})`
          : `· 🥊 Duel : ${scoreStr} · Manche ${limitedGame.completed + 1}/${limitedGame.total}`;
      }
      return;
    }

    const target = limitedGame.kind === 'training' ? training : format;
    const label = limitedGame.kind === 'training' ? 'Entraînement' : (limitedGame.kind === 'challenge' ? 'Défi' : 'Partie');
    if (limitedGame.finished) {
      const losses = limitedGame.completed - limitedGame.wins;
      if (target) {
        target.innerText = `${label} terminée : ${limitedGame.wins} trouvé${limitedGame.wins > 1 ? 's' : ''}, ${losses} raté${losses > 1 ? 's' : ''} sur ${limitedGame.total}.`;
        target.classList.add('session-finished');
      }
      if (playlistHint) playlistHint.innerText = `· 🏁 ${label} terminée (${limitedGame.wins}/${limitedGame.total} trouvés)`;
    } else if (limitedGame.total === 'infinite') {
      if (target) target.innerText = `${label} sans fin en cours : ${limitedGame.completed} joué${limitedGame.completed > 1 ? 's' : ''} (${limitedGame.wins} trouvé${limitedGame.wins > 1 ? 's' : ''}).`;
      if (playlistHint) playlistHint.innerText = `· 🎯 ${label} sans fin (${limitedGame.wins} trouvé${limitedGame.wins > 1 ? 's' : ''})`;
    } else {
      if (target) target.innerText = `${label} en cours : ${limitedGame.completed + 1} / ${limitedGame.total}.`;
      if (playlistHint) playlistHint.innerText = `· 🎯 ${label} : ${limitedGame.completed + 1}/${limitedGame.total} (${limitedGame.wins} trouvé${limitedGame.wins > 1 ? 's' : ''})`;
    }
    if (format && target !== format) format.innerText = 'Aucune partie limitée en cours.';
    if (training && target !== training) training.innerText = '';
  }

  function trainingOrder(source) {
    const history = chargerHistorique();
    const now = Date.now();
    const summary = new Map();
    for (const round of history) {
      const key = String(round.id || '');
      if (!key) continue;
      const item = summary.get(key) || { plays: 0, misses: 0, last: 0 };
      item.plays++;
      if (round.issue !== 'win') item.misses++;
      item.last = Math.max(item.last, finiteNumber(round.ts, 0));
      summary.set(key, item);
    }

    return source.map((track, index) => {
      const item = summary.get(String(track.id));
      let priority;
      if (!item) priority = 3_000_000_000_000;
      else {
        const age = Math.max(0, now - item.last);
        const missRate = item.misses / Math.max(1, item.plays);
        priority = item.misses * 1_000_000_000_000 + missRate * 100_000_000_000 + age;
      }
      return { id: String(track.id), index, priority };
    }).sort((a, b) => b.priority - a.priority || a.index - b.index).map(item => item.id);
  }

  function syncListsToLocal() {
    writeLocal(STORAGE_COLLECTIONS, collections);
    writeLocal(STORAGE_CHALLENGES, challenges);
  }

  function saveLists() {
    syncListsToLocal();
    if (!window.songlessShared || !window.songlessShared.ready) return Promise.resolve();
    const collectionSnapshot = clone(collections);
    const challengeSnapshot = clone(challenges);
    listSaveQueue = listSaveQueue.catch(() => {}).then(async () => {
      const state = await window.songlessShared.saveLists(collectionSnapshot, challengeSnapshot);
      collections = Array.isArray(state.collections) ? state.collections : [];
      challenges = Array.isArray(state.challenges) ? state.challenges : [];
      syncListsToLocal();
    });
    return listSaveQueue;
  }

  function refreshLists(state) {
    if (state) {
      collections = Array.isArray(state.collections) ? state.collections : [];
      challenges = Array.isArray(state.challenges) ? state.challenges : [];
      syncListsToLocal();
    } else {
      collections = readLocal(STORAGE_COLLECTIONS, []);
      challenges = readLocal(STORAGE_CHALLENGES, []);
    }
    renderCollections();
    renderChallenges();
  }

  function renderCollections() {
    const zone = byId('collection-list');
    if (!zone) return;
    if (!collections.length) {
      zone.innerHTML = '<p class="empty-note">Aucune collection enregistrée.</p>';
      return;
    }
    zone.innerHTML = collections.map(item => `
      <div class="saved-row">
        <div class="saved-row-main">
          <strong>${escapeHtml(String(item.nom || 'Sans nom'))}</strong>
          <span>${(item.trackIds || []).length} morceau${(item.trackIds || []).length > 1 ? 'x' : ''}</span>
        </div>
        <button class="ghost-btn accent" data-collection-play="${escapeHtml(String(item.id))}">Jouer</button>
        <button class="danger-btn-text" data-collection-delete="${escapeHtml(String(item.id))}">Supprimer</button>
      </div>`).join('');
  }

  function renderChallenges() {
    const zone = byId('challenge-list');
    if (!zone) return;
    if (!challenges.length) {
      zone.innerHTML = '<p class="empty-note">Aucun défi enregistré.</p>';
      return;
    }
    zone.innerHTML = challenges.map(item => `
      <div class="saved-row">
        <div class="saved-row-main">
          <strong>${escapeHtml(String(item.nom || 'Sans nom'))}</strong>
          <span>${Number(item.totalRounds) || 10} manches · seed ${escapeHtml(formatSeed(String(item.seed || '')))}</span>
        </div>
        <button class="ghost-btn accent" data-challenge-play="${escapeHtml(String(item.id))}">Rejouer</button>
        <button class="danger-btn-text" data-challenge-delete="${escapeHtml(String(item.id))}">Supprimer</button>
      </div>`).join('');
  }

  function createCollection() {
    const input = byId('collection-name');
    const nom = input.value.trim();
    const ids = currentSelectionIds();
    if (!nom) return showToast('Donne un nom à la collection.', 'warn');
    if (!ids.length) return showToast('La sélection actuelle est vide.', 'warn');
    collections.push({ id: uid('c'), nom, trackIds: ids, updatedAt: new Date().toISOString() });
    input.value = '';
    saveLists().then(renderCollections).catch(error => showToast(error.message, 'error'));
  }

  function playCollection(id) {
    const item = collections.find(entry => entry.id === id);
    if (!item) return;
    selectedKind = 'collection';
    selectedTrackIds = [...(item.trackIds || [])];
    limitedGame = null;
    applySeed(randomSeed());
    updateLimitedStatus();
    openGameTab();
    showToast(`Collection « ${item.nom} » activée.`);
  }

  function currentChallenge(name) {
    return {
      id: uid('d'),
      nom: name,
      seed: currentSeed,
      genres: [...activeGenres],
      decades: [...activeDecades],
      settings: clone(reglages),
      totalRounds: limitedGame ? limitedGame.total : Number(byId('format-rounds').value) || 10,
      trackIds: currentSelectionIds(),
      updatedAt: new Date().toISOString(),
    };
  }

  function saveChallenge() {
    const input = byId('challenge-name');
    const nom = input.value.trim();
    if (!nom) return showToast('Donne un nom au défi.', 'warn');
    if (!playlist.length) return showToast('La sélection actuelle est vide.', 'warn');
    challenges.push(currentChallenge(nom));
    input.value = '';
    saveLists().then(renderChallenges).catch(error => showToast(error.message, 'error'));
  }

  function playChallenge(id) {
    const item = challenges.find(entry => entry.id === id);
    if (!item) return;
    activeGenres = new Set(Array.isArray(item.genres) ? item.genres : []);
    activeDecades = new Set(Array.isArray(item.decades) ? item.decades : []);
    reglages = { ...reglagesParDefaut(), ...(item.settings || {}) };
    selectedKind = 'challenge';
    selectedTrackIds = [...(item.trackIds || [])];
    limitedGame = {
      total: Math.min(Math.max(1, Number(item.totalRounds) || 10), selectedTrackIds.length || 1),
      completed: 0,
      wins: 0,
      results: [],
      finished: false,
      kind: 'challenge',
    };
    renderGenreChips();
    renderDecadeChips();
    appliquerReglages({ relancer: false });
    applySeed(item.seed || randomSeed());
    updateLimitedStatus();
    openGameTab();
    showToast(`Défi « ${item.nom} » chargé.`);
  }

  function removeList(kind, id) {
    const source = kind === 'collection' ? collections : challenges;
    const item = source.find(entry => entry.id === id);
    if (!item || !confirm(`Supprimer « ${item.nom} » ?`)) return;
    if (kind === 'collection') collections = collections.filter(entry => entry.id !== id);
    else challenges = challenges.filter(entry => entry.id !== id);
    saveLists().then(() => {
      renderCollections();
      renderChallenges();
    }).catch(error => showToast(error.message, 'error'));
  }

  function openQuizPrintModal() {
    const modal = byId('quiz-print-modal');
    const preview = byId('quiz-print-preview');
    if (!modal || !preview) return;

    const countInput = byId('quiz-print-rounds');
    const count = Math.min(50, Math.max(5, Number(countInput ? countInput.value : 20) || 20));

    const source = (typeof playlist !== 'undefined' && playlist && playlist.length) ? playlist : (typeof tracks !== 'undefined' ? tracks : []);
    if (!source || !source.length) {
      showToast('Aucun morceau disponible dans la bibliothèque.', 'warn');
      return;
    }

    const selected = source.slice(0, count);

    preview.innerHTML = `
      <div class="quiz-print-sheet quiz-sheet-player">
        <div class="quiz-print-header">
          <div class="quiz-print-title">🎵 Songless — Fiche Joueurs</div>
          <div class="quiz-print-meta">Date : ____________ · Équipe / Nom : ________________________ · Score : ___ / ${selected.length}</div>
        </div>
        <div class="quiz-print-grid">
          ${selected.map((t, idx) => `
            <div class="quiz-print-item">
              <div class="quiz-item-num">${idx + 1}</div>
              <div class="quiz-item-fields">
                <div class="quiz-item-line">Titre : _______________________________________________</div>
                <div class="quiz-item-line">Artiste : _____________________________________________</div>
              </div>
              <div class="quiz-item-hint">${t.genre ? `[${escapeHtml(t.genre)}]` : ''} ${t.year ? `(${t.year})` : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="quiz-print-sheet quiz-sheet-master">
        <div class="quiz-print-header">
          <div class="quiz-print-title">👑 Songless — Solutions Animateur</div>
          <div class="quiz-print-meta">Fiche de correction et ordre des morceaux (${selected.length} titres)</div>
        </div>
        <div class="quiz-print-grid">
          ${selected.map((t, idx) => `
            <div class="quiz-print-item-master">
              <span class="quiz-item-num">${idx + 1}</span>
              <div class="quiz-master-details">
                <strong>${escapeHtml(t.title)}</strong>
                <span>par <em>${escapeHtml(t.artist || 'Artiste inconnu')}</em></span>
                <small>${t.genre ? escapeHtml(t.genre) : 'Genre libre'} ${t.year ? `· ${t.year}` : ''}</small>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    if (window.songlessTrophies) window.songlessTrophies.unlock('secret_quiz_print');
  }

  function restoreParty() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_PARTY) || 'null'); }
    catch (_) { return null; }
  }

  function saveParty() {
    try {
      if (party) sessionStorage.setItem(STORAGE_PARTY, JSON.stringify(party));
      else sessionStorage.removeItem(STORAGE_PARTY);
    } catch (_) {}
  }

  function defaultPartyOptions(mode) {
    return mode === 'buzzer'
      ? {
          answer: 'titre', difficulty: 'normal', victory: 'immediate', theme: 'all',
          speed: 1, direction: 'normal', start: 'seed', excerpt: 10, points: 1500, audioFx: 'none',
        }
      : {
          answer: 'titre', difficulty: 'normal', victory: 'all_steps', theme: 'all',
          speed: 1, direction: 'normal', start: 'seed', excerpt: 15, points: 1000, audioFx: 'none',
        };
  }

  function normalizedPartyOptions(mode, value) {
    const defaults = defaultPartyOptions(mode);
    const source = value && typeof value === 'object' ? value : {};
    const oneOf = (candidate, allowed, fallback) => allowed.includes(candidate) ? candidate : fallback;
    const difficulty = oneOf(source.difficulty, ['facile', 'normal', 'hardcore'], defaults.difficulty);
    const victory = oneOf(source.victory, ['all_steps', 'immediate'], defaults.victory);
    const paliers = PALIERS_PRESETS[difficulty] || PALIERS_PRESETS.normal;
    return {
      answer: oneOf(source.answer, ['titre', 'artiste', 'annee'], defaults.answer),
      difficulty,
      victory,
      theme: String(source.theme || defaults.theme),
      paliers,
      speed: oneOf(Number(source.speed), [0.75, 1, 1.25, 1.5], defaults.speed),
      audioFx: oneOf(String(source.audioFx || 'none'), [
        'none', '8bit', 'radio', 'underwater', 'nightcore', 'slowed', 'bass',
      ], defaults.audioFx),
      direction: oneOf(source.direction, ['normal', 'inverse'], defaults.direction),
      start: oneOf(source.start, ['seed', 'refrain', 'debut'], defaults.start),
      excerpt: oneOf(Number(source.excerpt), [5, 10, 15, 30, 60], defaults.excerpt),
      points: oneOf(Number(source.points), [500, 1000, 1500, 2000], defaults.points),
      mystery: Boolean(source.mystery),
      teamsMode: Boolean(source.teamsMode),
    };
  }

  function currentPartyOptions() {
    const mode = byId('party-mode').value;
    return normalizedPartyOptions(mode, partyOptions[mode]);
  }

  function updateThemeFilterGenres() {
    const select = byId('party-theme-filter');
    if (!select || typeof playlist === 'undefined') return;
    const existingValues = new Set([...select.querySelectorAll('option')].map(o => o.value));
    const availableGenres = [...new Set((playlist || []).map(t => t && t.genre).filter(Boolean))].sort();
    for (const genre of availableGenres) {
      const val = `genre:${genre}`;
      if (!existingValues.has(val)) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `Genre : ${genre}`;
        select.appendChild(opt);
      }
    }
  }

  function renderPartyOptions() {
    updateThemeFilterGenres();
    const value = currentPartyOptions();
    const mode = byId('party-mode').value;
    byId('party-answer-mode').value = value.answer;
    if (byId('party-difficulty')) byId('party-difficulty').value = value.difficulty;
    if (byId('party-victory')) byId('party-victory').value = value.victory;
    if (byId('party-theme-filter')) byId('party-theme-filter').value = value.theme;
    if (byId('party-audio-fx')) byId('party-audio-fx').value = value.audioFx;
    byId('party-speed').value = String(value.speed);
    byId('party-direction').value = value.direction;
    byId('party-start').value = value.start;
    byId('party-excerpt').value = String(value.excerpt);
    byId('party-points').value = String(value.points);
    if (byId('party-mystery')) byId('party-mystery').value = String(Boolean(value.mystery));
    if (byId('party-teams-mode')) byId('party-teams-mode').value = String(Boolean(value.teamsMode));
    const excerptContainer = byId('party-excerpt-container');
    if (excerptContainer) excerptContainer.classList.toggle('hidden', mode !== 'buzzer');
  }

  function saveCurrentPartyOptions() {
    const mode = byId('party-mode').value;
    partyOptions[mode] = normalizedPartyOptions(mode, {
      answer: byId('party-answer-mode').value,
      difficulty: byId('party-difficulty') ? byId('party-difficulty').value : 'normal',
      victory: byId('party-victory') ? byId('party-victory').value : 'all_steps',
      theme: byId('party-theme-filter') ? byId('party-theme-filter').value : 'all',
      speed: Number(byId('party-speed').value),
      audioFx: byId('party-audio-fx') ? byId('party-audio-fx').value : 'none',
      direction: byId('party-direction').value,
      start: byId('party-start').value,
      excerpt: Number(byId('party-excerpt').value),
      points: Number(byId('party-points').value),
      mystery: byId('party-mystery') ? byId('party-mystery').value === 'true' : false,
      teamsMode: byId('party-teams-mode') ? byId('party-teams-mode').value === 'true' : false,
    });
    writeLocal(STORAGE_PARTY_OPTIONS, partyOptions);
  }

  function applyPartySettings(settings) {
    const mode = partyState ? partyState.mode : 'classic';
    const value = normalizedPartyOptions(mode, settings);
    if (mode === 'classic') {
      durations = Array.isArray(value.paliers) ? [...value.paliers] : (PALIERS_PRESETS[value.difficulty] || PALIERS_PRESETS.normal);
      reglages.paliers = [...durations];
      reglages.preset = value.difficulty || 'normal';
    } else {
      const excerpt = value.excerpt;
      durations = [excerpt, excerpt + .1, excerpt + .2, excerpt + .3, excerpt + .4, excerpt + .5];
      reglages.paliers = [...durations];
      reglages.preset = 'perso';
    }
    reglages = {
      ...reglages,
      reponse: value.answer,
      vitesse: value.speed,
      sens: value.direction,
      depart: value.start,
      fx: value.audioFx || 'none',
    };
    connectAudioChain();
    majSegmentsPaliers();
    majBoutonsOptions();
    majPlaceholderReponse();
    updateProgressSegmentsUI();
  }

  async function createParty() {
    if (!profilActif) return showToast('Choisis d’abord ton profil : le PC joue aussi.', 'warn');
    if (!playlist.length) return showToast('Aucun morceau dans la sélection.', 'warn');
    const settings = currentPartyOptions();
    let trackList = [...playlist];
    const theme = settings.theme || 'all';
    if (theme === 'favorites') {
      trackList = trackList.filter(t => t.favori || t.coupDeCoeur);
    } else if (theme.startsWith('decade:')) {
      const startDecade = parseInt(theme.split(':')[1], 10);
      if (startDecade === 1970) {
        trackList = trackList.filter(t => t.year && t.year <= 1979);
      } else {
        trackList = trackList.filter(t => t.year && t.year >= startDecade && t.year <= startDecade + 9);
      }
    } else if (theme.startsWith('genre:')) {
      const targetGenre = theme.slice(6).toLowerCase();
      trackList = trackList.filter(t => String(t.genre || '').toLowerCase() === targetGenre);
    }
    if (!trackList.length) {
      return showToast('Aucun morceau ne correspond à cette thématique dans ta sélection.', 'warn');
    }
    const trackIds = trackList.map(track => String(track.id));
    const roundChoice = byId('party-rounds').value;
    try {
      const result = await window.songlessShared.api('/api/party/create', {
        method: 'POST',
        body: JSON.stringify({
          mode: byId('party-mode').value,
          profileId: profilActif.id,
          audioFx: settings.audioFx,
          totalRounds: roundChoice === 'infinite'
            ? 'infinite'
            : Math.min(Number(roundChoice) || 10, trackIds.length),
          seed: currentSeed,
          settings,
        }),
      });
      party = {
        code: result.state.code,
        playerToken: result.playerToken,
        hostToken: result.hostToken,
        trackIds,
        previousSettings: clone(reglages),
        inviteUrls: result.inviteUrls || {},
      };
      limitedGame = null;
      saveParty();
      receivePartyState(result.state);
      startPolling();
      openGameTab();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function joinParty() {
    if (!profilActif) return showToast('Choisis ou crée d’abord un profil.', 'warn');
    const code = byId('party-code-input').value.trim().toUpperCase();
    if (code.length !== 5) return showToast('Le code contient 5 caractères.', 'warn');
    try {
      const result = await window.songlessShared.api(`/api/party/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        body: JSON.stringify({ profileId: profilActif.id }),
      });
      party = { code, playerToken: result.playerToken, hostToken: null, trackIds: [] };
      limitedGame = null;
      saveParty();
      receivePartyState(result.state);
      startPolling();
      openGameTab();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function partyUrl() {
    if (!party) return '';
    const query = new URLSearchParams({ playerToken: party.playerToken || '' });
    if (party.hostToken) query.set('hostToken', party.hostToken);
    return `/api/party/${encodeURIComponent(party.code)}?${query}`;
  }

  async function pollParty() {
    if (!party) return;
    try {
      receivePartyState(await window.songlessShared.api(partyUrl()));
    } catch (error) {
      if (/introuvable/i.test(error.message)) leaveParty();
      else console.warn('Salon multijoueur indisponible :', error.message);
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pollParty, 250);
    pollParty();
  }

  let demoActive = false;
  let demoBots = [];
  let demoTimers = [];
  let demoScheduledRound = 0;

  function clearDemoTimers() {
    for (const t of demoTimers) clearTimeout(t);
    demoTimers = [];
  }

  async function startDemoSimulation() {
    clearDemoTimers();
    if (!profilActif) {
      profilActif = (typeof profils !== 'undefined' && profils.length)
        ? profils[0]
        : { id: 'p_demo_host', nom: 'Manaël', emoji: '🎧' };
    }
    const available = (playlist && playlist.length) ? playlist : (tracks && tracks.length ? tracks : []);
    if (!available.length) {
      return showToast('Charge ou ajoute d’abord des musiques dans ta bibliothèque.', 'warn');
    }

    const settings = currentPartyOptions();
    const allIds = available.map(t => String(t.id));
    const trackIds = allIds.slice(0, 2);
    if (!trackIds.length) return showToast('Aucun morceau disponible dans la sélection.', 'warn');

    showToast('🤖 Lancement de la démo simulée à 6 joueurs…', 'info');

    try {
      const result = await window.songlessShared.api('/api/party/create', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'classic',
          profileId: profilActif.id,
          audioFx: settings.audioFx,
          totalRounds: Math.min(2, trackIds.length),
          seed: currentSeed,
          settings,
          demo: true,
        }),
      });

      party = {
        code: result.state.code,
        playerToken: result.playerToken,
        hostToken: result.hostToken,
        trackIds,
        previousSettings: clone(reglages),
        inviteUrls: result.inviteUrls || {},
      };
      limitedGame = null;
      demoActive = true;
      demoBots = Array.isArray(result.demoBots) && result.demoBots.length
        ? result.demoBots
        : [
            { nom: 'Sarah', emoji: '⚡', persona: 'fast' },
            { nom: 'Lucas', emoji: '🚀', persona: 'quick' },
            { nom: 'Chloé', emoji: '🌸', persona: 'balanced' },
            { nom: 'Thomas', emoji: '🛡️', persona: 'clutch' },
            { nom: 'Alexandre', emoji: '🎰', persona: 'guesser' },
          ];
      demoScheduledRound = 0;
      saveParty();
      receivePartyState(result.state);
      startPolling();
      openGameTab();

      showToast('👥 5 bots virtuels connectés ! Lancement de la manche…', 'ok');

      const startTimer = setTimeout(() => {
        if (party && partyState && partyState.status === 'lobby') {
          startPartyRound();
        }
      }, 1500);
      demoTimers.push(startTimer);
    } catch (error) {
      showToast(`Erreur démo : ${error.message}`, 'error');
    }
  }

  function scheduleDemoBotActions(round) {
    if (!demoActive || !party || !partyState || partyState.status !== 'round') return;
    if (demoScheduledRound === round) return;
    demoScheduledRound = round;
    clearDemoTimers();

    const currentTrackId = partyState.currentTrackId;
    const currentTrack = (tracks && tracks.find(item => String(item.id) === String(currentTrackId)))
      || (playlist && playlist.find(item => String(item.id) === String(currentTrackId)));
    const targetTitle = currentTrack ? (currentTrack.title || currentTrack.titre || '') : '';
    if (!targetTitle) return;

    for (const bot of demoBots) {
      if (bot.persona === 'fast') {
        const t1 = setTimeout(async () => {
          if (!party || !demoActive) return;
          try {
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'answer', data: { answer: targetTitle } }),
            });
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'chat', data: { message: 'Facile celle-là ! ⚡' } }),
            });
          } catch (_) {}
        }, 1200);
        demoTimers.push(t1);
      } else if (bot.persona === 'quick') {
        const t1 = setTimeout(async () => {
          if (!party || !demoActive) return;
          try {
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'skip' }),
            });
          } catch (_) {}
        }, 1500);
        const t2 = setTimeout(async () => {
          if (!party || !demoActive) return;
          try {
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'answer', data: { answer: targetTitle } }),
            });
          } catch (_) {}
        }, 2500);
        demoTimers.push(t1, t2);
      } else if (bot.persona === 'balanced') {
        const t1 = setTimeout(async () => {
          if (!party || !demoActive) return;
          try {
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'skip' }),
            });
            await new Promise(r => setTimeout(r, 150));
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'skip' }),
            });
            await new Promise(r => setTimeout(r, 150));
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'answer', data: { answer: targetTitle } }),
            });
          } catch (_) {}
        }, 3600);
        demoTimers.push(t1);
      } else if (bot.persona === 'guesser') {
        const t1 = setTimeout(async () => {
          if (!party || !demoActive) return;
          try {
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'answer', data: { answer: 'Mauvais titre' } }),
            });
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'chat', data: { message: 'Ah non pas ça ! 🎰' } }),
            });
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'skip' }),
            });
            await new Promise(r => setTimeout(r, 150));
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'answer', data: { answer: targetTitle } }),
            });
          } catch (_) {}
        }, 4800);
        demoTimers.push(t1);
      } else if (bot.persona === 'clutch') {
        const t1 = setTimeout(async () => {
          if (!party || !demoActive) return;
          try {
            for (let i = 0; i < 5; i++) {
              await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
                method: 'POST',
                body: JSON.stringify({ playerToken: bot.playerToken, action: 'skip' }),
              });
              await new Promise(r => setTimeout(r, 120));
            }
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'answer', data: { answer: targetTitle } }),
            });
            await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
              method: 'POST',
              body: JSON.stringify({ playerToken: bot.playerToken, action: 'chat', data: { message: 'Sauvé au dernier extrait 🛡️' } }),
            });
          } catch (_) {}
        }, 5800);
        demoTimers.push(t1);
      }
    }

    const tHost = setTimeout(async () => {
      if (!party || !demoActive || !partyState || partyState.status !== 'round') return;
      const me = partyState.players.find(p => p.profileId === partyState.viewerProfileId);
      if (me && !me.found && !me.finished) {
        try {
          await partyPlayerAction('answer', { answer: targetTitle });
        } catch (_) {}
      }
    }, 2000);
    demoTimers.push(tHost);
  }

  function receivePartyState(next) {
    const previousTrack = partyState && partyState.currentTrackId;
    partyState = next;
    if (next.status === 'finished') syncPartyGlobalStats(next.players);
    renderParty();
    if (next.status === 'round' && next.currentTrackId && next.currentTrackId !== previousTrack) {
      syncPartyRound(next.currentTrackId);
    } else if (next.status === 'round' && next.currentTrackId) {
      syncHostPartyPlayback(next);
    }
    if (demoActive && next.status === 'round' && next.currentTrackId) {
      scheduleDemoBotActions(next.round);
    }
    if (demoActive && next.status === 'reveal') {
      clearDemoTimers();
      const tNext = setTimeout(() => {
        if (!demoActive || !party || !partyState) return;
        if (partyState.round < partyState.totalRounds) {
          startPartyRound();
        } else {
          partyCommand('finish').catch(showPartyError);
        }
      }, 4500);
      demoTimers.push(tNext);
    }
    if (next.status === 'round' && next.isHost
        && (next.roundDecision === 'skip' || next.roundDecision === 'solved' || next.roundDecision === 'all_finished' || (next.buzzer || {}).solvedByProfileId)) {
      autoRevealParty(next.roundDecision === 'skip' ? 'skip' : 'correct');
    }
    if (next.status === 'reveal' && next.revealedTrack) {
      revealPartyTrack();
      syncHostPartyPlayback(next);
    }
    schedulePartyAutoNext(next);
  }

  function openGameTab() {
    const button = document.querySelector('.tab-btn[data-tab="game-tab"]');
    if (button && !button.classList.contains('active')) button.click();
  }

  function syncPartyGlobalStats(players) {
    if (typeof profils === 'undefined' || !Array.isArray(players)) return;
    let changed = false;
    for (const player of players) {
      const profile = profils.find(item => item.id === player.profileId);
      if (!profile || !player.globalStats) continue;
      profile.multiplayer = clone(player.globalStats);
      changed = true;
    }
    if (!changed) return;
    sauverProfils();
    const modal = byId('profile-modal');
    if (modal && !modal.classList.contains('hidden')) renderProfileList();
  }

  async function preparePartyTrack(trackId) {
    const source = (party && party.trackIds && party.trackIds.length) ? party.trackIds : null;
    selectedKind = 'party';
    selectedTrackIds = source;
    rebuildPlaylist({ keepCurrent: false });
    let index = playlist.findIndex(track => String(track.id) === String(trackId));
    if (index < 0) {
      const track = tracks.find(item => String(item.id) === String(trackId));
      if (!track) return;
      playlist = [track];
      index = 0;
    }
    playlistIndex = index;
    applyPartySettings(partyState.settings);
    if (partyState.status !== 'round'
        || !currentTrack || String(currentTrack.id) !== String(trackId)) {
      syncingRound = true;
      startNewGame();
      guessInputContainer.classList.add('hidden');
      syncingRound = false;
    }
    await preparerExtrait(currentTrack);
    return currentTrackOffset;
  }

  async function syncPartyRound(trackId) {
    try {
      await preparePartyTrack(trackId);
      primePartyHighlight(currentTrack, partyState.round);
      syncHostPartyPlayback(partyState, true);
    } catch (error) {
      showPartyError(error);
    }
  }

  function syncHostPartyPlayback(next, force = false) {
    if (!next || !['round', 'reveal'].includes(next.status)
        || !next.playback || !currentTrack) return;
    const playback = next.playback;
    const signature = `${next.round}:${next.status}:${Number(playback.startedAt) || 0}:${Number(playback.pausedAt) || 0}:${Number(playback.duration) || 0}:${(next.buzzer || {}).solvedByProfileId || ''}`;
    if (!force && signature === hostPlaybackSignature) return;
    hostPlaybackSignature = signature;
    clearTimeout(hostPartyPlayTimer);

    if (playback.pausedAt) {
      pauseAudio();
      playerStatusText.classList.remove('hidden');
      playerStatusText.innerText = 'Musique en pause pendant la réponse…';
      return;
    }

    const receivedAt = Date.now();
    const serverAtReceipt = Number(next.serverNow) || receivedAt;
    const estimatedServerNow = () => serverAtReceipt + (Date.now() - receivedAt);
    const delay = Math.max(0, Number(playback.startedAt) - serverAtReceipt);
    playerStatusText.classList.remove('hidden');
    playerStatusText.innerText = next.status === 'reveal'
      ? 'Passage connu synchronisé avec les téléphones…'
      : delay > 0
        ? 'Départ synchronisé avec les téléphones…'
        : 'Reprise synchronisée de l’extrait…';
    hostPartyPlayTimer = setTimeout(() => {
      if (!partyState || partyState.status !== next.status || partyState.round !== next.round) return;
      partyState.serverNow = Math.max(Number(partyState.serverNow) || 0,
        Number(playback.startedAt) || 0);
      renderPlayerActions();
      currentTrackOffset = Number(playback.offset) || 0;
      const elapsed = Math.max(0,
        (estimatedServerNow() - Number(playback.startedAt)) / 1000
        * (Number(playback.speed) || 1));
      const sync = {
        offset: Number(playback.offset) || 0,
        duration: Number(playback.duration) || 0,
        elapsed,
      };
      if (next.status === 'reveal' || playback.reveal) jouerPassageResultat(sync);
      else playAudio(sync);
    }, delay);
  }

  function primePartyHighlight(track, round) {
    if (!track || partyHighlightRound === round) return partyHighlightPromise;
    partyHighlightRound = round;
    partyHighlightPromise = preparerPassageConnu(track)
      .catch(() => currentTrackOffset);
    return partyHighlightPromise;
  }

  async function partyHighlightOffset(round) {
    const fallback = Number(currentTrackOffset) || 0;
    const promise = primePartyHighlight(currentTrack, round);
    if (!promise) return fallback;
    return Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(fallback), 900)),
    ]);
  }

  async function autoRevealParty(reason) {
    if (!partyState || !partyState.isHost || partyState.status !== 'round') return;
    const round = partyState.round;
    if (partyAutoRevealRound === round) return;
    partyAutoRevealRound = round;
    try {
      const highlightOffset = await partyHighlightOffset(round);
      if (!partyState || partyState.status !== 'round' || partyState.round !== round) return;
      await partyCommand('reveal', {
        track: {
          title: currentTrack.title,
          originalTitle: currentTrack.originalTitle,
          artist: currentTrack.artist,
          genre: currentTrack.genre,
        },
        highlightOffset,
        highlightDuration: 5,
        autoNext: true,
        reason,
      });
    } catch (error) {
      partyAutoRevealRound = null;
      showPartyError(error);
    }
  }

  function schedulePartyAutoNext(next) {
    if (!next || !next.isHost || next.status !== 'reveal' || !next.autoNextAt) {
      clearTimeout(partyAutoNextTimer);
      partyAutoNextTimer = null;
      partyAutoNextSignature = '';
      return;
    }
    const signature = `${next.round}:${next.autoNextAt}`;
    if (signature === partyAutoNextSignature) return;
    partyAutoNextSignature = signature;
    clearTimeout(partyAutoNextTimer);
    const delay = Math.max(0, Number(next.autoNextAt) - Number(next.serverNow));
    partyAutoNextTimer = setTimeout(() => {
      if (!partyState || partyState.status !== 'reveal' || partyState.round !== next.round) return;
      startPartyRound();
    }, delay);
  }

  function revealPartyTrack() {
    if (!currentTrack) return;
    if (!resultCard.classList.contains('hidden')) return;
    pauseAudio();
    guessInputContainer.classList.add('hidden');
    resultCard.classList.remove('hidden');
    modeRevelation(true);
    const me = partyState.players.find(player => player.profileId === partyState.viewerProfileId);
    const won = Boolean(me && me.correct);
    const icon = byId('party-result-icon');
    icon.innerText = won ? '🏆' : '❌';
    icon.classList.remove('hidden');
    byId('result-title').innerText = won ? 'Gagné !' : 'Perdu pour cette manche';
    byId('result-subtitle').innerText = partyState.autoNextAt
      ? 'Passage connu… prochaine manche dans 5 secondes.'
      : 'Passage connu du morceau.';
    remplirFicheResultat();
    updateRevealPlayer();
  }

  function renderParty() {
    const appContainer = document.querySelector('.app-container');
    if (appContainer) appContainer.classList.toggle('party-active', Boolean(party && partyState));
    const runningNote = byId('party-running-note');
    if (runningNote) runningNote.classList.toggle('hidden', !(party && partyState));
    if (!party || !partyState) {
      byId('party-setup').classList.remove('hidden');
      byId('party-room').classList.add('hidden');
      return;
    }
    byId('party-setup').classList.add('hidden');
    byId('party-room').classList.remove('hidden');
    byId('party-code').innerText = partyState.code;
    byId('party-round-label').innerText = partyState.status === 'finished'
      ? 'Partie terminée'
      : partyState.status === 'lobby'
        ? 'Salon'
        : partyState.infinite
          ? `Manche ${partyState.round} · Infini`
          : `Manche ${partyState.round} / ${partyState.totalRounds}`;

    const invites = byId('party-invites');
    const internetButton = byId('party-copy-internet');
    const internetLink = byId('party-internet-link');
    const internetUrl = party.inviteUrls && typeof party.inviteUrls.internet === 'string'
      && party.inviteUrls.internet.startsWith('https://')
      ? party.inviteUrls.internet
      : '';
    invites.classList.toggle('hidden', !partyState.isHost);
    byId('party-copy-lan').disabled = !(party.inviteUrls && party.inviteUrls.lan);
    internetButton.disabled = !internetUrl;
    internetButton.innerText = internetButton.disabled ? 'Lien Internet non activé' : 'Copier le lien Internet sécurisé';
    internetLink.classList.toggle('hidden', !internetUrl);
    internetLink.href = internetUrl || '#';
    internetLink.innerText = internetUrl ? `Lien à envoyer : ${internetUrl}` : '';

    renderPartyPodium(partyState);
    renderPartyTeams();
    renderPartyModifier();
    renderPartyReactions();
    renderPartyDuel(partyState);

    byId('party-players').innerHTML = partyState.players.map(player => {
      const team = (partyState.teams || []).find(t => t.id === player.teamId);
      const teamColor = safeTeamColor(team && team.color, '#a855f7');
      const teamPill = team ? `<span class="player-team-pill" style="border-color:${teamColor}; background:${teamColor}20; color:${teamColor}">${escapeHtml(team.emoji || '👥')} ${escapeHtml(team.name)}</span>` : '';
      return `
        <div class="party-player${player.profileId === partyState.viewerProfileId ? ' me' : ''}${player.found ? ' player-found' : ''}">
          <div class="party-player-info">
            <span class="party-player-name">${escapeHtml(String(player.emoji || '🎧'))} ${escapeHtml(String(player.nom || 'Joueur'))}${player.host ? ' · hôte' : ''} ${teamPill}</span>
            ${renderLiveStepPills(player, partyState)}
          </div>
          <span class="party-answer">${partyAnswerLabel(player)} · session ${Number(player.session && player.session.correct) || 0}/${Number(player.session && player.session.rounds) || 0}</span>
          <span class="party-score">${Number(player.score) || 0} pt<small>${Number(player.globalStats && player.globalStats.wins) || 0} victoire${Number(player.globalStats && player.globalStats.wins) > 1 ? 's' : ''} globale${Number(player.globalStats && player.globalStats.wins) > 1 ? 's' : ''}</small></span>
        </div>`;
    }).join('');
    renderPartyChat();

    byId('party-host-actions').classList.toggle('hidden', !partyState.isHost);
    byId('party-round-btn').disabled = partyRoundStarting
      || partyState.status === 'round' || partyState.status === 'finished';
    byId('party-round-btn').innerText = !partyState.infinite
      && partyState.round >= partyState.totalRounds
      ? 'Terminer la partie'
      : partyState.round > 0 ? 'Manche suivante' : 'Lancer la manche';
    byId('party-reveal-btn').disabled = partyState.status !== 'round';
    renderPlayerActions();
    renderPartyVotes();
  }

  function renderPartyDuel(partyState) {
    const container = byId('party-duel-container');
    if (!container) return;
    if (!partyState || partyState.mode !== 'duel') {
      container.classList.add('hidden');
      return;
    }
    container.classList.remove('hidden');

    const teams = partyState.teams || [];
    let nameA = 'Camp A', nameB = 'Camp B';
    let badgeA = '🔴', badgeB = '🔵';
    let scoreA = 0, scoreB = 0;

    if (teams.length >= 2) {
      nameA = teams[0].name;
      badgeA = teams[0].emoji || '🔴';
      scoreA = partyState.players.filter(p => p.teamId === teams[0].id).reduce((s, p) => s + (p.score || 0), 0);
      nameB = teams[1].name;
      badgeB = teams[1].emoji || '🔵';
      scoreB = partyState.players.filter(p => p.teamId === teams[1].id).reduce((s, p) => s + (p.score || 0), 0);
    } else if (partyState.players && partyState.players.length >= 2) {
      const p1 = partyState.players[0];
      const p2 = partyState.players[1];
      nameA = p1.nom;
      badgeA = p1.emoji || '🔴';
      scoreA = p1.score || 0;
      nameB = p2.nom;
      badgeB = p2.emoji || '🔵';
      scoreB = p2.score || 0;
    }

    if (byId('duel-team-a-name')) byId('duel-team-a-name').innerText = nameA;
    if (byId('duel-team-a-badge')) byId('duel-team-a-badge').innerText = badgeA;
    if (byId('duel-team-a-score')) byId('duel-team-a-score').innerText = `${scoreA} pts`;

    if (byId('duel-team-b-name')) byId('duel-team-b-name').innerText = nameB;
    if (byId('duel-team-b-badge')) byId('duel-team-b-badge').innerText = badgeB;
    if (byId('duel-team-b-score')) byId('duel-team-b-score').innerText = `${scoreB} pts`;

    const score = Math.min(100, Math.max(-100, Number(partyState.duelScore) || 0));
    const positionPercent = 50 + (score / 2);
    const knot = byId('duel-rope-knot');
    if (knot) knot.style.left = `${positionPercent}%`;

    const sub = byId('duel-status-subtext');
    if (sub) {
      if (score <= -90) sub.innerText = `🏆 Victoire imminente pour ${nameA} !`;
      else if (score >= 90) sub.innerText = `🏆 Victoire imminente pour ${nameB} !`;
      else sub.innerText = 'Trouve plus vite pour tirer la corde vers ton camp !';
    }
  }

  function renderPartyModifier() {
    const banner = byId('party-modifier-banner');
    if (!banner) return;
    if (partyState && partyState.status === 'round' && partyState.roundModifier) {
      const mod = partyState.roundModifier;
      banner.innerHTML = `
        <div class="modifier-badge-content">
          <span class="modifier-icon">🃏</span>
          <div class="modifier-texts">
            <strong>${escapeHtml(mod.name)}</strong>
            <span>${escapeHtml(mod.desc)}</span>
          </div>
          <span class="modifier-multiplier">×${mod.multiplier || 1}</span>
        </div>
      `;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
      banner.innerHTML = '';
    }
  }

  function spawnFloatingReaction(emoji, senderNom) {
    const overlay = byId('party-reactions-overlay');
    if (!overlay) return;
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    const left = Math.round(15 + Math.random() * 70);
    el.style.left = `${left}%`;
    el.innerHTML = `<span class="floating-emoji">${escapeHtml(emoji)}</span><small class="floating-sender">${escapeHtml(senderNom || '')}</small>`;
    overlay.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2200);
  }

  function renderPartyReactions() {
    if (!partyState || !Array.isArray(partyState.reactions)) return;
    const newReactions = partyState.reactions.filter(r => Number(r.id) > partyLastReactionId);
    if (newReactions.length) {
      newReactions.forEach(r => spawnFloatingReaction(r.emoji, r.nom));
      partyLastReactionId = Math.max(...partyState.reactions.map(r => Number(r.id) || 0));
    }
  }

  function renderPartyTeams() {
    const panel = byId('party-team-panel');
    if (!panel) return;
    const teams = (partyState && partyState.teams) || [];
    const show = Boolean(partyState && (teams.length > 0 || (partyState.settings && partyState.settings.teamsMode) || partyState.status === 'lobby'));
    if (!show || !partyState) {
      panel.classList.add('hidden');
      partyTeamsSignature = '';
      return;
    }
    panel.classList.remove('hidden');
    const countEl = byId('team-count-label');
    if (countEl) countEl.innerText = teams.length;

    const hostBtns = byId('team-host-btns');
    if (hostBtns) hostBtns.classList.toggle('hidden', !partyState.isHost);

    const grid = byId('party-teams-grid');
    if (!grid) return;

    // Évite de détruire le <select> du DOM toutes les 250 ms quand l'utilisateur clique dessus
    const activeSelect = document.activeElement && document.activeElement.classList.contains('team-assign-select');
    const signature = `${partyState.isHost ? 'H' : 'P'}|${teams.map(t => `${t.id}:${t.name}:${t.score}:${t.captainProfileId}:${(t.members || []).map(m => `${m.profileId}:${m.score}:${m.locked}`).join(',')}`).join(';')}|${partyState.players.map(p => `${p.profileId}:${p.teamId}`).join(',')}`;
    if (signature === partyTeamsSignature || activeSelect) return;
    partyTeamsSignature = signature;

    if (!teams.length) {
      grid.innerHTML = '<div class="teams-empty">Aucune équipe créée. Cliquez sur « ➕ Créer une équipe » ou « 🎲 Répartir aléatoirement ».</div>';
      return;
    }

    grid.innerHTML = teams.map(team => {
      const members = team.members || [];
      const teamColor = safeTeamColor(team.color, '#8b5cf6');
      const teamColorStrong = safeTeamColor(team.color, '#a855f7');
      return `
        <div class="team-card" style="border-color: ${teamColor}44;">
          <div class="team-card-header" style="background: ${teamColor}22;">
            <div class="team-title-group">
              <span class="team-emoji">${escapeHtml(team.emoji || '👥')}</span>
              <div>
                <strong class="team-name" style="color: ${teamColorStrong};">${escapeHtml(team.name)}</strong>
                <small class="team-captain">👑 ${escapeHtml(team.captainNom || 'Capitaine')}</small>
              </div>
            </div>
            <div class="team-header-right">
              <span class="team-score-badge">${team.score || 0} pts</span>
              ${partyState.isHost ? `<button type="button" class="team-del-btn" data-team-del="${team.id}" title="Supprimer l'équipe">✕</button>` : ''}
            </div>
          </div>
          <div class="team-members-list">
            ${members.length ? members.map(m => `
              <div class="team-member-item">
                <span>${escapeHtml(m.emoji || '🎧')} ${escapeHtml(m.nom)}${m.locked ? ' <small title="Assigné par l’hôte">🔒</small>' : ''}</span>
                <div class="team-member-actions">
                  <span class="team-member-pts">${m.score || 0} pt</span>
                  ${partyState.isHost ? `<button type="button" class="team-unassign-btn" data-team-unassign="${m.profileId}" title="Retirer de l'équipe">✕</button>` : ''}
                </div>
              </div>`).join('') : '<span class="team-no-members">Aucun joueur</span>'}
          </div>
          ${partyState.isHost ? `
            <div class="team-host-assign">
              <select class="team-assign-select" data-team-target="${team.id}" aria-label="Ajouter un joueur">
                <option value="">➕ Assigner un joueur…</option>
                ${partyState.players.filter(p => String(p.teamId) !== String(team.id)).map(p => `<option value="${p.profileId}">${escapeHtml(p.emoji || '🎧')} ${escapeHtml(p.nom || 'Joueur')}</option>`).join('')}
              </select>
            </div>` : ''}
        </div>
      `;
    }).join('');
  }

  function generatePartySouvenirText(partyState) {
    if (!partyState) return '';
    const sorted = [...partyState.players].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const winner = sorted[0];
    const teams = partyState.teams || [];
    const winningTeam = teams.length ? [...teams].sort((a, b) => (b.score || 0) - (a.score || 0))[0] : null;

    let text = `🎵 ═════ BILAN DE SOIRÉE SONGLESS ═════ 🎵\n`;
    text += `📅 Date : ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n`;
    text += `🎮 Manches jouées : ${partyState.round} | Mode : ${partyState.mode === 'buzzer' ? 'Buzzer' : 'Réponses simultanées'}\n\n`;

    if (winner) {
      text += `🏆 VAINQUEUR INDIVIDUEL :\n`;
      text += `   🥇 ${winner.emoji || '🎧'} ${winner.nom} — ${winner.score || 0} pts\n\n`;
    }

    if (winningTeam && winningTeam.score > 0) {
      text += `👑 ÉQUIPE CHAMPIONNE :\n`;
      text += `   ${winningTeam.emoji || '👥'} ${winningTeam.name} — ${winningTeam.score || 0} pts\n\n`;
    }

    text += `📊 PODIUM COMPLET :\n`;
    sorted.slice(0, 6).forEach((p, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
      text += `   ${medal} ${p.emoji || '🎧'} ${p.nom} : ${p.score || 0} pts (${p.session ? p.session.correct : 0}/${p.session ? p.session.rounds : 0} trouvés)\n`;
    });

    text += `\n✨ DISTINCTIONS :\n`;
    const lightning = [...partyState.players].sort((a, b) => (b.accolades && b.accolades.lightningWins || 0) - (a.accolades && a.accolades.lightningWins || 0))[0];
    const fastest = [...partyState.players].sort((a, b) => (b.accolades && b.accolades.firstCorrectCount || 0) - (a.accolades && a.accolades.firstCorrectCount || 0))[0];
    if (lightning && (lightning.accolades && lightning.accolades.lightningWins || 0) > 0) {
      text += `   ⚡ L'Éclair (0.2s) : ${lightning.nom} (${lightning.accolades.lightningWins}x)\n`;
    }
    if (fastest && (fastest.accolades && fastest.accolades.firstCorrectCount || 0) > 0) {
      text += `   🚀 Le Plus Rapide : ${fastest.nom} (${fastest.accolades.firstCorrectCount}x 1er)\n`;
    }

    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🎉 Joué sur Songless · https://manapattes.fr`;
    return text;
  }

  function renderLiveStepPills(player, partyState) {
    if (!partyState || partyState.mode !== 'classic' || partyState.status !== 'round') return '';
    const paliers = partyState.paliers || [0.2, 0.7, 2.5, 5, 9, 15];
    const currentAttempt = Number(player.currentAttempt) || 0;
    const attempts = Array.isArray(player.attempts) ? player.attempts : [];
    return `<div class="party-live-steps" title="Essai ${Math.min(paliers.length, currentAttempt + 1)} / ${paliers.length}">
      ${paliers.map((dur, i) => {
        const att = attempts[i];
        let stateClass = 'pending';
        let char = '○';
        if (att) {
          if (att.type === 'success') { stateClass = 'success'; char = '✓'; }
          else if (att.type === 'skipped') { stateClass = 'skipped'; char = '↷'; }
          else { stateClass = 'failed'; char = '✕'; }
        } else if (i === currentAttempt && !player.finished && !player.found) {
          stateClass = 'current';
          char = '●';
        }
        return `<span class="party-live-step ${stateClass}" title="${dur} s">${char}</span>`;
      }).join('')}
    </div>`;
  }

  function renderPartyPodium(partyState) {
    const container = byId('party-podium');
    if (!container) return;
    if (!partyState || partyState.status !== 'finished') {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    const sorted = [...partyState.players].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    if (!sorted.length) return;

    const first = sorted[0];
    const second = sorted[1];
    const third = sorted[2];

    const teams = partyState.teams || [];
    const sortedTeams = [...teams].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).filter(t => (t.membersCount || 0) > 0);

    const players = partyState.players;
    const lightningWinner = [...players].sort((a, b) => (b.accolades && b.accolades.lightningWins || 0) - (a.accolades && a.accolades.lightningWins || 0))[0];
    const clutchWinner = [...players].sort((a, b) => (b.accolades && b.accolades.clutchWins || 0) - (a.accolades && a.accolades.clutchWins || 0))[0];
    const guessWinner = [...players].sort((a, b) => (b.accolades && b.accolades.totalGuesses || 0) - (a.accolades && a.accolades.totalGuesses || 0))[0];
    const firstGuesser = [...players].sort((a, b) => (b.accolades && b.accolades.firstCorrectCount || 0) - (a.accolades && a.accolades.firstCorrectCount || 0))[0];

    container.innerHTML = `
      <div class="podium-card">
        <div class="podium-header">
          <span class="podium-crown">👑</span>
          <h3>Podium de la soirée</h3>
        </div>

        ${sortedTeams.length ? `
          <div class="team-podium-section">
            <h4 class="team-podium-title">🏆 Classement des Équipes</h4>
            <div class="team-podium-cards">
              ${sortedTeams.map((team, tIdx) => `
                <div class="team-podium-card rank-${tIdx + 1}" style="border-color: ${safeTeamColor(team.color, '#a855f7')}; background: ${safeTeamColor(team.color, '#a855f7')}18;">
                  <span class="team-podium-medal">${tIdx === 0 ? '🥇' : tIdx === 1 ? '🥈' : tIdx === 2 ? '🥉' : `${tIdx + 1}e`}</span>
                  <div class="team-podium-name" style="color: ${safeTeamColor(team.color, '#a855f7')};">${escapeHtml(team.emoji || '👥')} ${escapeHtml(team.name)}</div>
                  <strong class="team-podium-score">${team.score || 0} pts</strong>
                  <small class="team-podium-members">${(team.members || []).map(m => escapeHtml(m.nom)).join(', ')}</small>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="podium-stages">
          ${second ? `
            <div class="podium-step step-2">
              <span class="podium-medal">🥈</span>
              <div class="podium-avatar">${escapeHtml(String(second.emoji || '🎧'))}</div>
              <span class="podium-name">${escapeHtml(String(second.nom))}</span>
              <span class="podium-pts">${Number(second.score) || 0} pts</span>
              <div class="podium-bar">2</div>
            </div>` : ''}
          <div class="podium-step step-1">
            <span class="podium-medal">🥇</span>
            <div class="podium-avatar">${escapeHtml(String(first.emoji || '🎧'))}</div>
            <span class="podium-name">${escapeHtml(String(first.nom))}</span>
            <span class="podium-pts">${Number(first.score) || 0} pts</span>
            <div class="podium-bar">1</div>
          </div>
          ${third ? `
            <div class="podium-step step-3">
              <span class="podium-medal">🥉</span>
              <div class="podium-avatar">${escapeHtml(String(third.emoji || '🎧'))}</div>
              <span class="podium-name">${escapeHtml(String(third.nom))}</span>
              <span class="podium-pts">${Number(third.score) || 0} pts</span>
              <div class="podium-bar">3</div>
            </div>` : ''}
        </div>
        <div class="podium-accolades">
          ${lightningWinner && (lightningWinner.accolades && lightningWinner.accolades.lightningWins || 0) > 0 ? `
            <div class="accolade-badge">
              <span class="accolade-icon">⚡</span>
              <div class="accolade-info">
                <strong>L’Éclair</strong>
                <small>${escapeHtml(String(lightningWinner.nom))} (${lightningWinner.accolades.lightningWins}x à 0,2 s)</small>
              </div>
            </div>` : ''}
          ${firstGuesser && (firstGuesser.accolades && firstGuesser.accolades.firstCorrectCount || 0) > 0 ? `
            <div class="accolade-badge">
              <span class="accolade-icon">🚀</span>
              <div class="accolade-info">
                <strong>Le Rapide</strong>
                <small>${escapeHtml(String(firstGuesser.nom))} (${firstGuesser.accolades.firstCorrectCount}x 1er)</small>
              </div>
            </div>` : ''}
          ${clutchWinner && (clutchWinner.accolades && clutchWinner.accolades.clutchWins || 0) > 0 ? `
            <div class="accolade-badge">
              <span class="accolade-icon">🛡️</span>
              <div class="accolade-info">
                <strong>Le Survivant</strong>
                <small>${escapeHtml(String(clutchWinner.nom))} (${clutchWinner.accolades.clutchWins}x au 6e palier)</small>
              </div>
            </div>` : ''}
          ${guessWinner && (guessWinner.accolades && guessWinner.accolades.totalGuesses || 0) >= 3 ? `
            <div class="accolade-badge">
              <span class="accolade-icon">🎰</span>
              <div class="accolade-info">
                <strong>Le Mitrailleur</strong>
                <small>${escapeHtml(String(guessWinner.nom))} (${guessWinner.accolades.totalGuesses} tentatives)</small>
              </div>
            </div>` : ''}
        </div>
        <div class="podium-leaderboard">
          <div class="leaderboard-title">Classement individuel</div>
          <div class="leaderboard-table">
            ${sorted.map((player, index) => {
              const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
              const correct = Number(player.session && player.session.correct) || 0;
              const rounds = Number(player.session && player.session.rounds) || 0;
              const percent = rounds > 0 ? Math.round((correct / rounds) * 100) : 0;
              let badgeTag = '';
              if (player.accolades && player.accolades.lightningWins > 0) {
                badgeTag = `<span class="player-badge-chip">⚡ ${player.accolades.lightningWins}x 0,2s</span>`;
              } else if (player.accolades && player.accolades.firstCorrectCount > 0) {
                badgeTag = `<span class="player-badge-chip">🚀 ${player.accolades.firstCorrectCount}x 1er</span>`;
              }
              return `
                <div class="leaderboard-row${player.profileId === partyState.viewerProfileId ? ' me' : ''}">
                  <div class="leaderboard-rank">${rankEmoji}</div>
                  <div class="leaderboard-player">
                    <span class="leaderboard-avatar">${escapeHtml(String(player.emoji || '🎧'))}</span>
                    <div class="leaderboard-name-block">
                      <span class="leaderboard-name">${escapeHtml(String(player.nom))}${player.host ? ' <small class="host-tag">hôte</small>' : ''}</span>
                      ${badgeTag}
                    </div>
                  </div>
                  <div class="leaderboard-stats">
                    <span class="leaderboard-ratio">${correct}/${rounds} (${percent}%)</span>
                    <strong class="leaderboard-points">${Number(player.score) || 0} pts</strong>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
        <div class="podium-share-row">
          <button type="button" class="cta-btn souvenir-share-btn" id="copy-souvenir-card-btn">
            📋 Copier la carte souvenir
          </button>
        </div>
      </div>
    `;
    container.classList.remove('hidden');
  }

  function partyAnswerLabel(player) {
    if (player.found) {
      const count = Array.isArray(player.attempts) ? player.attempts.length : 1;
      const pts = Number(player.earnedPoints) || 0;
      return `Trouvé ! (${count}e essai${pts ? ` · +${pts} pt` : ''})`;
    }
    if (player.finished) return 'Essais terminés ❌';
    if (partyState && partyState.mode === 'classic' && partyState.status === 'round') {
      const paliers = partyState.paliers || [0.2, 0.7, 2.5, 5, 9, 15];
      const attemptIdx = Number(player.currentAttempt) || 0;
      const currentDur = paliers[attemptIdx] !== undefined ? paliers[attemptIdx] : paliers[0];
      return `Essai ${attemptIdx + 1}/${paliers.length} · ${currentDur} s`;
    }
    if (player.correct === true) return `Bonne réponse${player.answer ? ` · ${escapeHtml(String(player.answer))}` : ''}`;
    if (player.wrongAttempts) {
      const penalty = Number(player.roundPenaltyPoints) || 0;
      return `${Number(player.wrongAttempts)} tentative${Number(player.wrongAttempts) > 1 ? 's' : ''} ratée${Number(player.wrongAttempts) > 1 ? 's' : ''}${penalty ? ` · −${penalty} pt` : ''}`;
    }
    if (player.buzzPosition) return `Buzzer n°${player.buzzPosition}`;
    if (player.answer) return escapeHtml(String(player.answer));
    if (player.correct === false) return 'Raté';
    return 'En attente';
  }

  function renderPartyVotes() {
    const zone = byId('party-votes');
    const votes = partyState && partyState.votes;
    const me = partyState && partyState.players.find(
      player => player.profileId === partyState.viewerProfileId);
    if (!zone || !me || partyState.status !== 'round' || !votes || !votes.skip) {
      if (zone) zone.classList.add('hidden');
      return;
    }
    const threshold = Number(votes.threshold) || 1;
    zone.innerHTML = `
      <button class="party-vote${votes.skip.voted ? ' voted' : ''}"
              id="party-vote-skip"${votes.skip.passed ? ' disabled' : ''}>
        ⏭ Passer le morceau <strong>${Number(votes.skip.count) || 0}/${threshold}</strong>
      </button>`;
    zone.classList.remove('hidden');
  }

  function renderPartyChat() {
    const zone = byId('party-chat-messages');
    if (!zone || !partyState) return;
    const messages = Array.isArray(partyState.chat) ? partyState.chat.slice(-40) : [];
    zone.innerHTML = messages.length
      ? messages.map(message => `
          <div class="party-chat-message">
            <strong>${escapeHtml(String(message.emoji || '🎧'))} ${escapeHtml(String(message.nom || 'Joueur'))}</strong>
            ${escapeHtml(String(message.message || ''))}
          </div>`).join('')
      : '<div class="party-chat-empty">Aucun message pour le moment.</div>';
    const newest = messages.length ? Number(messages[messages.length - 1].id) || 0 : 0;
    if (newest !== partyLastChatId) {
      partyLastChatId = newest;
      zone.scrollTop = zone.scrollHeight;
    }
  }

  async function sendPartyChat() {
    const input = byId('party-chat-input');
    const message = input && input.value.trim();
    if (!message) return;
    try {
      await partyPlayerAction('chat', { message });
      input.value = '';
      input.focus();
    } catch (error) {
      showPartyError(error);
    }
  }

  function renderPlayerActions() {
    const zone = byId('party-player-actions');
    const me = partyState.players.find(player => player.profileId === partyState.viewerProfileId);
    const buzzer = partyState.buzzer || {};
    const waitingForStart = partyState.playback
      && Number(partyState.serverNow) < Number(partyState.playback.startedAt);
    const signature = `${partyState.status}:${partyState.round}:${partyState.mode}:${waitingForStart ? 'wait' : 'go'}:${me ? me.currentAttempt : 0}:${me ? me.found : false}:${me ? me.finished : false}:${me ? me.answer : ''}:${me ? me.lastAnswer : ''}:${me ? me.buzzerBlockedSeconds : 0}:${buzzer.activeProfileId || ''}:${buzzer.solvedByProfileId || ''}:${buzzer.solvedByProfileId && Number(buzzer.answerSecondsRemaining) > 0 ? 'paused' : 'played'}`;
    const currentInput = byId('party-answer-input');
    const hadFocus = currentInput && document.activeElement === currentInput;
    const previousVal = currentInput ? currentInput.value : '';
    const selStart = currentInput ? currentInput.selectionStart : 0;
    const selEnd = currentInput ? currentInput.selectionEnd : 0;

    if (signature === partyActionSignature) {
      updatePartyActionTimer();
      return;
    }
    partyActionSignature = signature;

    if (!me) {
      zone.innerHTML = partyState.isHost && partyState.status === 'finished'
        ? '<button class="ghost-btn" id="party-leave-btn">Nouvelle soirée</button>'
        : '';
      return;
    }
    if (partyState.status !== 'round') {
      zone.innerHTML = '<button class="ghost-btn" id="party-leave-btn">Quitter le salon</button>';
      return;
    }
    if (waitingForStart) {
      zone.innerHTML = '<div class="mode-status">Prépare-toi… départ synchronisé dans <span id="party-action-timer">—</span> s.</div>';
      updatePartyActionTimer();
      return;
    }
    if (partyState.mode === 'buzzer') {
      const active = partyState.players.find(player => player.profileId === buzzer.activeProfileId);
      if (buzzer.solvedByProfileId) {
        const resume = Number(buzzer.answerSecondsRemaining) > 0
          ? ' Musique dans <span id="party-action-timer">—</span> s.' : '';
        zone.innerHTML = `<div class="mode-status">${buzzer.solvedByProfileId === me.profileId ? 'Bonne réponse !' : 'Bonne réponse trouvée.'}${resume} Tu peux révéler le morceau.</div>`;
        updatePartyActionTimer();
        return;
      }
      if (buzzer.activeProfileId) {
        if (buzzer.activeProfileId !== me.profileId) {
          zone.innerHTML = `<div class="mode-status">${escapeHtml(active ? active.nom : 'Un joueur')} répond · <span id="party-action-timer">—</span> s</div>`;
          updatePartyActionTimer();
          return;
        }
        zone.innerHTML = `<div class="mode-status">Tu as <span id="party-action-timer">—</span> s pour répondre.</div>${partyAnswerBox()}`;
        updatePartyActionTimer();
        const inp = byId('party-answer-input');
        if (inp) {
          if (previousVal && !inp.value) inp.value = previousVal;
          if (hadFocus || document.activeElement !== inp) inp.focus();
          try { if (previousVal) inp.setSelectionRange(selStart, selEnd); } catch (_) {}
        }
        return;
      }
      if (me.buzzerBlockedSeconds) {
        const points = Number(me.lastPenaltyPoints) || 0;
        zone.innerHTML = `<div class="mode-status">Mauvaise réponse : ta pénalité dure encore ${Number(me.buzzerBlockedSeconds)} s.${points ? ` −${points} point${points > 1 ? 's' : ''}.` : ''} Les autres peuvent buzzer.</div>`;
        return;
      }
      zone.innerHTML = '<button class="cta-btn buzz-button" id="party-buzz-btn">BUZZER</button>';
      return;
    }

    // Mode classique (réponses simultanées)
    if (me.found) {
      const count = Array.isArray(me.attempts) ? me.attempts.length : 1;
      zone.innerHTML = `<div class="mode-status">🎉 Trouvé en ${count} essai${count > 1 ? 's' : ''} (+${Number(me.earnedPoints) || 0} pt) ! En attente des autres joueurs…</div>`;
      return;
    }
    if (me.finished) {
      zone.innerHTML = '<div class="mode-status">❌ Tous tes essais sont épuisés pour cette manche. En attente de la révélation…</div>';
      return;
    }

    const paliers = partyState.paliers || [0.2, 0.7, 2.5, 5, 9, 15];
    const attemptIndex = Number(me.currentAttempt) || 0;
    const currentDur = paliers[attemptIndex] !== undefined ? paliers[attemptIndex] : paliers[0];
    const nextDur = paliers[attemptIndex + 1];
    const skipLabel = nextDur !== undefined
      ? `Passer (+${(nextDur - currentDur).toFixed(1).replace('.0', '')}s)`
      : 'Dernier essai !';
    const attemptsList = Array.isArray(me.attempts) && me.attempts.length
      ? `<div class="party-attempts-history">${me.attempts.map(att => `<span class="party-attempt-badge ${att.type}">${att.type === 'skipped' ? '↷ Passé' : `❌ ${escapeHtml(att.text || 'Raté')}`}</span>`).join('')}</div>`
      : '';

    zone.innerHTML = `
      <div class="mode-status">Essai ${attemptIndex + 1} / ${paliers.length} · <strong>${currentDur} s</strong> d’extrait</div>
      ${attemptsList}
      ${partyAnswerBox(skipLabel)}
    `;
    const inp = byId('party-answer-input');
    if (inp) {
      if (previousVal && !inp.value) inp.value = previousVal;
      if (hadFocus || document.activeElement !== inp) inp.focus();
      try { if (previousVal) inp.setSelectionRange(selStart, selEnd); } catch (_) {}
    }
  }

  function updatePartyActionTimer() {
    const timer = byId('party-action-timer');
    if (!timer || !partyState) return;
    if (partyState.playback
        && Number(partyState.serverNow) < Number(partyState.playback.startedAt)) {
      timer.innerText = Math.max(1, Math.ceil(
        (partyState.playback.startedAt - partyState.serverNow) / 1000));
      return;
    }
    timer.innerText = Number((partyState.buzzer || {}).answerSecondsRemaining) || 0;
  }

  function partyAnswerBox(skipLabel = '') {
    const mode = partyState.settings && partyState.settings.answer;
    const placeholder = mode === 'artiste' ? 'Rechercher un artiste…'
      : mode === 'annee' ? 'Donner une année…' : 'Rechercher une chanson…';
    const inputMode = mode === 'annee' ? ' inputmode="numeric"' : '';
    const skipBtnHtml = skipLabel
      ? `<button class="ghost-btn" id="party-skip-btn" type="button">${skipLabel}</button>`
      : '';
    return `
      <div class="party-answer-block">
        <div class="party-search-box">
          <span class="party-search-icon" aria-hidden="true">⌕</span>
          <input id="party-answer-input" maxlength="200" placeholder="${placeholder}"
                 autocomplete="off"${inputMode}>
          <div class="party-suggestions hidden" id="party-answer-suggestions"></div>
        </div>
        <div class="party-input-buttons">
          <button class="cta-btn" id="party-answer-btn" type="button">Envoyer</button>
          ${skipBtnHtml}
        </div>
      </div>`;
  }

  function schedulePartySuggestions() {
    clearTimeout(partySuggestionTimer);
    const input = byId('party-answer-input');
    const list = byId('party-answer-suggestions');
    if (!input || !list) return;
    const query = input.value.trim();
    if (!query) {
      list.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    partySuggestionTimer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          playerToken: party.playerToken,
          q: query,
        });
        const result = await window.songlessShared.api(
          `/api/party/${encodeURIComponent(party.code)}/suggestions?${params}`);
        if (!byId('party-answer-input') || byId('party-answer-input').value.trim() !== query) return;
        renderPartySuggestions(result.suggestions || []);
      } catch (_) {
        list.classList.add('hidden');
      }
    }, 60);
  }

  function renderPartySuggestions(suggestions) {
    const list = byId('party-answer-suggestions');
    if (!list) return;
    list.innerHTML = suggestions.length
      ? suggestions.map((item, index) => `
          <button type="button" class="party-suggestion${index === 0 ? ' active' : ''}"
                  data-party-suggestion="${escapeHtml(String(item.value || ''))}">
            <strong>${escapeHtml(String(item.primary || item.value || ''))}</strong>
            <small>${escapeHtml(String(item.secondary || ''))}</small>
          </button>`).join('')
      : '<div class="party-suggestion-empty">Aucune suggestion</div>';
    list.classList.remove('hidden');
  }

  async function partyCommand(action, data = {}) {
    if (!party) return;
    const next = await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/command`, {
      method: 'POST',
      body: JSON.stringify({
        hostToken: party.hostToken,
        playerToken: party.playerToken,
        action,
        data,
      }),
    });
    receivePartyState(next);
  }

  async function partyPlayerAction(action, data = {}) {
    if (!party || !party.playerToken) return;
    const next = await window.songlessShared.api(`/api/party/${encodeURIComponent(party.code)}/action`, {
      method: 'POST',
      body: JSON.stringify({
        playerToken: party.playerToken,
        hostToken: party.hostToken,
        action,
        data,
      }),
    });
    receivePartyState(next);
  }

  function submitPartyAnswer() {
    const input = byId('party-answer-input');
    const answer = input && input.value.trim();
    if (!answer) return showToast('Écris une réponse.', 'warn');
    const suggestions = byId('party-answer-suggestions');
    if (suggestions) suggestions.classList.add('hidden');
    partyPlayerAction('answer', { answer }).catch(showPartyError);
  }

  async function startPartyRound() {
    if (!partyState || !partyState.isHost) return;
    if (!partyState.infinite && partyState.round >= partyState.totalRounds) {
      return partyCommand('finish').catch(showPartyError);
    }
    const ids = party.trackIds || [];
    const trackIndex = partyState.infinite && ids.length
      ? partyState.round % ids.length
      : partyState.round;
    const trackId = ids[trackIndex] || (playlist[trackIndex] && playlist[trackIndex].id);
    if (!trackId) return showToast('Aucun morceau disponible pour cette manche.', 'warn');
    const track = tracks.find(item => String(item.id) === String(trackId));
    if (!track) return showToast('Le morceau de cette manche est introuvable.', 'error');
    partyRoundStarting = true;
    renderParty();
    try {
      const offset = await preparePartyTrack(trackId);
      primePartyHighlight(track, partyState.round + 1);
      await partyCommand('start-round', {
        round: partyState.round + 1,
        trackId,
        playback: { offset },
        answer: {
          mode: partyState.settings && partyState.settings.answer
            ? partyState.settings.answer : reglages.reponse,
          title: track.title,
          originalTitle: track.originalTitle,
          artist: track.artist,
          year: track.year,
          aliases: track.aliases || [],
        },
      });
    } catch (error) {
      showPartyError(error);
    } finally {
      partyRoundStarting = false;
      renderParty();
    }
  }

  async function revealParty() {
    if (!currentTrack) return;
    try {
      const highlightOffset = await partyHighlightOffset(partyState.round);
      await partyCommand('reveal', {
        track: {
          title: currentTrack.title,
          originalTitle: currentTrack.originalTitle,
          artist: currentTrack.artist,
          genre: currentTrack.genre,
        },
        highlightOffset,
        highlightDuration: 5,
        autoNext: false,
        reason: 'manual',
      });
    } catch (error) {
      showPartyError(error);
    }
  }

  function showPartyError(error) {
    showToast(error.message || String(error), 'error');
  }

  async function copyPartyInvite(kind) {
    const url = party && party.inviteUrls && party.inviteUrls[kind];
    if (!url) {
      return showToast(kind === 'internet'
        ? 'Le tunnel HTTPS Internet n’est pas encore activé.'
        : 'Le lien wifi est indisponible.', 'warn');
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(kind === 'internet' ? 'Lien Internet copié.' : 'Lien même wifi copié.', 'ok');
    } catch (_) {
      prompt('Copie ce lien :', url);
    }
  }

  function leaveParty() {
    clearDemoTimers();
    demoActive = false;
    demoBots = [];
    demoScheduledRound = 0;
    const previousSettings = party && party.previousSettings;
    clearInterval(pollTimer);
    clearTimeout(hostPartyPlayTimer);
    clearTimeout(partyAutoNextTimer);
    hostPlaybackSignature = '';
    partyActionSignature = '';
    partyAutoNextSignature = '';
    partyAutoRevealRound = null;
    partyHighlightRound = null;
    partyHighlightPromise = null;
    partyLastChatId = 0;
    pauseAudio();
    pollTimer = null;
    party = null;
    partyState = null;
    selectedKind = null;
    selectedTrackIds = null;
    saveParty();
    renderParty();
    if (previousSettings) {
      reglages = { ...reglagesParDefaut(), ...previousSettings };
      appliquerReglages({ relancer: false });
    }
    rebuildPlaylist({ keepCurrent: true });
  }

  async function importBackup(file) {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (_) { return showToast('Ce fichier JSON est illisible.', 'error'); }
    if (!data || !Array.isArray(data.profiles)) return showToast('Cette sauvegarde Songless est invalide.', 'error');
    if (!confirm('Importer cette sauvegarde remplacera les profils et listes actuels. Continuer ?')) return;
    try {
      await window.songlessShared.api('/api/player/import', { method: 'POST', body: JSON.stringify(data) });
      showToast('Sauvegarde importée. Rechargement…', 'ok');
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function bindEvents() {
    byId('party-mode').addEventListener('change', renderPartyOptions);
    byId('party-options').addEventListener('change', saveCurrentPartyOptions);
    renderPartyOptions();
    byId('format-start-btn').addEventListener('click', () => {
      selectedKind = null;
      selectedTrackIds = null;
      const rounds = Number(byId('format-rounds').value);
      if (rounds <= 0) {
        limitedGame = null;
        applySeed(randomSeed());
        updateLimitedStatus();
        byId('format-status').innerText = 'Mode sans fin en cours.';
        return;
      }
      startLimited(rounds, 'format', null);
    });
    document.querySelectorAll('.training-btn').forEach(button => {
      button.addEventListener('click', () => {
        const ids = trainingOrder(playlist);
        if (!ids.length) return showToast('Aucun morceau à entraîner.', 'warn');
        startLimited(button.getAttribute('data-rounds'), 'training', ids);
      });
    });

    const soloDuelBtn = byId('solo-duel-start-btn');
    if (soloDuelBtn) {
      soloDuelBtn.addEventListener('click', () => {
        const opp = (byId('solo-duel-opponent') && byId('solo-duel-opponent').value) || 'bot';
        startSoloDuel(opp);
      });
    }

    const soloRoyaleBtn = byId('solo-royale-start-btn');
    if (soloRoyaleBtn) {
      soloRoyaleBtn.addEventListener('click', () => {
        startSoloRoyale();
      });
    }

    byId('collection-create-btn').addEventListener('click', createCollection);
    byId('challenge-save-btn').addEventListener('click', saveChallenge);
    byId('collection-list').addEventListener('click', event => {
      const play = event.target.closest('[data-collection-play]');
      const remove = event.target.closest('[data-collection-delete]');
      if (play) playCollection(play.getAttribute('data-collection-play'));
      if (remove) removeList('collection', remove.getAttribute('data-collection-delete'));
    });
    byId('challenge-list').addEventListener('click', event => {
      const play = event.target.closest('[data-challenge-play]');
      const remove = event.target.closest('[data-challenge-delete]');
      if (play) playChallenge(play.getAttribute('data-challenge-play'));
      if (remove) removeList('challenge', remove.getAttribute('data-challenge-delete'));
    });
    byId('party-create-btn').addEventListener('click', createParty);
    if (byId('party-demo-btn')) byId('party-demo-btn').addEventListener('click', startDemoSimulation);
    byId('party-join-btn').addEventListener('click', joinParty);
    byId('party-code-input').addEventListener('input', event => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
    });

    if (byId('party-history-btn')) byId('party-history-btn').addEventListener('click', openPartyHistoryModal);
    if (byId('party-history-close-btn')) {
      byId('party-history-close-btn').addEventListener('click', () => {
        const m = byId('party-history-modal');
        if (m) m.classList.add('hidden');
      });
    }
    const histModal = byId('party-history-modal');
    if (histModal) {
      histModal.addEventListener('click', e => {
        if (e.target === histModal) histModal.classList.add('hidden');
      });
    }

    const quizPrintBtn = byId('quiz-print-btn');
    if (quizPrintBtn) quizPrintBtn.addEventListener('click', openQuizPrintModal);

    const quizDoPrint = byId('quiz-do-print-btn');
    if (quizDoPrint) quizDoPrint.addEventListener('click', () => window.print());

    const quizToggleAnswers = byId('quiz-toggle-answers-btn');
    if (quizToggleAnswers) {
      quizToggleAnswers.addEventListener('click', () => {
        const preview = byId('quiz-print-preview');
        if (preview) preview.classList.toggle('show-master-only');
      });
    }

    const quizCloseBtn = byId('quiz-print-close-btn');
    if (quizCloseBtn) {
      quizCloseBtn.addEventListener('click', () => {
        const m = byId('quiz-print-modal');
        if (m) m.classList.add('hidden');
      });
    }
    const quizModal = byId('quiz-print-modal');
    if (quizModal) {
      quizModal.addEventListener('click', e => {
        if (e.target === quizModal) quizModal.classList.add('hidden');
      });
    }

    if (byId('party-randomize-teams-btn')) {
      byId('party-randomize-teams-btn').addEventListener('click', () => {
        partyTeamsSignature = '';
        partyCommand('host-randomize-teams')
          .then(() => {
            partyTeamsSignature = '';
            renderPartyTeams();
            showToast('Équipes réparties aléatoirement ! 🎲', 'ok');
          })
          .catch(showPartyError);
      });
    }

    if (byId('party-add-team-btn')) byId('party-add-team-btn').addEventListener('click', openTeamCreateModal);
    if (byId('team-create-cancel-btn')) {
      byId('team-create-cancel-btn').addEventListener('click', () => {
        const m = byId('team-create-modal');
        if (m) m.classList.add('hidden');
      });
    }
    const teamModal = byId('team-create-modal');
    if (teamModal) {
      teamModal.addEventListener('click', e => {
        if (e.target === teamModal) teamModal.classList.add('hidden');
      });
    }
    if (byId('team-create-confirm-btn')) byId('team-create-confirm-btn').addEventListener('click', confirmCreateTeam);
    if (byId('team-create-presets')) {
      byId('team-create-presets').addEventListener('click', e => {
        const btn = e.target.closest('[data-preset-id]');
        if (!btn) return;
        byId('team-create-presets').querySelectorAll('.team-preset-chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        selectedTeamPreset = {
          id: btn.getAttribute('data-preset-id'),
          name: btn.getAttribute('data-preset-name'),
          color: btn.getAttribute('data-preset-color'),
          emoji: btn.getAttribute('data-preset-emoji'),
        };
        const nameInput = byId('new-team-name');
        if (nameInput) nameInput.value = selectedTeamPreset.name;
      });
    }

    byId('party-room').addEventListener('click', event => {
      const suggestion = event.target.closest('[data-party-suggestion]');
      if (suggestion) {
        const input = byId('party-answer-input');
        if (input) {
          input.value = suggestion.getAttribute('data-party-suggestion') || '';
          byId('party-answer-suggestions').classList.add('hidden');
          submitPartyAnswer();
        }
        return;
      }

      const souvenirBtn = event.target.closest('#copy-souvenir-card-btn');
      if (souvenirBtn) {
        const text = generatePartySouvenirText(partyState);
        navigator.clipboard.writeText(text).then(() => {
          showToast('Carte souvenir copiée dans le presse-papier ! 📋', 'ok');
        }).catch(() => {
          prompt('Copie le bilan de la partie :', text);
        });
        return;
      }

      const reactionBtn = event.target.closest('#pc-quick-reactions [data-reaction]');
      if (reactionBtn) {
        const emoji = reactionBtn.getAttribute('data-reaction');
        partyPlayerAction('reaction', { emoji }).catch(showPartyError);
        return;
      }

      const delTeamBtn = event.target.closest('[data-team-del]');
      if (delTeamBtn) {
        const teamId = delTeamBtn.getAttribute('data-team-del');
        partyTeamsSignature = '';
        partyCommand('host-delete-team', { teamId })
          .then(() => {
            partyTeamsSignature = '';
            renderPartyTeams();
            showToast('Équipe supprimée.', 'ok');
          })
          .catch(showPartyError);
        return;
      }

      const unassignBtn = event.target.closest('[data-team-unassign]');
      if (unassignBtn) {
        const profileId = unassignBtn.getAttribute('data-team-unassign');
        partyTeamsSignature = '';
        partyCommand('host-assign-player', { profileId, teamId: null, locked: false })
          .then(() => {
            partyTeamsSignature = '';
            renderPartyTeams();
            showToast('Joueur retiré de l’équipe.', 'ok');
          })
          .catch(showPartyError);
        return;
      }

      if (event.target.closest('#party-copy-lan')) copyPartyInvite('lan');
      if (event.target.closest('#party-copy-internet')) copyPartyInvite('internet');
      if (event.target.closest('#party-buzz-btn')) partyPlayerAction('buzz').catch(showPartyError);
      if (event.target.closest('#party-answer-btn')) submitPartyAnswer();
      if (event.target.closest('#party-skip-btn')) partyPlayerAction('skip').catch(showPartyError);
      if (event.target.closest('#party-vote-skip')) partyPlayerAction('vote-skip').catch(showPartyError);
      if (event.target.closest('#party-chat-send')) sendPartyChat();
      if (event.target.closest('#party-round-btn')) startPartyRound();
      if (event.target.closest('#party-reveal-btn')) revealParty();
      if (event.target.closest('#party-finish-btn')) {
        if (partyState && partyState.status === 'finished') leaveParty();
        else partyCommand('finish').catch(showPartyError);
      }
      if (event.target.closest('#party-leave-btn')) leaveParty();
    });

    byId('party-room').addEventListener('change', event => {
      const select = event.target.closest('.team-assign-select');
      if (select) {
        const teamId = select.getAttribute('data-team-target');
        const profileId = select.value;
        if (profileId) {
          select.blur();
          partyTeamsSignature = '';
          partyCommand('host-assign-player', { profileId, teamId, locked: true })
            .then(() => {
              partyTeamsSignature = '';
              renderPartyTeams();
              showToast('Joueur assigné avec succès !', 'ok');
            })
            .catch(showPartyError);
        }
      }
    });

    byId('party-room').addEventListener('input', event => {
      if (event.target.id === 'party-answer-input') schedulePartySuggestions();
    });
    byId('party-room').addEventListener('keydown', event => {
      if (event.target.id === 'party-chat-input' && event.key === 'Enter') {
        event.preventDefault();
        sendPartyChat();
        return;
      }
      if (event.target.id !== 'party-answer-input') return;
      const list = byId('party-answer-suggestions');
      const items = list ? [...list.querySelectorAll('[data-party-suggestion]')] : [];
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
          event.target.value = items[active].getAttribute('data-party-suggestion') || '';
          list.classList.add('hidden');
        }
        submitPartyAnswer();
      } else if (event.key === 'Escape' && list) {
        list.classList.add('hidden');
      }
    });
    byId('backup-import').addEventListener('change', event => {
      importBackup(event.target.files && event.target.files[0]);
      event.target.value = '';
    });
  }

  async function openPartyHistoryModal() {
    const modal = byId('party-history-modal');
    const list = byId('party-history-list');
    if (!modal || !list) return;
    list.innerHTML = '<div class="loading-state">Chargement du palmarès…</div>';
    modal.classList.remove('hidden');
    try {
      const data = await window.songlessShared.api('/api/party-history');
      const history = (data && data.history) || [];
      if (!history.length) {
        list.innerHTML = '<div class="party-history-empty">Aucune soirée enregistrée pour le moment. Terminez une partie pour inscrire vos scores au palmarès !</div>';
        return;
      }
      list.innerHTML = history.map(item => {
        const dateStr = item.date ? new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        return `
          <div class="party-history-card">
            <div class="history-card-header">
              <div>
                <span class="history-card-date">📅 ${dateStr}</span>
                <span class="history-card-mode">${item.mode === 'buzzer' ? '🔔 Buzzer' : '🎯 Réponses simultanées'} · ${item.totalRounds} manches</span>
              </div>
              <span class="history-players-count">👥 ${item.playersCount || (item.players && item.players.length) || 0} joueurs</span>
            </div>
            <div class="history-card-winners">
              ${item.winner ? `
                <div class="history-winner-badge">
                  <span>👑 Vainqueur : <strong>${escapeHtml(item.winner.emoji || '🎧')} ${escapeHtml(item.winner.nom)}</strong> (${item.winner.score} pts)</span>
                </div>` : ''}
              ${item.winningTeam ? `
                <div class="history-team-badge" style="border-color: ${safeTeamColor(item.winningTeam.color, '#a855f7')};">
                  <span>🏆 Équipe Championne : <strong style="color:${safeTeamColor(item.winningTeam.color, '#a855f7')};">${escapeHtml(item.winningTeam.emoji || '👥')} ${escapeHtml(item.winningTeam.name)}</strong> (${item.winningTeam.score} pts)</span>
                </div>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      list.innerHTML = `<div class="party-history-empty">Erreur : ${escapeHtml(e.message)}</div>`;
    }
  }

  function openTeamCreateModal() {
    const modal = byId('team-create-modal');
    const presetsContainer = byId('team-create-presets');
    if (!modal || !presetsContainer) return;
    const presets = (partyState && partyState.teamPresets) || [
      { id: 'team_red', name: 'Les Diables Rouges', color: '#ef4444', emoji: '🔴' },
      { id: 'team_blue', name: 'Les Faucons Bleus', color: '#3b82f6', emoji: '🔵' },
      { id: 'team_green', name: 'Les Vipères Vertes', color: '#10b981', emoji: '🟢' },
      { id: 'team_yellow', name: 'Les Éclairs Dorés', color: '#f59e0b', emoji: '🟡' },
      { id: 'team_purple', name: 'Les Ombres Violettes', color: '#8b5cf6', emoji: '🟣' },
      { id: 'team_orange', name: 'Les Tigres Orange', color: '#f97316', emoji: '🟠' },
      { id: 'team_pink', name: 'Les Flamants Roses', color: '#ec4899', emoji: '💖' },
      { id: 'team_cyan', name: 'Les Sirènes Cyan', color: '#06b6d4', emoji: '🩵' },
      { id: 'team_gold', name: 'L’Ordre d’Or', color: '#eab308', emoji: '🪙' },
      { id: 'team_silver', name: 'Les Loups d’Argent', color: '#94a3b8', emoji: '⚪' },
      { id: 'team_forest', name: 'Les Gardiens de la Forêt', color: '#15803d', emoji: '🌲' },
      { id: 'team_ocean', name: 'Les Abysses', color: '#0284c7', emoji: '🌊' },
      { id: 'team_magma', name: 'Le Volcan', color: '#dc2626', emoji: '🌋' },
      { id: 'team_galaxy', name: 'La Nébuleuse', color: '#6366f1', emoji: '🌌' },
      { id: 'team_lightning', name: 'Les Foudroyants', color: '#818cf8', emoji: '⚡' },
      { id: 'team_retro', name: 'Les Rétro 80s', color: '#d946ef', emoji: '🕹️' },
    ];
    selectedTeamPreset = presets[0];
    presetsContainer.innerHTML = presets.map((p, idx) => `
      <button type="button" class="team-preset-chip${idx === 0 ? ' active' : ''}" data-preset-id="${p.id}" data-preset-name="${escapeHtml(p.name)}" data-preset-color="${p.color}" data-preset-emoji="${p.emoji}" style="border-color: ${p.color};">
        <span>${p.emoji}</span>
        <small>${escapeHtml(p.name)}</small>
      </button>
    `).join('');
    const input = byId('new-team-name');
    if (input) input.value = selectedTeamPreset.name;
    modal.classList.remove('hidden');
  }

  function confirmCreateTeam() {
    const input = byId('new-team-name');
    const name = (input && input.value.trim()) || (selectedTeamPreset && selectedTeamPreset.name) || 'Équipe';
    const color = (selectedTeamPreset && selectedTeamPreset.color) || '#8b5cf6';
    const emoji = (selectedTeamPreset && selectedTeamPreset.emoji) || '👥';
    partyCommand('host-create-team', {
      name,
      color,
      emoji,
      presetId: selectedTeamPreset ? selectedTeamPreset.id : null,
    }).then(() => {
      partyTeamsSignature = '';
      renderPartyTeams();
      const modal = byId('team-create-modal');
      if (modal) modal.classList.add('hidden');
      showToast(`Équipe « ${name} » créée !`, 'ok');
    }).catch(showPartyError);
  }

  function filterPlaylist(source) {
    if (!selectedTrackIds || !selectedTrackIds.length) return source;
    if (selectedKind === 'collection') {
      const allowed = new Set(selectedTrackIds.map(String));
      return source.filter(track => allowed.has(String(track.id)));
    }
    const allowed = new Map(source.map(track => [String(track.id), track]));
    return selectedTrackIds.map(id => allowed.get(String(id))).filter(Boolean);
  }

  function onRoundStart(track) {
    if (!track || syncingRound || !party || !partyState || !partyState.isHost) return;
    // Les boutons du salon sont la source de vérité. Ce garde-fou évite qu'une
    // navigation locale accidentelle ne change la manche des téléphones.
    if (partyState.status === 'round' && String(partyState.currentTrackId) !== String(track.id)) {
      syncPartyRound(partyState.currentTrackId);
    }
  }

  function onRoundEnd(result) {
    if (!limitedGame || limitedGame.finished) return;
    limitedGame.completed++;
    const isWin = Boolean(result && result.isWin);
    if (isWin) limitedGame.wins++;

    if (limitedGame.kind === 'royale') {
      if (!isWin) {
        limitedGame.lives = Math.max(0, (limitedGame.lives || 3) - 1);
        if (limitedGame.lives === 0) {
          limitedGame.finished = true;
          showToast('💀 Plus aucun cœur ! Fin de la survie.', 'error');
        }
      }
    } else if (limitedGame.kind === 'duel') {
      if (isWin) {
        limitedGame.duelScore = Math.max(-100, (limitedGame.duelScore || 0) - 25);
      } else {
        limitedGame.duelScore = Math.min(100, (limitedGame.duelScore || 0) + 25);
      }
      if (limitedGame.duelScore <= -100) {
        limitedGame.finished = true;
        showToast('🏆 Victoire éclatante par K.O. au tir à la corde !', 'ok');
      } else if (limitedGame.duelScore >= 100) {
        limitedGame.finished = true;
        showToast('😢 Défaite... L’adversaire a remporté le tir à la corde.', 'warn');
      }
    }

    limitedGame.results.push({
      trackId: result && result.track ? String(result.track.id) : '',
      isWin,
      attempt: result && result.attempt ? Number(result.attempt) : null,
    });
    if (limitedGame.total !== 'infinite' && limitedGame.completed >= limitedGame.total) limitedGame.finished = true;
    updateLimitedStatus();
  }

  function beforeAdvance() {
    if (party && partyState && partyState.status !== 'finished') {
      showToast('La manche suivante se lance depuis le salon multijoueur.', 'warn');
      return false;
    }
    if (limitedGame && limitedGame.finished) {
      updateLimitedStatus();
      showToast('Cette partie est terminée : son bilan est dans l’onglet Modes.', 'ok');
      return false;
    }
    return true;
  }

  function shouldStayInGame() {
    return Boolean(party && partyState && partyState.status === 'round');
  }

  function blocksManualPlayback() {
    return Boolean(party && partyState && partyState.status === 'round');
  }

  window.songlessExpansions = {
    filterPlaylist, onRoundStart, onRoundEnd, beforeAdvance,
    shouldStayInGame, blocksManualPlayback,
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    refreshLists();
    updateLimitedStatus();
    renderParty();
    if (party) startPolling();
  });

  window.addEventListener('songless:shared-ready', event => {
    const state = event.detail || {};
    const localCollections = readLocal(STORAGE_COLLECTIONS, []);
    const localChallenges = readLocal(STORAGE_CHALLENGES, []);
    const serverEmpty = !(state.collections || []).length && !(state.challenges || []).length;
    if (serverEmpty && (localCollections.length || localChallenges.length)) {
      collections = localCollections;
      challenges = localChallenges;
      saveLists().then(() => refreshLists()).catch(error => showToast(error.message, 'error'));
      return;
    }
    refreshLists(state);
  });
})();
