'use strict';

(function () {
  let items = [];
  let editingId = null;
  let hostParty = null;
  let partyRefreshTimer = null;
  let cleanupReport = null;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);
  const api = (url, options = {}) => window.songlessShared.api(url, options);
  const notify = (message, type = 'info') => {
    if (typeof showToast === 'function') showToast(message, type);
  };
  const availableTracks = () => typeof tracks !== 'undefined' && Array.isArray(tracks) ? tracks : [];
  const selectedTracks = () => typeof playlist !== 'undefined' && Array.isArray(playlist) ? playlist : availableTracks();
  const trackById = id => availableTracks().find(track => String(track.id) === String(id));

  function statusLabel(status) {
    return ({ draft: 'Brouillon', collecting: 'Collecte ouverte', locked: 'Verrouillée', archived: 'Archivée' })[status] || status;
  }

  async function refresh() {
    try {
      const result = await api('/api/playlists');
      items = Array.isArray(result.playlists) ? result.playlists : [];
      document.dispatchEvent(new CustomEvent('songless:playlists-updated', {
        detail: { collections: items },
      }));
      render();
      renderPartySources();
      if (editingId) openEditor(editingId, false);
      if (hostParty) renderPartyPanel();
      return items;
    } catch (error) {
      notify(error.message, 'error');
      return [];
    }
  }

  function filteredItems() {
    const query = String(byId('playlist-filter') && byId('playlist-filter').value || '').trim().toLocaleLowerCase('fr-FR');
    const status = byId('playlist-status-filter') && byId('playlist-status-filter').value || 'active';
    return items.filter(item => {
      if (status === 'active' && item.status === 'archived') return false;
      if (status === 'archived' && item.status !== 'archived') return false;
      return !query || `${item.nom} ${item.description || ''}`.toLocaleLowerCase('fr-FR').includes(query);
    });
  }

  function render() {
    const zone = byId('collection-list');
    if (!zone) return;
    const filtered = filteredItems();
    if (!filtered.length) {
      zone.innerHTML = '<p class="empty-note">Aucune playlist dans ce filtre.</p>';
      return;
    }
    const cleanupHtml = cleanupReport ? `<div class="playlist-card">
      <div><h4>À ranger, pas à supprimer automatiquement</h4>
      <p>${cleanupReport.total} morceau(x) ne figurent dans aucune playlist et n’ont jamais été joués. Vérifie-les dans la bibliothèque avant toute décision.</p></div>
      <div class="playlist-card-actions"><button class="ghost-btn" type="button" data-cleanup-dismiss>Masquer</button></div>
    </div>` : '';
    const recent = items.flatMap(item => (item.activity || []).filter(entry => entry.type === 'track-added')
      .map(entry => ({ ...entry, playlistName: item.nom })))
      .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
    const recentHtml = recent.length ? `<details class="playlist-activity"><summary>Ajouts de soirée récents (${recent.length})</summary>
      ${recent.map(entry => {
        const track = trackById(entry.trackId);
        return `<div class="playlist-activity-entry"><strong>${escapeHtml(track && track.title || 'Morceau')}</strong> · ${escapeHtml(entry.playlistName)} · ${escapeHtml(entry.profileName || 'Hôte')}</div>`;
      }).join('')}</details>` : '';
    zone.innerHTML = cleanupHtml + recentHtml + filtered.map(item => {
      const summary = item.summary || {};
      const people = Array.isArray(summary.contributors) ? summary.contributors.length : 0;
      const estimate = Number(summary.estimatedPartyMinutes) || Math.max(1, Math.round((item.trackIds || []).length * 1.35));
      return `<article class="playlist-card ${item.status === 'archived' ? 'archived' : ''}" data-playlist-card="${escapeHtml(item.id)}">
        <div>
          <h4>${escapeHtml(item.nom)}</h4>
          <p>${escapeHtml(item.description || 'Aucune description.')}</p>
          <div class="playlist-card-meta">
            <span class="playlist-pill ${summary.ready ? 'ready' : 'warn'}">${Number(summary.playable) || 0}/${Number(summary.total) || 0} prêts</span>
            <span class="playlist-pill">${escapeHtml(statusLabel(item.status))}</span>
            ${item.collaborative ? `<span class="playlist-pill">${people} contributeur${people > 1 ? 's' : ''}</span>` : ''}
            ${item.quotaPerPlayer ? `<span class="playlist-pill">${item.quotaPerPlayer} + ${item.reservePerPlayer || 0} réserves</span>` : ''}
            <span class="playlist-pill">≈ ${estimate} min</span>
          </div>
        </div>
        <div class="playlist-card-actions">
          <button class="cta-btn" type="button" data-playlist-play="${escapeHtml(item.id)}">Jouer</button>
          <button class="ghost-btn accent" type="button" data-playlist-edit="${escapeHtml(item.id)}">Modifier</button>
          <button class="ghost-btn" type="button" data-playlist-duplicate="${escapeHtml(item.id)}">Recréer</button>
          <button class="ghost-btn" type="button" data-playlist-merge="${escapeHtml(item.id)}">Fusionner</button>
          <button class="ghost-btn" type="button" data-playlist-export="${escapeHtml(item.id)}">Exporter</button>
          <button class="danger-btn-text" type="button" data-playlist-archive="${escapeHtml(item.id)}">${item.status === 'archived' ? 'Restaurer' : 'Archiver'}</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderPartySources() {
    const select = byId('party-playlist-source');
    if (!select) return;
    const current = select.value || 'library';
    const options = items.filter(item => item.status !== 'archived').map(item => (
      `<option value="${escapeHtml(item.id)}">${item.collaborative ? '👥 ' : '🎵 '}${escapeHtml(item.nom)} · ${(item.trackIds || []).length}</option>`
    ));
    select.innerHTML = '<option value="library">Bibliothèque complète / sélection actuelle</option>' + options.join('');
    select.value = items.some(item => item.id === current) ? current : 'library';
    updatePartySourceHelp();
  }

  function updatePartySourceHelp() {
    const select = byId('party-playlist-source');
    const help = byId('party-playlist-source-help');
    if (!select || !help) return;
    const item = items.find(entry => entry.id === select.value);
    help.textContent = item
      ? `${item.trackIds.length} morceau${item.trackIds.length > 1 ? 'x' : ''} · ${statusLabel(item.status)}${item.collaborative ? ' · les joueurs pourront proposer leurs choix dans le lobby' : ''}.`
      : 'Tous les morceaux correspondant aux filtres de l’écran Jouer.';
  }

  async function createPlaylist(trackIds, empty = false) {
    const input = byId('collection-name');
    const nom = String(input && input.value || '').trim();
    if (!nom) return notify('Donne un nom à la playlist.', 'warn');
    const ids = empty ? [] : [...new Set((trackIds || []).map(String))];
    try {
      const created = await api('/api/playlists', {
        method: 'POST',
        body: JSON.stringify({ nom, trackIds: ids, status: 'draft' }),
      });
      if (input) input.value = '';
      await refresh();
      openEditor(created.id);
      notify(`Playlist « ${created.nom} » créée.`, 'ok');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function fillEditor(item) {
    byId('playlist-editor-title').textContent = `Modifier « ${item.nom} »`;
    byId('playlist-edit-name').value = item.nom || '';
    byId('playlist-edit-description').value = item.description || '';
    byId('playlist-edit-collaborative').value = String(Boolean(item.collaborative));
    byId('playlist-edit-quota').value = String(item.quotaPerPlayer || 0);
    byId('playlist-edit-status').value = item.status || 'draft';
    byId('playlist-edit-timer').value = String(item.settings && item.settings.timerMinutes || 0);
    byId('playlist-edit-theme-type').value = item.settings && item.settings.themeType || 'none';
    byId('playlist-edit-theme-value').value = item.settings && item.settings.themeValue || '';
    byId('playlist-edit-hide').checked = item.settings ? item.settings.hideOthers !== false : true;
    byId('playlist-edit-fair').checked = item.settings ? item.settings.fairOrder !== false : true;
    byId('playlist-edit-artists').checked = item.settings ? item.settings.avoidSameArtist !== false : true;
    byId('playlist-edit-explicit').checked = Boolean(item.settings && item.settings.explicitFilter);
    renderEditorTracks(item);
    renderActivity(item);
    const summary = item.summary || {};
    byId('playlist-edit-summary').innerHTML = `<strong>${Number(summary.playable) || 0} morceaux prêts</strong>
      · ${Number(summary.missing && summary.missing.length) || 0} fichier(s) absent(s)
      · soirée estimée à ${Number(summary.estimatedPartyMinutes) || 1} min.`;
  }

  function openEditor(id, show = true) {
    const item = items.find(entry => entry.id === id);
    if (!item) return;
    editingId = id;
    fillEditor(item);
    if (show) byId('playlist-editor-modal').classList.remove('hidden');
  }

  function closeEditor() {
    editingId = null;
    byId('playlist-editor-modal').classList.add('hidden');
  }

  function renderEditorTracks(item) {
    const zone = byId('playlist-track-list');
    const query = String(byId('playlist-track-filter').value || '').toLocaleLowerCase('fr-FR');
    const rows = (item.trackIds || []).map((trackId, index) => {
      const track = trackById(trackId);
      const label = track ? `${track.title || ''} ${track.artist || ''}` : 'morceau indisponible';
      if (query && !label.toLocaleLowerCase('fr-FR').includes(query)) return '';
      const credits = (item.contributions || []).filter(entry => entry.trackId === trackId);
      return `<div class="playlist-track-row ${track ? '' : 'missing'}" data-track-id="${escapeHtml(trackId)}">
        <span class="playlist-track-index">${index + 1}</span>
        <span class="playlist-track-copy">
          <strong>${escapeHtml(track ? track.title : 'Fichier manquant')}</strong>
          <small>${escapeHtml(track && track.artist || '')}${credits.length ? ` · proposé par ${escapeHtml([...new Set(credits.map(entry => entry.profileName))].join(', '))}` : ''}</small>
        </span>
        <span class="playlist-track-actions">
          <button class="ghost-btn" type="button" data-track-up title="Monter">↑</button>
          <button class="ghost-btn" type="button" data-track-down title="Descendre">↓</button>
          <button class="danger-btn-text" type="button" data-track-remove>Retirer</button>
        </span>
      </div>`;
    }).join('');
    zone.innerHTML = rows || '<p class="empty-note">Aucun morceau dans cette playlist.</p>';
  }

  function renderActivity(item) {
    const zone = byId('playlist-activity-list');
    const entries = (item.activity || []).slice(-30).reverse();
    zone.innerHTML = entries.length ? entries.map(entry => (
      `<div class="playlist-activity-entry"><strong>${escapeHtml(entry.profileName || 'Songless')}</strong> · ${escapeHtml(entry.label || entry.type)} <small>${new Date(entry.at).toLocaleString('fr-FR')}</small></div>`
    )).join('') : '<p class="empty-note">Aucune activité enregistrée.</p>';
  }

  async function saveEditor() {
    const item = items.find(entry => entry.id === editingId);
    if (!item) return;
    const timerMinutes = Number(byId('playlist-edit-timer').value) || 0;
    const status = byId('playlist-edit-status').value;
    const deadlineAt = status === 'collecting' && timerMinutes
      ? new Date(Date.now() + timerMinutes * 60_000).toISOString() : null;
    const quota = Number(byId('playlist-edit-quota').value) || 0;
    try {
      await api(`/api/playlists/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          nom: byId('playlist-edit-name').value,
          description: byId('playlist-edit-description').value,
          collaborative: byId('playlist-edit-collaborative').value === 'true',
          quotaPerPlayer: quota,
          reservePerPlayer: quota ? 2 : 0,
          status,
          deadlineAt,
          settings: {
            timerMinutes,
            themeType: byId('playlist-edit-theme-type').value,
            themeValue: byId('playlist-edit-theme-value').value,
            hideOthers: byId('playlist-edit-hide').checked,
            fairOrder: byId('playlist-edit-fair').checked,
            avoidSameArtist: byId('playlist-edit-artists').checked,
            explicitFilter: byId('playlist-edit-explicit').checked,
          },
        }),
      });
      await refresh();
      notify('Playlist enregistrée.', 'ok');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function addSelection() {
    if (!editingId) return;
    const ids = selectedTracks().map(track => String(track.id));
    if (!ids.length) return notify('La sélection actuelle est vide.', 'warn');
    try {
      const result = await api(`/api/playlists/${encodeURIComponent(editingId)}/tracks-bulk`, {
        method: 'POST', body: JSON.stringify({ trackIds: ids }),
      });
      await refresh();
      notify(`${result.added} morceau${result.added > 1 ? 'x' : ''} ajouté${result.added > 1 ? 's' : ''}.`, result.added ? 'ok' : 'warn');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function moveTrack(trackId, delta) {
    const item = items.find(entry => entry.id === editingId);
    if (!item) return;
    const order = [...item.trackIds];
    const index = order.indexOf(trackId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await api(`/api/playlists/${encodeURIComponent(item.id)}/order`, {
      method: 'PUT', body: JSON.stringify({ trackIds: order }),
    });
    await refresh();
  }

  async function fillPlaylist() {
    if (!editingId) return;
    const count = Math.min(500, Math.max(1, Number(prompt('Combien de morceaux ajouter ?', '10')) || 10));
    try {
      const result = await api(`/api/playlists/${encodeURIComponent(editingId)}/fill`, {
        method: 'POST', body: JSON.stringify({ count }),
      });
      await refresh();
      notify(`${result.added} morceau${result.added > 1 ? 'x' : ''} ajouté${result.added > 1 ? 's' : ''}.`, 'ok');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function partySelection() {
    const select = byId('party-playlist-source');
    const item = select && items.find(entry => entry.id === select.value);
    return item ? { id: item.id, trackIds: [...item.trackIds], collaborative: item.collaborative,
      status: item.status, nom: item.nom } : null;
  }

  function bindParty(nextParty) {
    hostParty = nextParty;
    clearInterval(partyRefreshTimer);
    if (!hostParty) return renderPartyPanel();
    renderPartyPanel();
    partyRefreshTimer = setInterval(refresh, 2500);
  }

  function renderPartyPanel() {
    const panel = byId('playlist-party-panel');
    if (!panel) return;
    const selection = partySelection();
    if (!hostParty || !selection || !selection.collaborative) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    const item = items.find(entry => entry.id === selection.id);
    if (!item) return;
    const summary = item.summary || {};
    const total = Number(summary.total) || 0;
    const ready = Number(summary.playable) || 0;
    const deadline = item.deadlineAt ? new Date(item.deadlineAt) : null;
    const deadlineLabel = deadline && Number.isFinite(deadline.getTime())
      ? ` · collecte jusqu’à ${deadline.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="playlist-party-live">
      <img src="/api/party/${encodeURIComponent(hostParty.code)}/playlist-qr.svg" alt="QR pour rejoindre la playlist participative">
      <div>
        <span class="eyebrow">PLAYLIST PARTICIPATIVE</span>
        <h4>${escapeHtml(item.nom)}</h4>
        <p>${ready}/${total} morceaux prêts · ${Array.isArray(summary.contributors) ? summary.contributors.length : 0} contributeur(s) · ≈ ${summary.estimatedPartyMinutes || 1} min${deadlineLabel}</p>
        <div class="playlist-party-progress"><span style="width:${total ? Math.round(ready * 100 / total) : 0}%"></span></div>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" data-party-playlist-refresh>Actualiser</button>
          <button class="ghost-btn accent" type="button" data-party-playlist-open>Modifier</button>
          <button class="cta-btn" type="button" data-party-playlist-lock>Verrouiller et préparer la partie</button>
        </div>
      </div>
    </div>`;
  }

  async function applyPartyPlaylist() {
    const selection = partySelection();
    if (!selection || !hostParty) return;
    const item = items.find(entry => entry.id === selection.id);
    const summary = item && item.summary || {};
    if (!confirm(`Préparer la partie avec ${Number(summary.playable) || 0} morceaux prêts (environ ${Number(summary.estimatedPartyMinutes) || 1} minutes) et fermer les propositions ?`)) return;
    try {
      const result = await api(`/api/playlists/${encodeURIComponent(selection.id)}/apply-to-party`, {
        method: 'POST', body: JSON.stringify({ code: hostParty.code, hostToken: hostParty.hostToken, lock: true }),
      });
      hostParty.trackIds = result.trackIds;
      await refresh();
      notify(`${result.trackIds.length} morceaux prêts, ordre équilibré appliqué.`, 'ok');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function importFile(file) {
    try {
      const payload = JSON.parse(await file.text());
      const result = await api('/api/playlists/import', { method: 'POST', body: JSON.stringify(payload) });
      await refresh();
      notify(`${result.found} morceaux retrouvés, ${result.missingCount} absents.`, result.missingCount ? 'warn' : 'ok');
      if (result.missingCount && Array.isArray(result.missing)
        && confirm(`${result.missingCount} morceau(x) manquent. Les télécharger maintenant dans la bibliothèque permanente ?`)) {
        await resolveImportedMissing(result.playlist.id, result.missing);
      }
    } catch (error) {
      notify(`Import impossible : ${error.message}`, 'error');
    }
  }

  async function downloadOne(reference, onProgress) {
    const query = reference.videoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(reference.videoId)}`
      : `${reference.title || ''} ${reference.artist || ''}`.trim();
    const response = await fetch('/api/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sourceLabel: 'Import de playlist' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Erreur ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = null;
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const raw of events) {
        const event = (raw.match(/^event:\s*(.+)$/m) || [])[1];
        const json = (raw.match(/^data:\s*(.+)$/m) || [])[1];
        const data = json ? JSON.parse(json) : {};
        if (event === 'progress' && data.message && onProgress) onProgress(data.message);
        if (event === 'error') throw new Error(data.error || 'Téléchargement impossible.');
        if (event === 'done') done = data;
      }
      if (part.done) break;
    }
    return done && done.track && done.track.id;
  }

  async function resolveImportedMissing(playlistId, missing) {
    let added = 0;
    let failed = 0;
    for (let index = 0; index < missing.length; index++) {
      const reference = missing[index];
      notify(`Import ${index + 1}/${missing.length} · ${reference.title || 'morceau'}…`);
      try {
        const trackId = await downloadOne(reference);
        if (!trackId) throw new Error('Identifiant absent');
        const result = await api(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
          method: 'POST', body: JSON.stringify({ trackId }),
        });
        if (result.added || result.duplicate) added++;
      } catch (_) { failed++; }
    }
    await refresh();
    notify(`${added} morceau(x) récupéré(s), ${failed} échec(s).`, failed ? 'warn' : 'ok');
  }

  async function mergeInto(targetId) {
    const sources = items.filter(item => item.id !== targetId && item.status !== 'archived');
    if (!sources.length) return notify('Aucune autre playlist à fusionner.', 'warn');
    const list = sources.map((item, index) => `${index + 1}. ${item.nom}`).join('\n');
    const choice = prompt(`Quelle playlist fusionner ?\n${list}`, '1');
    const source = sources[Number(choice) - 1];
    if (!source) return;
    try {
      const result = await api(`/api/playlists/${encodeURIComponent(targetId)}/merge`, {
        method: 'POST', body: JSON.stringify({ sourceIds: [source.id] }),
      });
      await refresh();
      notify(`${result.added} nouveau(x) morceau(x) fusionné(s).`, 'ok');
    } catch (error) { notify(error.message, 'error'); }
  }

  async function showCleanupCandidates() {
    try {
      cleanupReport = await api('/api/playlists/cleanup-candidates');
      render();
      notify('Diagnostic affiché. Aucun morceau n’a été supprimé.', 'ok');
    } catch (error) { notify(error.message, 'error'); }
  }

  function bindEvents() {
    byId('playlist-create-empty-btn').addEventListener('click', () => createPlaylist([], true));
    byId('playlist-refresh-btn').addEventListener('click', refresh);
    byId('playlist-cleanup-btn').addEventListener('click', showCleanupCandidates);
    byId('playlist-filter').addEventListener('input', render);
    byId('playlist-status-filter').addEventListener('change', render);
    byId('party-playlist-source').addEventListener('change', () => { updatePartySourceHelp(); renderPartyPanel(); });
    byId('playlist-editor-close').addEventListener('click', closeEditor);
    byId('playlist-edit-save').addEventListener('click', saveEditor);
    byId('playlist-edit-fill').addEventListener('click', fillPlaylist);
    byId('playlist-add-selection').addEventListener('click', addSelection);
    byId('playlist-track-filter').addEventListener('input', () => {
      const item = items.find(entry => entry.id === editingId);
      if (item) renderEditorTracks(item);
    });
    byId('playlist-import-btn').addEventListener('click', () => byId('playlist-import-file').click());
    byId('playlist-import-file').addEventListener('change', event => {
      const file = event.target.files && event.target.files[0];
      if (file) importFile(file);
      event.target.value = '';
    });
    byId('playlist-editor-modal').addEventListener('click', event => {
      if (event.target === byId('playlist-editor-modal')) closeEditor();
    });

    byId('collection-list').addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button) return;
      const edit = button.dataset.playlistEdit;
      const play = button.dataset.playlistPlay;
      const duplicate = button.dataset.playlistDuplicate;
      const archive = button.dataset.playlistArchive;
      const exported = button.dataset.playlistExport;
      const merge = button.dataset.playlistMerge;
      if (edit) openEditor(edit);
      if (play) {
        const item = items.find(entry => entry.id === play);
        if (item && window.songlessExpansions && window.songlessExpansions.startPlaylist) {
          window.songlessExpansions.startPlaylist(item.trackIds, item.nom);
        }
      }
      if (duplicate) {
        await api(`/api/playlists/${encodeURIComponent(duplicate)}/duplicate`, { method: 'POST', body: '{}' });
        await refresh();
        notify('La soirée a été recréée dans une nouvelle playlist.', 'ok');
      }
      if (merge) await mergeInto(merge);
      if (archive) {
        const item = items.find(entry => entry.id === archive);
        if (item && item.status === 'archived') {
          await api(`/api/playlists/${encodeURIComponent(archive)}`, {
            method: 'PUT', body: JSON.stringify({ status: 'draft' }),
          });
        } else {
          await api(`/api/playlists/${encodeURIComponent(archive)}`, { method: 'DELETE' });
        }
        await refresh();
      }
      if (exported) location.href = `/api/playlists/${encodeURIComponent(exported)}/export`;
      if (button.hasAttribute('data-cleanup-dismiss')) {
        cleanupReport = null;
        render();
      }
    });

    byId('playlist-track-list').addEventListener('click', async event => {
      const row = event.target.closest('[data-track-id]');
      if (!row || !editingId) return;
      const trackId = row.dataset.trackId;
      if (event.target.closest('[data-track-up]')) await moveTrack(trackId, -1);
      if (event.target.closest('[data-track-down]')) await moveTrack(trackId, 1);
      if (event.target.closest('[data-track-remove]')) {
        await api(`/api/playlists/${encodeURIComponent(editingId)}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
        await refresh();
      }
    });

    byId('playlist-party-panel').addEventListener('click', event => {
      if (event.target.closest('[data-party-playlist-refresh]')) refresh();
      if (event.target.closest('[data-party-playlist-open]')) {
        const selection = partySelection();
        if (selection) openEditor(selection.id);
      }
      if (event.target.closest('[data-party-playlist-lock]')) applyPartyPlaylist();
    });
  }

  window.songlessPlaylists = {
    refresh,
    createFromSelection: ids => createPlaylist(ids, false),
    partySelection,
    bindParty,
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    refresh();
  });
})();
