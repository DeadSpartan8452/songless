'use strict';

(function () {
  const STORAGE_UNLOCKED = 'songless_unlocked_trophies_v1';
  let unlockedTrophies = new Set(readUnlocked());
  let currentFilter = 'all';

  function readUnlocked() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_UNLOCKED) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  function saveUnlocked() {
    try {
      localStorage.setItem(STORAGE_UNLOCKED, JSON.stringify([...unlockedTrophies]));
    } catch (_) {}
  }

  function playTrophyChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
      osc.frequency.setValueAtTime(1046.50, now + 0.3); // C6
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.85);
      setTimeout(() => ctx.close(), 1000);
    } catch (_) {}
  }

  function showTrophyUnlockToast(trophy) {
    if (!trophy) return;
    let container = document.getElementById('trophy-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'trophy-toast-container';
      container.className = 'trophy-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'trophy-toast';
    toast.innerHTML = `
      <div class="trophy-toast-glow"></div>
      <div class="trophy-toast-icon">${trophy.icon || '🏆'}</div>
      <div class="trophy-toast-body">
        <span class="trophy-toast-badge">✨ SUCCÈS DÉBLOQUÉ</span>
        <strong class="trophy-toast-title">${escapeHtml(trophy.name)}</strong>
        <small class="trophy-toast-desc">${escapeHtml(trophy.desc)}</small>
      </div>
    `;

    container.appendChild(toast);
    playTrophyChime();

    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, 4500);
  }

  function unlock(trophyId) {
    if (!trophyId || unlockedTrophies.has(trophyId)) return false;
    const trophy = typeof SONGLESS_TROPHIES !== 'undefined'
      ? SONGLESS_TROPHIES.find(t => t.id === trophyId)
      : null;
    if (!trophy) return false;

    unlockedTrophies.add(trophyId);
    saveUnlocked();
    showTrophyUnlockToast(trophy);
    syncTrophyCountBadge();

    // Check completionist
    if (unlockedTrophies.size >= 50 && !unlockedTrophies.has('secret_completionist')) {
      setTimeout(() => unlock('secret_completionist'), 1500);
    }
    return true;
  }

  function syncTrophyCountBadge() {
    const badges = document.querySelectorAll('.trophies-count-badge');
    const total = typeof SONGLESS_TROPHIES !== 'undefined' ? SONGLESS_TROPHIES.length : 105;
    badges.forEach(b => {
      b.innerText = `${unlockedTrophies.size}/${total}`;
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[c]);
  }

  // ==========================================
  // SYSTÈME DE VÉRIFICATION D'ÉVÉNEMENTS
  // ==========================================
  let consecutiveFirstSteps = 0;
  let consecutiveWins = 0;
  let consecutiveHardcore = 0;
  let consecutiveReverse = 0;
  let consecutiveClutch = 0;
  let consecutiveYearWins = 0;
  let consecutiveDuels = 0;
  let noWrongGuessesStreak = 0;

  function evaluateRound(context) {
    if (!context || !context.track) return;
    const { isWin, attempt, durIndex, mode, speed, way, start, preset, fx, roundDuration } = context;

    // Time of day checks
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) unlock('secret_night_owl');
    if (hour >= 6 && hour < 8) unlock('secret_early_bird');

    if (isWin) {
      unlock('acc_first_win');
      consecutiveWins++;
      if (consecutiveWins >= 5) unlock('acc_streak_5');
      if (consecutiveWins >= 10) unlock('acc_streak_10');
      if (consecutiveWins >= 20) unlock('acc_streak_20');

      // Speed / First step (0.2s)
      if (attempt === 1 || durIndex === 0) {
        unlock('speed_first');
        consecutiveFirstSteps++;
        if (consecutiveFirstSteps >= 3) unlock('speed_3_row');
        if (consecutiveFirstSteps >= 5) unlock('speed_5_row');
      } else {
        consecutiveFirstSteps = 0;
      }

      if (attempt === 2 || durIndex === 1) unlock('speed_second_step');

      // Clutch 6th attempt
      if (attempt === 6 || durIndex === 5) {
        unlock('speed_clutch_6');
        consecutiveClutch++;
        if (consecutiveClutch >= 5) unlock('speed_clutch_5_row');
      } else {
        consecutiveClutch = 0;
      }

      // Instant submit
      if (roundDuration && roundDuration <= 3.2) unlock('speed_instant_submit');

      // Hardcore
      if (preset === 'hardcore') {
        unlock('speed_hardcore_1');
        consecutiveHardcore++;
        if (consecutiveHardcore >= 5) unlock('speed_hardcore_5');
      } else {
        consecutiveHardcore = 0;
      }

      // Speeds
      if (speed >= 1.4) unlock('speed_turbo_win');
      if (speed <= 0.8) unlock('speed_slow_win');

      // Way / Reverse
      if (way === 'inverse') {
        unlock('audio_reverse_first');
        consecutiveReverse++;
        if (consecutiveReverse >= 3) unlock('audio_reverse_3');
      } else {
        consecutiveReverse = 0;
      }

      // FX
      if (fx === '8bit') unlock('audio_fx_8bit');
      if (fx === 'radio') unlock('audio_fx_radio');
      if (fx === 'underwater') unlock('audio_fx_underwater');
      if (fx === 'nightcore') unlock('audio_fx_nightcore');
      if (fx === 'slowed') unlock('audio_fx_slowed');
      if (fx === 'bass') unlock('audio_fx_bass');

      // Audio starts
      if (start === 'refrain') unlock('audio_refrain_start');
      if (start === 'debut') unlock('audio_debut_start');

      // Year Mode
      if (mode === 'annee') {
        unlock('time_first_year');
        consecutiveYearWins++;
        if (consecutiveYearWins >= 3) unlock('time_year_streak_3');
      } else {
        consecutiveYearWins = 0;
      }

      // Decades & Track properties
      const trackYear = Number(context.track.year) || 0;
      if (trackYear > 0) {
        const currentYear = new Date().getFullYear();
        if (trackYear <= 1979) unlock('time_decade_70');
        if (trackYear >= 1980 && trackYear <= 1989) unlock('time_decade_80');
        if (trackYear >= 1990 && trackYear <= 1999) unlock('time_decade_90');
        if (trackYear >= 2000 && trackYear <= 2009) unlock('time_decade_2000');
        if (trackYear >= 2010 && trackYear <= 2019) unlock('time_decade_2010');
        if (trackYear >= 2020) unlock('time_decade_2020');
        if (currentYear - trackYear >= 40) unlock('time_ancient_gem');
        if (trackYear === currentYear) unlock('time_brand_new');
      }

      // Title word length
      const words = (context.track.title || '').trim().split(/\s+/).filter(Boolean);
      if (words.length >= 5) unlock('acc_exact_title');

      // Genres
      const g = String(context.track.genre || '').toLowerCase();
      if (g.includes('rock')) unlock('genre_rock');
      if (g.includes('pop')) unlock('genre_pop');
      if (g.includes('electro') || g.includes('dance') || g.includes('edm') || g.includes('techno')) unlock('genre_electro');
      if (g.includes('rap') || g.includes('hip') || g.includes('trap')) unlock('genre_rap');
      if (g.includes('r&b') || g.includes('soul') || g.includes('funk')) unlock('genre_rnb');
      if (g.includes('metal')) unlock('genre_metal');
      if (g.includes('français') || g.includes('variété') || g.includes('chanson')) unlock('genre_french');
      if (g.includes('ost') || g.includes('film') || g.includes('game') || g.includes('soundtrack')) unlock('genre_soundtrack');

    } else {
      consecutiveWins = 0;
      consecutiveFirstSteps = 0;
      consecutiveHardcore = 0;
      consecutiveReverse = 0;
      consecutiveClutch = 0;
      consecutiveYearWins = 0;
    }

    // Check stats aggregates if available
    try {
      const stats = typeof chargerStats === 'function' ? chargerStats() : null;
      if (stats && stats.parties) {
        const total = stats.parties.total || 0;
        const victoires = stats.parties.victoires || 0;
        if (victoires >= 5) unlock('acc_win_5');
        if (victoires >= 20) unlock('acc_win_20');
        if (victoires >= 50) unlock('acc_win_50');
        if (victoires >= 100) unlock('acc_win_100');
        if (victoires >= 250) unlock('acc_win_250');
      }
    } catch (_) {}
  }

  function renderGallery() {
    const grid = document.getElementById('trophies-grid');
    if (!grid || typeof SONGLESS_TROPHIES === 'undefined') return;

    const list = SONGLESS_TROPHIES.filter(t => currentFilter === 'all' || t.cat === currentFilter);
    grid.innerHTML = list.map(t => {
      const isUnlocked = unlockedTrophies.has(t.id);
      return `
        <div class="trophy-card${isUnlocked ? ' unlocked' : ' locked'}" data-trophy-id="${t.id}">
          <div class="trophy-card-header">
            <span class="trophy-card-icon">${isUnlocked ? t.icon : '🔒'}</span>
            <span class="trophy-status-pill">${isUnlocked ? 'Débloqué ✓' : 'Verrouillé'}</span>
          </div>
          <strong class="trophy-card-name">${escapeHtml(t.name)}</strong>
          <p class="trophy-card-desc">${escapeHtml(t.desc)}</p>
        </div>
      `;
    }).join('');
    syncTrophyCountBadge();
  }

  function openTrophiesModal() {
    const modal = document.getElementById('trophies-modal');
    if (!modal) return;
    renderGallery();
    modal.classList.remove('hidden');
  }

  function bindEvents() {
    const openBtn = document.getElementById('trophies-btn');
    if (openBtn) openBtn.addEventListener('click', openTrophiesModal);

    const closeBtn = document.getElementById('trophies-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        const m = document.getElementById('trophies-modal');
        if (m) m.classList.add('hidden');
      });
    }

    const modal = document.getElementById('trophies-modal');
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }

    const filters = document.getElementById('trophies-filter-chips');
    if (filters) {
      filters.addEventListener('click', e => {
        const btn = e.target.closest('[data-trophy-filter]');
        if (!btn) return;
        filters.querySelectorAll('.chip-action').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-trophy-filter') || 'all';
        renderGallery();
      });
    }

    syncTrophyCountBadge();
  }

  document.addEventListener('DOMContentLoaded', bindEvents);

  window.songlessTrophies = {
    unlock,
    evaluateRound,
    openTrophiesModal,
    getUnlockedIds: () => [...unlockedTrophies],
    getUnlockedCount: () => unlockedTrophies.size,
    getTotalCount: () => (typeof SONGLESS_TROPHIES !== 'undefined' ? SONGLESS_TROPHIES.length : 105),
  };
})();
