'use strict';

(() => {
  const els = Object.fromEntries([
    'review-total', 'review-filter', 'review-search', 'review-position', 'artwork-index',
    'track-artwork', 'review-cover', 'review-title', 'current-artist', 'issue-tags',
    'review-audio', 'review-form', 'artist-input', 'genre-input', 'known-genres',
    'genre-detail-input', 'language-input', 'known-subgenres',
    'artist-state', 'genre-state', 'save-button', 'save-status', 'previous-button',
    'skip-button', 'queue-total', 'queue-progress-fill', 'queue-list', 'queue-footer-text',
    'focus-card', 'review-empty', 'reload-button',
  ].map(id => [id, document.getElementById(id)]));

  let allTracks = [];
  let totalLibraryCount = 0;
  let queue = [];
  let visible = [];
  let currentId = null;
  let savedCount = 0;
  let skippedCount = 0;

  const esc = value => String(value ?? '');
  const needsArtist = track => {
    const artist = String(track.artist || '').trim();
    return !artist || artist === 'Artiste inconnu'
      || !['high', 'medium'].includes(track.artistConfidence || 'unknown');
  };
  const needsGenre = track => {
    const genre = String(track.genre || '').trim();
    return !genre || genre === 'Autre'
      || !['high', 'medium'].includes(track.genreConfidence || 'unknown');
  };
  const needsLanguage = track => !String(track.language || '').trim();

  function matchesFilter(track) {
    const artist = needsArtist(track);
    const genre = needsGenre(track);
    switch (els['review-filter'].value) {
      case 'artist': return artist;
      case 'genre': return genre;
      case 'both': return artist && genre;
      case 'language': return needsLanguage(track);
      default: return artist || genre;
    }
  }

  function refreshQueue() {
    const oldId = currentId;
    queue = allTracks.filter(matchesFilter);
    const query = els['review-search'].value.trim().toLocaleLowerCase('fr');
    visible = query
      ? queue.filter(track => `${track.title} ${track.artist}`.toLocaleLowerCase('fr').includes(query))
      : queue;
    currentId = visible.some(track => track.id === oldId) ? oldId : visible[0]?.id ?? null;
    render();
  }

  function statusTags(track) {
    const tags = [];
    if (needsArtist(track)) tags.push('Artiste');
    if (needsGenre(track)) tags.push('Genre');
    if (needsLanguage(track)) tags.push('Langue');
    return tags;
  }

  function renderQueue() {
    els['queue-list'].replaceChildren();
    const fragment = document.createDocumentFragment();
    visible.forEach((track, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `queue-item${track.id === currentId ? ' active' : ''}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(track.id === currentId));
      button.dataset.id = track.id;

      const number = document.createElement('span');
      number.className = 'queue-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const copy = document.createElement('span');
      copy.className = 'queue-item-copy';
      const title = document.createElement('span');
      title.className = 'queue-item-title';
      title.textContent = esc(track.title) || 'Titre à vérifier';
      const artist = document.createElement('span');
      artist.className = 'queue-item-artist';
      artist.textContent = esc(track.artist) || 'Artiste inconnu';
      copy.append(title, artist);
      const flags = document.createElement('span');
      flags.className = 'queue-item-flags';
      flags.textContent = statusTags(track).join(' + ');
      button.append(number, copy, flags);
      button.addEventListener('click', () => {
        currentId = track.id;
        render();
      });
      fragment.append(button);
    });
    els['queue-list'].append(fragment);
    els['queue-total'].textContent = String(visible.length);
    const denominator = Math.max(queue.length + savedCount, 1);
    const progress = Math.min(100, (savedCount / denominator) * 100);
    els['queue-progress-fill'].style.width = `${progress}%`;
    els['queue-footer-text'].textContent = `${savedCount} validée${savedCount > 1 ? 's' : ''} · ${skippedCount} passée${skippedCount > 1 ? 's' : ''}`;
  }

  function renderCurrent() {
    const track = visible.find(item => item.id === currentId);
    if (!track) {
      els['focus-card'].classList.add('hidden');
      els['review-empty'].classList.remove('hidden');
      els['review-empty'].querySelector('h2').textContent = queue.length ? 'Aucun résultat.' : 'Tout est classé.';
      els['review-empty'].querySelector('p:not(.eyebrow)').textContent = queue.length
        ? 'Essaie un autre titre ou change le filtre.'
        : 'Il n’y a plus de fiche à reprendre avec ce filtre.';
      els['review-position'].textContent = '— / —';
      return;
    }

    els['focus-card'].classList.remove('hidden');
    els['review-empty'].classList.add('hidden');
    const index = visible.findIndex(item => item.id === track.id);
    const serial = String(index + 1).padStart(3, '0');
    els['review-position'].textContent = `${String(index + 1).padStart(2, '0')} / ${String(visible.length).padStart(2, '0')}`;
    els['artwork-index'].textContent = serial;
    els['review-title'].textContent = esc(track.title) || 'Titre à vérifier';
    els['current-artist'].textContent = track.artist ? `Artiste actuel · ${track.artist}` : 'Aucun artiste enregistré';
    els['artist-input'].value = track.artist || '';
    els['genre-input'].value = track.genre && track.genre !== 'Autre' ? track.genre : '';
    els['genre-detail-input'].value = track.genreDetail || '';
    els['language-input'].value = track.language || '';
    els['artist-state'].textContent = needsArtist(track) ? 'À confirmer' : 'Renseigné';
    els['genre-state'].textContent = needsGenre(track) ? 'À confirmer' : 'Renseigné';
    els['issue-tags'].replaceChildren(...statusTags(track).map(label => {
      const tag = document.createElement('span');
      tag.className = 'issue-tag';
      tag.textContent = `${label} à vérifier`;
      return tag;
    }));
    const audioUrl = `/api/tracks/${encodeURIComponent(track.id)}/audio`;
    if (els['review-audio'].dataset.trackId !== track.id) {
      els['review-audio'].pause();
      els['review-audio'].src = audioUrl;
      els['review-audio'].dataset.trackId = track.id;
      els['review-cover'].src = `/api/tracks/${encodeURIComponent(track.id)}/cover`;
      els['review-cover'].onerror = () => { els['review-cover'].src = 'default-cover.svg'; };
      els['review-cover'].alt = `Pochette de ${esc(track.title)}`;
    }
    els['previous-button'].disabled = visible.length < 2;
    els['save-status'].textContent = '';
    els['save-status'].className = 'save-status';
    els['save-button'].disabled = false;
  }

  function render() {
    els['review-total'].textContent = String(queue.length);
    renderCurrent();
    renderQueue();
  }

  async function loadLibrary() {
    els['queue-footer-text'].textContent = 'Lecture des fiches…';
    try {
      const [trackResponse, genreResponse] = await Promise.all([
        fetch('/api/tracks'),
        fetch('/api/genres'),
      ]);
      if (!trackResponse.ok) throw new Error(`Bibliothèque inaccessible (${trackResponse.status})`);
      allTracks = await trackResponse.json();
      if (genreResponse.ok) {
        const data = await genreResponse.json();
        els['known-genres'].replaceChildren(...(data.all || []).filter(name => name !== 'Autre').map(name => {
          const option = document.createElement('option');
          option.value = name;
          return option;
        }));
      }
      const subgenres = [...new Set(allTracks.map(track => track.genreDetail).filter(Boolean))];
      const suggested = [...els['known-subgenres'].options].map(option => option.value);
      els['known-subgenres'].replaceChildren(...[...new Set([...suggested, ...subgenres])].map(value => {
        const option = document.createElement('option');
        option.value = value;
        return option;
      }));
      refreshQueue();
      totalLibraryCount = allTracks.length;
      els['queue-footer-text'].textContent = `${totalLibraryCount.toLocaleString('fr-FR')} fichiers dans la bibliothèque locale`;
    } catch (error) {
      els['review-title'].textContent = 'Impossible de lire la bibliothèque';
      els['current-artist'].textContent = error.message;
      els['queue-footer-text'].textContent = 'Vérifie que Songless est lancé sur cet appareil.';
      els['focus-card'].classList.remove('hidden');
      els['review-empty'].classList.add('hidden');
      els['review-form'].classList.add('hidden');
    }
  }

  function move(step) {
    if (!visible.length) return;
    const index = visible.findIndex(track => track.id === currentId);
    const next = (index + step + visible.length) % visible.length;
    currentId = visible[next].id;
    render();
  }

  els['review-filter'].addEventListener('change', refreshQueue);
  els['review-search'].addEventListener('input', refreshQueue);
  els['skip-button'].addEventListener('click', () => {
    skippedCount++;
    move(1);
  });
  els['previous-button'].addEventListener('click', () => move(-1));
  els['reload-button'].addEventListener('click', loadLibrary);
  els['review-form'].addEventListener('submit', async event => {
    event.preventDefault();
    const track = visible.find(item => item.id === currentId);
    if (!track) return;
    const artist = els['artist-input'].value.trim();
    const genre = els['genre-input'].value.trim();
    const genreDetail = els['genre-detail-input'].value.trim();
    const language = els['language-input'].value.trim();
    const languageOnly = els['review-filter'].value === 'language';
    if (languageOnly ? !language : (!artist || !genre)) {
      els['save-status'].textContent = languageOnly
        ? 'Renseigne une langue, ou passe ce morceau sans le modifier.'
        : 'Renseigne artiste et genre, ou passe ce morceau sans le modifier.';
      els['save-status'].className = 'save-status error';
      return;
    }

    els['save-button'].disabled = true;
    els['save-status'].textContent = 'Enregistrement local…';
    els['save-status'].className = 'save-status';
    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(languageOnly
          ? { language }
          : {
            artist,
            genre,
            genreDetail,
            language,
            genreSource: 'manual',
            genreConfidence: 'high',
          }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);

      const savedIndex = visible.findIndex(item => item.id === track.id);
      const nextId = visible[savedIndex + 1]?.id
        || visible.find(item => item.id !== track.id)?.id
        || null;
      savedCount++;
      allTracks = allTracks.filter(item => item.id !== track.id);
      currentId = nextId;
      refreshQueue();
      els['save-status'].textContent = `Fiche enregistrée · ${artist} · ${genre}`;
      els['save-status'].className = 'save-status success';
    } catch (error) {
      els['save-button'].disabled = false;
      els['save-status'].textContent = `Enregistrement impossible : ${error.message}`;
      els['save-status'].className = 'save-status error';
    }
  });

  loadLibrary();
})();
