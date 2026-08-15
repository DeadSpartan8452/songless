'use strict';

// Couche commune aux profils, collections, défis et parties réseau.
// Le code d'appairage n'est jamais écrit dans le projet : il est aléatoire à
// chaque lancement en mode téléphone et reste dans le stockage du navigateur.
(function () {
  const pairFromUrl = new URLSearchParams(location.search).get('pair');
  if (pairFromUrl) {
    try { localStorage.setItem('songless_pair', pairFromUrl); } catch (_) {}
    const url = new URL(location.href);
    url.searchParams.delete('pair');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function pairToken() {
    try { return localStorage.getItem('songless_pair') || ''; } catch (_) { return ''; }
  }

  function pairHeaders(extra = {}) {
    const headers = { ...extra };
    const pair = pairToken();
    if (pair) headers['X-Songless-Pair'] = pair;
    return headers;
  }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const pair = pairToken();
    if (pair) headers.set('X-Songless-Pair', pair);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(data && data.error ? data.error : `Erreur ${response.status}`);
    return data;
  }

  function localProfilePayload(profile) {
    if (!profile) return null;
    const get = (key, fallback) => {
      try { return JSON.parse(localStorage.getItem(`${key}:${profile.id}`) || JSON.stringify(fallback)); }
      catch (_) { return fallback; }
    };
    return {
      id: profile.id,
      nom: profile.nom,
      emoji: profile.emoji,
      stats: get('songless_stats', null),
      history: get('songless_historique', []),
      settings: get('songless_reglages', {}),
    };
  }

  function writeServerProfiles(state) {
    if (!state || !Array.isArray(state.profiles) || state.profiles.length === 0) return;
    let active = null;
    try {
      const local = JSON.parse(localStorage.getItem('songless_profils') || 'null');
      active = local && local.actif;
    } catch (_) {}
    if (!state.profiles.some(p => p.id === active)) active = state.profiles[0].id;
    try {
      localStorage.setItem('songless_profils', JSON.stringify({
        actif: active,
        liste: state.profiles.map(p => ({
          id: p.id,
          nom: p.nom,
          emoji: p.emoji,
          multiplayer: p.multiplayer || {},
        })),
      }));
      for (const p of state.profiles) {
        if (p.stats) localStorage.setItem(`songless_stats:${p.id}`, JSON.stringify(p.stats));
        if (p.history) localStorage.setItem(`songless_historique:${p.id}`, JSON.stringify(p.history));
        if (p.settings) localStorage.setItem(`songless_reglages:${p.id}`, JSON.stringify(p.settings));
      }
      localStorage.setItem('songless_collections', JSON.stringify(state.collections || []));
      localStorage.setItem('songless_defis', JSON.stringify(state.challenges || []));
    } catch (_) {}
  }

  let ready = false;
  let timer = null;
  const pending = new Set();

  async function flushProfiles() {
    timer = null;
    if (!ready) return;
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      const profile = typeof profils !== 'undefined' ? profils.find(p => p.id === id) : null;
      const payload = localProfilePayload(profile);
      if (!payload) continue;
      try {
        await api('/api/player/profiles', { method: 'POST', body: JSON.stringify(payload) });
      } catch (error) {
        console.warn('Profil non synchronisé :', error.message);
      }
    }
  }

  function queueProfile(id) {
    if (!id) return;
    pending.add(id);
    clearTimeout(timer);
    timer = setTimeout(flushProfiles, 350);
  }

  async function initialize() {
    try {
      let state = await api('/api/player/state');
      if (!state.profiles.length) {
        let local = null;
        try { local = JSON.parse(localStorage.getItem('songless_profils') || 'null'); } catch (_) {}
        const list = local && Array.isArray(local.liste) ? local.liste : [];
        for (const profile of list) {
          const payload = localProfilePayload(profile);
          if (payload) await api('/api/player/profiles', { method: 'POST', body: JSON.stringify(payload) });
        }
        state = await api('/api/player/state');
      }
      writeServerProfiles(state);
      ready = true;

      // Recharge l'interface après la migration sans recharger la page.
      if (typeof chargerProfils === 'function') {
        chargerProfils();
        chargerReglages();
        appliquerReglages({ relancer: false });
        majBoutonProfil();
        updateStatsDisplay();
      }
      window.dispatchEvent(new CustomEvent('songless:shared-ready', { detail: state }));
    } catch (error) {
      ready = false;
      console.warn('Profils partagés indisponibles, mode local conservé :', error.message);
      if (typeof showToast === 'function' && pairToken()) showToast(error.message, 'warn');
    }
  }

  async function saveLists(collections, challenges) {
    const state = await api('/api/player/lists', {
      method: 'PUT',
      body: JSON.stringify({ collections, challenges }),
    });
    writeServerProfiles(state);
    return state;
  }

  window.songlessShared = {
    api,
    initialize,
    queueProfile,
    saveLists,
    pairToken,
    pairHeaders,
    get ready() { return ready; },
  };
})();
