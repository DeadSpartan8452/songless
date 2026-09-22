(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SonglessSourceBalance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clean = value => String(value || '').trim().slice(0, 100);
  const key = value => clean(value).normalize('NFKC').toLocaleLowerCase('fr');
  function source(label, playlistId = '') {
    const name = clean(label);
    if (!name && !playlistId) return {id: 'legacy', label: 'Origine non renseignée', kind: 'legacy'};
    return {id: playlistId ? 'playlist:' + clean(playlistId) : 'label:' + key(name),
      label: name || 'Playlist YouTube', kind: playlistId ? 'playlist' : 'label'};
  }
  function sourceOf(track) {
    const item = track && track.importSource;
    if (!item || !clean(item.id) || !clean(item.label)) return source('');
    return {id: String(item.id).slice(0, 120), label: clean(item.label), kind: clean(item.kind)};
  }
  function random(seed) {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return function () {
      h += 0x6D2B79F5;
      let t = Math.imul(h ^ h >>> 15, 1 | h);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(items, rng) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function identity(item) { return item.videoId ? 'video:' + item.videoId : String(item.id); }
  function group(tracks, excludedIds = []) {
    const excluded = new Set(excludedIds);
    const groups = new Map();
    for (const track of tracks) {
      const info = sourceOf(track);
      if (excluded.has(info.id)) continue;
      if (!groups.has(info.id)) groups.set(info.id, {...info, items: []});
      groups.get(info.id).items.push(track);
    }
    return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  function select(tracks, count, options = {}) {
    const requested = Math.min(500, Math.max(1, Math.floor(Number(count) || 30)));
    const rng = random(options.seed || 'songless');
    const groups = group(tracks, options.excludedIds || []).map(bucket => ({...bucket,
      items: shuffle(bucket.items.slice().sort((a,b) => String(a.id).localeCompare(String(b.id))), rng), selected: 0}));
    const seen = new Set(), selected = [];
    while (selected.length < requested) {
      const available = groups.filter(g => g.items.length);
      if (!available.length) break;
      const minimum = Math.min(...available.map(g => g.selected));
      const bucket = shuffle(available.filter(g => g.selected === minimum), rng)[0];
        let item;
        while (bucket.items.length) {
          const next = bucket.items.pop();
          if (!seen.has(identity(next))) { item = next; break; }
        }
      if (!item) continue;
      selected.push(item); seen.add(identity(item)); bucket.selected++;
    }
    return {selected, requested, missing: requested - selected.length,
      sources: groups.map(({id,label,selected}) => ({id,label,count:selected}))};
  }
  return {source, sourceOf, random, shuffle, identity, group, select};
});
