'use strict';

(function () {
  let comparisons = [];
  let decisions = [];
  let busy = false;

  const byId = id => document.getElementById(id);
  const safe = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);

  function duration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function bytes(value) {
    const size = Math.max(0, Number(value) || 0);
    if (!size) return 'taille inconnue';
    return size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
      : `${Math.round(size / 1024)} ko`;
  }

  function trackCard(track, side) {
    const meta = [track.genre, track.year, duration(track.duration), bytes(track.size)]
      .filter(Boolean).map(safe).join(' · ');
    const cover = track.hasCover
      ? `<img src="/api/tracks/${encodeURIComponent(track.id)}/cover" alt="" data-cover-fallback>`
      : '<span aria-hidden="true">🎵</span>';
    return `
      <article class="duplicate-track">
        <div class="duplicate-cover">${cover}</div>
        <div class="duplicate-track-copy">
          <span class="duplicate-side">Version ${side}</span>
          <strong>${safe(track.title)}</strong>
          <span>${safe(track.artist || 'Artiste inconnu')}</span>
          <small>${meta}</small>
        </div>
        <div class="duplicate-track-actions">
          <button class="ghost-btn small" data-duplicate-play="${safe(track.id)}">
            Écouter
          </button>
          <button class="ghost-btn small" data-duplicate-find="${safe(track.id)}">
            Retrouver
          </button>
        </div>
      </article>`;
  }

  function render() {
    const list = byId('duplicate-review-list');
    const count = byId('duplicate-review-count');
    const decisionsButton = byId('duplicate-decisions-btn');
    count.innerText = `${comparisons.length} à comparer`;
    decisionsButton.classList.toggle('hidden', decisions.length === 0);
    decisionsButton.innerText = `Paires conservées (${decisions.length})`;

    if (!comparisons.length) {
      list.innerHTML = '<div class="duplicate-empty">Aucune paire suspecte restante. Les variantes connues restent protégées.</div>';
      return;
    }

    list.innerHTML = comparisons.map(comparison => `
      <section class="duplicate-pair" data-duplicate-key="${safe(comparison.key)}">
        <div class="duplicate-pair-head">
          <span class="duplicate-confidence ${safe(comparison.confidence)}">
            ${comparison.exactFile ? 'Octets identiques' : comparison.confidence === 'high' ? 'Forte ressemblance' : 'À vérifier'}
          </span>
          <p>${safe(comparison.reason)}</p>
        </div>
        <div class="duplicate-versus">
          ${trackCard(comparison.tracks[0], 'A')}
          <span class="duplicate-vs" aria-hidden="true">VS</span>
          ${trackCard(comparison.tracks[1], 'B')}
        </div>
        <div class="duplicate-pair-actions">
          <button class="ghost-btn accent" data-duplicate-distinct="${safe(comparison.key)}">
            Conserver les deux · versions distinctes
          </button>
        </div>
      </section>`).join('');
    if (window.dessinerIcones) window.dessinerIcones();
  }

  function renderDecisions() {
    const zone = byId('duplicate-decisions');
    zone.classList.toggle('hidden');
    if (zone.classList.contains('hidden')) return;
    zone.innerHTML = decisions.length ? `
      <h4>Paires volontairement conservées</h4>
      ${decisions.map(decision => `
        <div class="duplicate-decision-row">
          <span>${decision.files.map(safe).join(' ↔ ')}</span>
          <button class="ghost-btn small" data-duplicate-restore="${safe(decision.key)}">Réexaminer</button>
        </div>`).join('')}`
      : '<p class="duplicate-empty">Aucune décision enregistrée.</p>';
  }

  async function scan() {
    if (busy) return;
    const button = byId('duplicate-review-btn');
    const status = byId('duplicate-review-status');
    busy = true;
    button.disabled = true;
    status.classList.remove('hidden');
    status.innerText = 'Comparaison des titres, artistes, durées et fichiers…';
    try {
      const response = await fetch('/api/library/duplicates');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Comparaison impossible.');
      comparisons = Array.isArray(data.comparisons) ? data.comparisons : [];
      decisions = Array.isArray(data.decisions) ? data.decisions : [];
      status.innerText = data.truncated
        ? 'Les 200 premières paires sont affichées.'
        : `${data.totalTracks} morceaux comparés · aucune suppression automatique.`;
      render();
    } catch (error) {
      status.innerText = error.message;
      if (window.showToast) window.showToast(error.message, 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  async function markDistinct(key) {
    const comparison = comparisons.find(item => item.key === key);
    if (!comparison) return;
    try {
      const response = await fetch('/api/library/duplicates/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: comparison.files,
          decision: 'distinct',
          reason: 'Versions distinctes confirmées manuellement',
        }),
      });
      const decision = await response.json();
      if (!response.ok) throw new Error(decision.error || 'Décision impossible.');
      decisions.push(decision);
      comparisons = comparisons.filter(item => item.key !== key);
      render();
      if (window.showToast) window.showToast('Les deux versions seront conservées.', 'ok');
    } catch (error) {
      if (window.showToast) window.showToast(error.message, 'error');
    }
  }

  async function restoreDecision(key) {
    try {
      const response = await fetch(`/api/library/duplicates/decision/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Restauration impossible.');
      byId('duplicate-decisions').classList.add('hidden');
      await scan();
      if (window.showToast) window.showToast('La paire revient dans les comparaisons.', 'ok');
    } catch (error) {
      if (window.showToast) window.showToast(error.message, 'error');
    }
  }

  function findTrack(id) {
    const comparison = comparisons.find(item => item.tracks.some(track => track.id === id));
    const track = comparison && comparison.tracks.find(item => item.id === id);
    const search = byId('library-search');
    const list = byId('tracks-list-container');
    if (!track || !search || !list) return;
    search.value = track.title;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = byId('duplicate-review-btn');
    if (!button) return;
    button.addEventListener('click', scan);
    byId('duplicate-decisions-btn').addEventListener('click', renderDecisions);
    byId('duplicate-review-card').addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.duplicateDistinct) markDistinct(target.dataset.duplicateDistinct);
      if (target.dataset.duplicateRestore) restoreDecision(target.dataset.duplicateRestore);
      if (target.dataset.duplicateFind) findTrack(target.dataset.duplicateFind);
      if (target.dataset.duplicatePlay) {
        const comparison = comparisons.find(item => item.tracks.some(track => track.id === target.dataset.duplicatePlay));
        const track = comparison && comparison.tracks.find(item => item.id === target.dataset.duplicatePlay);
        if (track && window.basculerApercu) window.basculerApercu(track);
      }
    });
  });
})();
