'use strict';

const T = require('./titles');

function editDistanceLimited(left, right, limit = 2) {
  const a = String(left || '');
  const b = String(right || '');
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function suggestionScore(query, primary, value, artist, originalTitle, aliases) {
  const q = T.norm(query);
  const main = T.norm(primary);
  const full = T.norm(value);
  const performer = T.norm(artist);
  const original = T.norm(originalTitle);
  const other = (aliases || []).map(T.norm).filter(Boolean);
  const fields = [main, full, performer, original, ...other].filter(Boolean);
  if (!q || !fields.length) return Infinity;
  if (fields.includes(q)) return 0;
  if (main.startsWith(q)) return 1;
  if (main.split(' ').some(word => word.startsWith(q))) return 2;
  if (full.startsWith(q)) return 3;
  if (main.includes(q)) return 4;
  if (performer.startsWith(q)) return 5;
  if ([original, ...other].some(field => field.startsWith(q))) return 6;
  if (fields.some(field => field.includes(q))) return 7;
  if (q.length < 4) return Infinity;
  let best = Infinity;
  for (const field of fields) {
    for (const candidate of [field, ...field.split(' ')]) {
      const comparable = candidate.slice(0, q.length + 2);
      best = Math.min(best, editDistanceLimited(q, comparable, 2));
    }
  }
  return best <= 2 ? 8 + best : Infinity;
}

function suggestions({ query, answerMode, fileNames, metadata, limit = 8 }) {
  const cleanQuery = String(query || '').trim().slice(0, 80);
  if (!T.norm(cleanQuery)) return [];
  const results = [];
  const seen = new Set();

  for (const fileName of fileNames || []) {
    const meta = metadata && metadata[fileName] || {};
    const fallback = T.fromFilename(fileName);
    const title = String(meta.title || fallback.title || '').trim();
    const artist = String(meta.artist || fallback.artist || '').trim();
    const year = Number(meta.year) || null;
    const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
    const originalTitle = String(meta.originalTitle || '').trim();
    let value = '';
    let primary = '';
    let secondary = '';

    if (answerMode === 'artiste') {
      value = artist;
      primary = artist;
      secondary = 'Artiste';
    } else if (answerMode === 'annee') {
      if (!year) continue;
      value = String(year);
      primary = value;
      secondary = 'Année';
    } else {
      value = artist ? `${artist} - ${title}` : title;
      primary = title;
      secondary = [
        artist,
        originalTitle && T.norm(originalTitle) !== T.norm(title)
          ? `titre original : ${originalTitle}` : '',
      ].filter(Boolean).join(' · ');
    }

    const priority = suggestionScore(
      cleanQuery, primary, value, artist, originalTitle, aliases
    );
    const valueKey = T.tightKey(value);
    if (!valueKey || !Number.isFinite(priority) || seen.has(valueKey)) continue;
    seen.add(valueKey);
    results.push({
      value: value.slice(0, 200),
      primary: primary.slice(0, 200),
      secondary: secondary.slice(0, 200),
      priority,
    });
  }

  results.sort((left, right) => left.priority - right.priority
    || left.primary.length - right.primary.length
    || left.primary.localeCompare(right.primary, 'fr'));
  return results.slice(0, Math.max(0, Number(limit) || 8))
    .map(({ priority, ...item }) => item);
}

module.exports = { editDistanceLimited, suggestionScore, suggestions };
