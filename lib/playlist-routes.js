'use strict';

const playlistTools = require('./playlists');

function registerPlaylistRoutes(app, deps) {
  const {
    playerStore,
    partyStore,
    allBuiltTracks,
    validPartyTrackIds,
    qrCode,
    isHostRequest,
  } = deps;

  // Défense en profondeur : ces routes restent protégées même si le garde-fou
  // réseau global est déplacé un jour. Le cookie hôte ou l'application Android
  // locale est indispensable ; une simple boucle locale ne suffit pas sur PC.
  app.use('/api/playlists', (req, res, next) => {
    if (!isHostRequest(req)) {
      return res.status(403).json({ error: 'Cette fonction est réservée à l’hôte Songless.' });
    }
    next();
  });

  const trackMap = async () => {
    const tracks = await allBuiltTracks();
    return { tracks, byId: new Map(tracks.map(track => [String(track.id), track])) };
  };

  function partyPlayer(req) {
    const party = partyStore.get(req.params.code);
    if (!party) throw Object.assign(new Error('Partie introuvable.'), { status: 404 });
    const player = partyStore.findPlayer(party, req.body && req.body.playerToken
      || req.query && req.query.playerToken);
    if (!player) throw Object.assign(new Error('Jeton joueur invalide.'), { status: 403 });
    return { party, player };
  }

  function activePlaylist(party) {
    const item = playerStore.playlistById(party.settings && party.settings.playlistId);
    if (!item) throw Object.assign(new Error('Aucune playlist participative n’est liée à cette partie.'), { status: 404 });
    return item;
  }

  function publicPlaylist(item, player, byId) {
    const own = item.contributions.filter(entry => entry.profileId === player.profileId);
    const visibleIds = item.settings.hideOthers && item.status === 'collecting'
      ? new Set(own.map(entry => entry.trackId)) : new Set(item.trackIds);
    const counts = playlistTools.contributionCounts(item, player.profileId);
    return {
      id: item.id,
      nom: item.nom,
      description: item.description,
      status: item.status,
      collaborative: item.collaborative,
      quotaPerPlayer: item.quotaPerPlayer,
      reservePerPlayer: item.reservePerPlayer,
      deadlineAt: item.deadlineAt,
      settings: item.settings,
      progress: counts,
      total: item.trackIds.length,
      tracks: item.trackIds.filter(trackId => visibleIds.has(trackId)).map(trackId => {
        const track = byId.get(trackId) || {};
        const credits = item.contributions.filter(entry => entry.trackId === trackId);
        const ratings = (item.ratings || []).filter(entry => entry.trackId === trackId);
        const myRating = ratings.find(entry => entry.profileId === player.profileId);
        return {
          id: trackId,
          title: track.title || 'Morceau indisponible',
          artist: track.artist || '',
          missing: !byId.has(trackId),
          mine: credits.some(entry => entry.profileId === player.profileId),
          reserve: credits.some(entry => entry.profileId === player.profileId && entry.reserve),
          contributors: item.settings.hideOthers && item.status === 'collecting'
            ? [] : credits.map(entry => entry.profileName),
          rating: ratings.reduce((sum, entry) => sum + entry.value, 0),
          myRating: myRating ? myRating.value : 0,
        };
      }),
    };
  }

  function themeAllows(item, track) {
    const type = item.settings.themeType;
    const value = String(item.settings.themeValue || '').trim().toLocaleLowerCase('fr-FR');
    if (!value || type === 'none') return true;
    if (type === 'genre') return String(track.genre || '').toLocaleLowerCase('fr-FR') === value;
    if (type === 'decade') {
      const decade = Number.parseInt(value, 10);
      return Number.isFinite(decade) && Number(track.year) >= decade && Number(track.year) <= decade + 9;
    }
    const haystack = `${track.title || ''} ${track.artist || ''} ${track.genre || ''}`.toLocaleLowerCase('fr-FR');
    return haystack.includes(value);
  }

  function explicitAllowed(item, track) {
    if (!item.settings.explicitFilter) return true;
    return !/\b(explicit|uncensored|nsfw|18\+|paroles? crues?)\b/i.test(`${track.title || ''} ${track.artist || ''}`);
  }

  function finalTrackIds(item, byId) {
    const available = new Set(validPartyTrackIds(item.trackIds));
    const credited = new Set(item.contributions.map(entry => entry.trackId));
    const chosen = [];
    const groups = new Map();
    for (const entry of item.contributions) {
      if (!available.has(entry.trackId)) continue;
      const track = byId.get(entry.trackId);
      if (!track || !themeAllows(item, track) || !explicitAllowed(item, track)) continue;
      const group = groups.get(entry.profileId) || { main: [], reserve: [] };
      const target = entry.reserve ? group.reserve : group.main;
      if (!target.includes(entry.trackId)) target.push(entry.trackId);
      groups.set(entry.profileId, group);
    }
    for (const group of groups.values()) {
      const quota = item.quotaPerPlayer || group.main.length;
      const main = group.main.slice(0, quota);
      const reserve = group.reserve.slice(0, Math.max(0, quota - main.length));
      for (const trackId of [...main, ...reserve]) if (!chosen.includes(trackId)) chosen.push(trackId);
    }
    for (const trackId of item.trackIds) {
      const track = byId.get(trackId);
      if (!available.has(trackId) || credited.has(trackId) || !track
        || !themeAllows(item, track) || !explicitAllowed(item, track)) continue;
      if (!chosen.includes(trackId)) chosen.push(trackId);
    }
    if (!item.settings.fairOrder) return item.trackIds.filter(trackId => chosen.includes(trackId));
    const temporary = {
      ...item,
      trackIds: chosen,
      contributions: item.contributions.filter(entry => chosen.includes(entry.trackId))
        .map(entry => ({ ...entry, reserve: false })),
    };
    return playlistTools.fairOrder(temporary, byId);
  }

  app.get('/api/playlists', async (_req, res) => {
    const { tracks } = await trackMap();
    res.json({ playlists: playerStore.allPlaylists().map(item => ({
      ...item,
      summary: playlistTools.summary(item, tracks),
    })) });
  });

  app.get('/api/playlists/cleanup-candidates', async (req, res) => {
    if (!isHostRequest(req)) {
      return res.status(403).json({ error: 'Diagnostic réservé à l’hôte Songless.' });
    }
    const { tracks } = await trackMap();
    const referenced = new Set(playerStore.allPlaylists().flatMap(item => item.trackIds));
    const played = new Set(playerStore.publicState().profiles
      .flatMap(profile => profile.history || []).map(entry => String(entry.id || '')));
    const candidates = tracks.filter(track => !referenced.has(String(track.id))
      && !played.has(String(track.id))).slice(0, 500).map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      importSource: track.importSource,
    }));
    res.json({ candidates, total: candidates.length,
      note: 'Suggestions seulement : aucun fichier n’est supprimé automatiquement.' });
  });

  app.post('/api/playlists', (req, res) => {
    try {
      res.status(201).json(playerStore.createPlaylist(req.body || {}));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/playlists/:id', (req, res) => {
    try {
      const item = playerStore.updatePlaylist(req.params.id, req.body || {});
      if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/playlists/:id', (req, res) => {
    const item = playerStore.playlistById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
    if (req.query.permanent !== '1') {
      return res.json(playerStore.updatePlaylist(item.id, { status: 'archived' }));
    }
    if (String(req.body && req.body.confirmName || '') !== item.nom) {
      return res.status(400).json({ error: 'Recopie le nom exact pour supprimer définitivement la playlist.' });
    }
    playerStore.deletePlaylist(item.id);
    res.status(204).end();
  });

  app.post('/api/playlists/:id/duplicate', (req, res) => {
    const item = playerStore.duplicatePlaylist(req.params.id, req.body && req.body.nom);
    if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
    res.status(201).json(item);
  });

  app.post('/api/playlists/:id/merge', (req, res) => {
    try {
      const target = playerStore.playlistById(req.params.id);
      if (!target) return res.status(404).json({ error: 'Playlist introuvable.' });
      const sourceIds = Array.isArray(req.body && req.body.sourceIds) ? req.body.sourceIds : [];
      let added = 0;
      for (const sourceId of sourceIds.slice(0, 20)) {
        const source = playerStore.playlistById(sourceId);
        if (!source || source.id === target.id) continue;
        for (const trackId of source.trackIds) {
          const result = playerStore.addPlaylistTrack(target.id, {
            trackId,
            profileId: 'songless_merge',
            profileName: `Fusion · ${source.nom}`,
          }, { host: true });
          if (result && result.added) added++;
        }
      }
      res.json({ added, playlist: playerStore.playlistById(target.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/playlists/:id/tracks', (req, res) => {
    try {
      const valid = validPartyTrackIds([req.body && req.body.trackId]);
      if (!valid.length) return res.status(400).json({ error: 'Morceau absent ou illisible.' });
      const result = playerStore.addPlaylistTrack(req.params.id, {
        trackId: valid[0],
        profileId: 'songless_host',
        profileName: 'Hôte',
        reserve: Boolean(req.body && req.body.reserve),
      }, { host: true });
      if (!result) return res.status(404).json({ error: 'Playlist introuvable.' });
      res.status(result.added ? 201 : 200).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/playlists/:id/tracks-bulk', (req, res) => {
    try {
      const values = Array.isArray(req.body && req.body.trackIds) ? req.body.trackIds : [];
      const valid = validPartyTrackIds(values.slice(0, 5000));
      if (!playerStore.playlistById(req.params.id)) {
        return res.status(404).json({ error: 'Playlist introuvable.' });
      }
      let added = 0;
      for (const trackId of valid) {
        const result = playerStore.addPlaylistTrack(req.params.id, {
          trackId,
          profileId: 'songless_host',
          profileName: 'Hôte',
        }, { host: true });
        if (result && result.added) added++;
      }
      res.json({ added, accepted: valid.length, playlist: playerStore.playlistById(req.params.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/playlists/:id/tracks/:trackId', (req, res) => {
    const result = playerStore.removePlaylistTrack(req.params.id, req.params.trackId, {
      profileId: 'songless_host', profileName: 'Hôte',
    });
    if (!result) return res.status(404).json({ error: 'Playlist introuvable.' });
    res.json(result);
  });

  app.put('/api/playlists/:id/order', (req, res) => {
    try {
      const item = playerStore.reorderPlaylist(req.params.id, req.body && req.body.trackIds);
      if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/playlists/:id/export', async (req, res) => {
    const item = playerStore.playlistById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
    const { byId } = await trackMap();
    const references = item.trackIds.map(trackId => {
      const track = byId.get(trackId) || {};
      return { trackId, title: track.title || '', artist: track.artist || '',
        videoId: track.videoId || null };
    });
    const payload = { format: 'songless-playlist', version: 2, playlist: item, references };
    res.set('Content-Disposition', `attachment; filename="playlist-${item.id}.json"`);
    res.type('application/json').send(`${JSON.stringify(payload, null, 2)}\n`);
  });

  app.post('/api/playlists/import', async (req, res) => {
    const payload = req.body && req.body.format === 'songless-playlist' ? req.body.playlist : null;
    if (!payload) return res.status(400).json({ error: 'Fichier de playlist Songless invalide.' });
    const { tracks } = await trackMap();
    const found = new Set(validPartyTrackIds(payload.trackIds));
    const references = Array.isArray(req.body.references) ? req.body.references.slice(0, 5000) : [];
    const missing = [];
    for (const reference of references) {
      if (found.has(String(reference.trackId || ''))) continue;
      const query = `${reference.title || ''} ${reference.artist || ''}`.trim();
      const match = playlistTools.searchLibrary(tracks, query, 1)[0];
      if (match && match.match === 'strong') found.add(String(match.id));
      else missing.push({ title: String(reference.title || '').slice(0, 200),
        artist: String(reference.artist || '').slice(0, 200), videoId: reference.videoId || null });
    }
    const item = playerStore.createPlaylist({
      ...payload,
      id: null,
      nom: `${payload.nom || 'Playlist importée'} — import`,
      trackIds: [...found],
      contributions: [],
      activity: [],
      status: 'draft',
    });
    res.status(201).json({ playlist: item, found: found.size, missing,
      missingCount: Math.max(missing.length, (payload.trackIds || []).length - found.size) });
  });

  app.post('/api/playlists/:id/fill', async (req, res) => {
    try {
      const item = playerStore.playlistById(req.params.id);
      if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
      const { tracks } = await trackMap();
      const candidates = tracks.filter(track => !item.trackIds.includes(String(track.id))
        && themeAllows(item, track) && explicitAllowed(item, track));
      const count = Math.min(500, Math.max(1, Number(req.body && req.body.count) || 10));
      for (let index = candidates.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
      }
      let added = 0;
      for (const track of candidates.slice(0, count)) {
        const result = playerStore.addPlaylistTrack(item.id, {
          trackId: track.id,
          profileId: 'songless_auto',
          profileName: 'Complément Songless',
        }, { host: true });
        if (result && result.added) added++;
      }
      res.json({ added, playlist: playerStore.playlistById(item.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/playlists/:id/apply-to-party', async (req, res) => {
    try {
      const party = partyStore.get(req.body && req.body.code);
      if (!party) return res.status(404).json({ error: 'Partie introuvable.' });
      const item = playerStore.playlistById(req.params.id);
      if (!item) return res.status(404).json({ error: 'Playlist introuvable.' });
      const { tracks, byId } = await trackMap();
      const order = playlistTools.balanceTeams(finalTrackIds(item, byId), item, party);
      if (!order.length) return res.status(400).json({ error: 'Aucun morceau prêt dans cette playlist.' });
      partyStore.setTrackIds(party, req.body.hostToken, order);
      if (req.body.lock !== false) playerStore.updatePlaylist(item.id, { status: 'locked' });
      playerStore.markPlaylistPlayed(item.id);
      res.json({ trackIds: order, summary: playlistTools.summary(item, tracks),
        state: partyStore.publicState(party, null, req.body.hostToken) });
    } catch (error) {
      res.status(403).json({ error: error.message });
    }
  });

  app.get('/api/party/:code/playlist', async (req, res) => {
    try {
      const { party, player } = partyPlayer(req);
      const item = activePlaylist(party);
      const { byId } = await trackMap();
      res.json(publicPlaylist(item, player, byId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  app.get('/api/party/:code/playlist/search', async (req, res) => {
    try {
      const { party } = partyPlayer(req);
      const item = activePlaylist(party);
      if (item.status !== 'collecting') throw new Error('La collecte est fermée.');
      const { tracks } = await trackMap();
      const matches = playlistTools.searchLibrary(tracks, req.query.q, 16)
        .filter(track => themeAllows(item, track) && explicitAllowed(item, track));
      res.json({ matches });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  app.post('/api/party/:code/playlist/contributions', async (req, res) => {
    try {
      const { party, player } = partyPlayer(req);
      const item = activePlaylist(party);
      const valid = validPartyTrackIds([req.body && req.body.trackId]);
      if (!valid.length) throw new Error('Ce morceau n’est pas disponible dans la bibliothèque.');
      const { byId } = await trackMap();
      const track = byId.get(valid[0]);
      if (!themeAllows(item, track)) throw new Error('Ce morceau ne correspond pas au thème de la playlist.');
      if (!explicitAllowed(item, track)) throw new Error('Ce morceau est refusé par le filtre explicite.');
      const result = playerStore.addPlaylistTrack(item.id, {
        trackId: valid[0],
        profileId: player.profileId,
        profileName: player.nom,
        reserve: Boolean(req.body.reserve),
      }, { host: false });
      res.status(result.added ? 201 : 200).json(result);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  app.delete('/api/party/:code/playlist/contributions/:trackId', (req, res) => {
    try {
      const { party, player } = partyPlayer(req);
      const item = activePlaylist(party);
      if (item.status !== 'collecting') throw new Error('La collecte est fermée.');
      const result = playerStore.removePlaylistContribution(item.id, req.params.trackId, player.profileId);
      if (!result || !result.removed) return res.status(404).json({ error: 'Proposition introuvable.' });
      res.json(result);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  app.post('/api/party/:code/playlist/votes', (req, res) => {
    try {
      const { party, player } = partyPlayer(req);
      if (party.status !== 'finished') {
        throw new Error('Le vote musical ouvre après la fin de la partie.');
      }
      const item = activePlaylist(party);
      const result = playerStore.ratePlaylistTrack(item.id, {
        profileId: player.profileId,
        trackId: req.body && req.body.trackId,
        value: req.body && req.body.value,
      });
      res.json(result);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  app.get('/api/party/:code/playlist-qr.svg', async (req, res) => {
    try {
      const party = partyStore.get(req.params.code);
      if (!party) return res.status(404).send('Partie introuvable');
      const base = `${req.protocol}://${req.get('host')}`;
      const params = new URLSearchParams({ party: party.code, invite: party.inviteToken, playlist: '1' });
      const svg = await qrCode.toString(`${base}/controller.html?${params}`, {
        type: 'svg', margin: 1, width: 260,
      });
      res.type('image/svg+xml').send(svg);
    } catch (error) {
      res.status(400).send(error.message);
    }
  });
}

module.exports = registerPlaylistRoutes;
