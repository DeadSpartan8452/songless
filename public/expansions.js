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

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function currentSelectionIds() {
    return playlist.map(track => String(track.id));
  }

  function startLimited(total, kind, ids) {
    const available = Array.isArray(ids) ? ids.length : playlist.length;
    if (!available) {
      showToast('Aucun morceau dans la sélection actuelle.', 'warn');
      return false;
    }
    const rounds = Math.min(Math.max(1, Number(total) || 10), available || 1);
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
    return true;
  }

  function updateLimitedStatus() {
    const format = byId('format-status');
    const training = byId('training-status');
    if (!format || !training) return;

    format.classList.remove('session-finished');
    training.classList.remove('session-finished');
    if (!limitedGame) {
      format.innerText = 'Aucune partie limitée en cours.';
      training.innerText = '';
      return;
    }

    const target = limitedGame.kind === 'training' ? training : format;
    const label = limitedGame.kind === 'training' ? 'Entraînement' : 'Partie';
    if (limitedGame.finished) {
      const losses = limitedGame.completed - limitedGame.wins;
      target.innerText = `${label} terminée : ${limitedGame.wins} trouvé${limitedGame.wins > 1 ? 's' : ''}, ${losses} raté${losses > 1 ? 's' : ''} sur ${limitedGame.total}.`;
      target.classList.add('session-finished');
    } else {
      target.innerText = `${label} en cours : ${limitedGame.completed + 1} / ${limitedGame.total}.`;
    }
    if (target !== format) format.innerText = 'Aucune partie limitée en cours.';
    if (target !== training) training.innerText = '';
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
      ? { answer: 'titre', speed: 1, direction: 'normal', start: 'seed', excerpt: 10, points: 1500 }
      : { answer: 'titre', speed: 1, direction: 'normal', start: 'seed', excerpt: 15, points: 1000 };
  }

  function normalizedPartyOptions(mode, value) {
    const defaults = defaultPartyOptions(mode);
    const source = value && typeof value === 'object' ? value : {};
    const oneOf = (candidate, allowed, fallback) => allowed.includes(candidate) ? candidate : fallback;
    return {
      answer: oneOf(source.answer, ['titre', 'artiste', 'annee'], defaults.answer),
      speed: oneOf(Number(source.speed), [0.75, 1, 1.25, 1.5], defaults.speed),
      direction: oneOf(source.direction, ['normal', 'inverse'], defaults.direction),
      start: oneOf(source.start, ['seed', 'refrain', 'debut'], defaults.start),
      excerpt: oneOf(Number(source.excerpt), [5, 10, 15, 30, 60], defaults.excerpt),
      points: oneOf(Number(source.points), [500, 1000, 1500, 2000], defaults.points),
    };
  }

  function currentPartyOptions() {
    const mode = byId('party-mode').value;
    return normalizedPartyOptions(mode, partyOptions[mode]);
  }

  function renderPartyOptions() {
    const value = currentPartyOptions();
    byId('party-answer-mode').value = value.answer;
    byId('party-speed').value = String(value.speed);
    byId('party-direction').value = value.direction;
    byId('party-start').value = value.start;
    byId('party-excerpt').value = String(value.excerpt);
    byId('party-points').value = String(value.points);
  }

  function saveCurrentPartyOptions() {
    const mode = byId('party-mode').value;
    partyOptions[mode] = normalizedPartyOptions(mode, {
      answer: byId('party-answer-mode').value,
      speed: Number(byId('party-speed').value),
      direction: byId('party-direction').value,
      start: byId('party-start').value,
      excerpt: Number(byId('party-excerpt').value),
      points: Number(byId('party-points').value),
    });
    writeLocal(STORAGE_PARTY_OPTIONS, partyOptions);
  }

  function applyPartySettings(settings) {
    const value = normalizedPartyOptions(partyState ? partyState.mode : 'classic', settings);
    const excerpt = value.excerpt;
    reglages = {
      ...reglages,
      reponse: value.answer,
      vitesse: value.speed,
      sens: value.direction,
      depart: value.start,
      preset: 'perso',
      paliers: [excerpt, excerpt + .1, excerpt + .2, excerpt + .3, excerpt + .4, excerpt + .5],
    };
    durations = normaliserPaliers(reglages.paliers);
    majSegmentsPaliers();
    majBoutonsOptions();
    majPlaceholderReponse();
    updateProgressSegmentsUI();
  }

  async function createParty() {
    if (!profilActif) return showToast('Choisis d’abord ton profil : le PC joue aussi.', 'warn');
    if (!playlist.length) return showToast('Aucun morceau dans la sélection.', 'warn');
    const trackIds = currentSelectionIds();
    const settings = currentPartyOptions();
    const roundChoice = byId('party-rounds').value;
    try {
      const result = await window.songlessShared.api('/api/party/create', {
        method: 'POST',
        body: JSON.stringify({
          mode: byId('party-mode').value,
          profileId: profilActif.id,
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
    if (next.status === 'round' && next.isHost
        && (next.roundDecision === 'skip' || (next.buzzer || {}).solvedByProfileId)) {
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
          artist: currentTrack.artist,
          genre: currentTrack.genre,
        },
        highlightOffset,
        highlightDuration: 3,
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
      ? 'Passage connu… prochaine manche dans 3 secondes.'
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

    byId('party-players').innerHTML = partyState.players.map(player => `
      <div class="party-player${player.profileId === partyState.viewerProfileId ? ' me' : ''}">
        <span class="party-player-name">${escapeHtml(String(player.emoji || '🎧'))} ${escapeHtml(String(player.nom || 'Joueur'))}${player.host ? ' · hôte' : ''}</span>
        <span class="party-answer">${partyAnswerLabel(player)} · session ${Number(player.session && player.session.correct) || 0}/${Number(player.session && player.session.rounds) || 0}</span>
        <span class="party-score">${Number(player.score) || 0} pt<small>${Number(player.globalStats && player.globalStats.wins) || 0} victoire${Number(player.globalStats && player.globalStats.wins) > 1 ? 's' : ''} globale${Number(player.globalStats && player.globalStats.wins) > 1 ? 's' : ''}</small></span>
      </div>`).join('');

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

  function renderPartyVotes() {
    const zone = byId('party-votes');
    const votes = partyState && partyState.votes;
    const me = partyState && partyState.players.find(
      player => player.profileId === partyState.viewerProfileId);
    if (!zone || !me || partyState.status !== 'round' || !votes) {
      if (zone) zone.classList.add('hidden');
      return;
    }
    const threshold = Number(votes.threshold) || 1;
    zone.innerHTML = `
      <button class="party-vote${votes.skip.voted ? ' voted' : ''}"
              id="party-vote-skip"${votes.skip.passed ? ' disabled' : ''}>
        ⏭ Passer <strong>${Number(votes.skip.count) || 0}/${threshold}</strong>
      </button>
      <button class="party-vote${votes.more.voted ? ' voted' : ''}"
              id="party-vote-more"${votes.more.granted ? ' disabled' : ''}>
        ${votes.more.granted
          ? '✅ 5 secondes ajoutées'
          : `⏱ +5 s <strong>${Number(votes.more.count) || 0}/${threshold}</strong>`}
      </button>`;
    zone.classList.remove('hidden');
  }

  function partyAnswerLabel(player) {
    if (player.correct === true) return `Bonne réponse${player.answer ? ` · ${escapeHtml(String(player.answer))}` : ''}`;
    if (player.wrongAttempts) return `${Number(player.wrongAttempts)} tentative${Number(player.wrongAttempts) > 1 ? 's' : ''} ratée${Number(player.wrongAttempts) > 1 ? 's' : ''}`;
    if (player.buzzPosition) return `Buzzer n°${player.buzzPosition}`;
    if (player.answer) return escapeHtml(String(player.answer));
    if (player.correct === true) return 'Bonne réponse';
    if (player.correct === false) return 'Raté';
    return 'En attente';
  }

  function renderPlayerActions() {
    const zone = byId('party-player-actions');
    const me = partyState.players.find(player => player.profileId === partyState.viewerProfileId);
    const buzzer = partyState.buzzer || {};
    const waitingForStart = partyState.playback
      && Number(partyState.serverNow) < Number(partyState.playback.startedAt);
    const signature = `${partyState.status}:${partyState.round}:${partyState.mode}:${waitingForStart ? 'wait' : 'go'}:${me ? me.answer : ''}:${me ? me.lastAnswer : ''}:${me ? me.buzzerBlockedSeconds : 0}:${buzzer.activeProfileId || ''}:${buzzer.solvedByProfileId || ''}:${buzzer.solvedByProfileId && Number(buzzer.answerSecondsRemaining) > 0 ? 'paused' : 'played'}`;
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
        setTimeout(() => byId('party-answer-input') && byId('party-answer-input').focus(), 20);
        return;
      }
      if (me.buzzerBlockedSeconds) {
        zone.innerHTML = `<div class="mode-status">Mauvaise réponse : ta pénalité dure encore ${Number(me.buzzerBlockedSeconds)} s. Les autres peuvent buzzer.</div>`;
        return;
      }
      zone.innerHTML = '<button class="cta-btn buzz-button" id="party-buzz-btn">BUZZER</button>';
      return;
    }
    if (me.answer !== null) {
      zone.innerHTML = '<div class="mode-status">Réponse envoyée. En attente de la révélation.</div>';
      return;
    }
    zone.innerHTML = partyAnswerBox();
    setTimeout(() => byId('party-answer-input') && byId('party-answer-input').focus(), 20);
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

  function partyAnswerBox() {
    const mode = partyState.settings && partyState.settings.answer;
    const placeholder = mode === 'artiste' ? 'Rechercher un artiste…'
      : mode === 'annee' ? 'Donner une année…' : 'Rechercher une chanson…';
    const inputMode = mode === 'annee' ? ' inputmode="numeric"' : '';
    return `
      <div class="party-answer-block">
        <div class="party-search-box">
          <span class="party-search-icon" aria-hidden="true">⌕</span>
          <input id="party-answer-input" maxlength="200" placeholder="${placeholder}"
                 autocomplete="off"${inputMode}>
          <div class="party-suggestions hidden" id="party-answer-suggestions"></div>
        </div>
        <button class="cta-btn" id="party-answer-btn">Envoyer</button>
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
    }, 120);
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
        track: { title: currentTrack.title, artist: currentTrack.artist, genre: currentTrack.genre },
        highlightOffset,
        highlightDuration: 3,
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
    byId('party-join-btn').addEventListener('click', joinParty);
    byId('party-code-input').addEventListener('input', event => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
    });
    byId('party-room').addEventListener('click', event => {
      const suggestion = event.target.closest('[data-party-suggestion]');
      if (suggestion) {
        const input = byId('party-answer-input');
        if (input) {
          input.value = suggestion.getAttribute('data-party-suggestion') || '';
          byId('party-answer-suggestions').classList.add('hidden');
          input.focus();
        }
        return;
      }
      if (event.target.closest('#party-copy-lan')) copyPartyInvite('lan');
      if (event.target.closest('#party-copy-internet')) copyPartyInvite('internet');
      if (event.target.closest('#party-buzz-btn')) partyPlayerAction('buzz').catch(showPartyError);
      if (event.target.closest('#party-answer-btn')) submitPartyAnswer();
      if (event.target.closest('#party-vote-skip')) partyPlayerAction('vote-skip').catch(showPartyError);
      if (event.target.closest('#party-vote-more')) partyPlayerAction('vote-more').catch(showPartyError);
      if (event.target.closest('#party-round-btn')) startPartyRound();
      if (event.target.closest('#party-reveal-btn')) revealParty();
      if (event.target.closest('#party-finish-btn')) {
        if (partyState && partyState.status === 'finished') leaveParty();
        else partyCommand('finish').catch(showPartyError);
      }
      if (event.target.closest('#party-leave-btn')) leaveParty();
    });
    byId('party-room').addEventListener('input', event => {
      if (event.target.id === 'party-answer-input') schedulePartySuggestions();
    });
    byId('party-room').addEventListener('keydown', event => {
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
        } else {
          submitPartyAnswer();
        }
      } else if (event.key === 'Escape' && list) {
        list.classList.add('hidden');
      }
    });
    byId('backup-import').addEventListener('change', event => {
      importBackup(event.target.files && event.target.files[0]);
      event.target.value = '';
    });
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
    if (result && result.isWin) limitedGame.wins++;
    limitedGame.results.push({
      trackId: result && result.track ? String(result.track.id) : '',
      isWin: Boolean(result && result.isWin),
      attempt: result && result.attempt ? Number(result.attempt) : null,
    });
    if (limitedGame.completed >= limitedGame.total) limitedGame.finished = true;
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
