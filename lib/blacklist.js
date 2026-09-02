'use strict';

const TARGET_TYPES = Object.freeze([
  'track', 'artist', 'genre', 'theme', 'year', 'decade',
]);
const DURATION_TYPES = Object.freeze([
  'parties', 'hours', 'days', 'weeks', 'until',
]);
const MODE_IDS = Object.freeze([
  'all', 'solo_title', 'solo_artist', 'solo_year',
  'classic', 'buzzer', 'royale', 'duel',
]);

function text(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function key(value) {
  return text(value, 300)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr');
}

function iso(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function id(value) {
  const clean = text(value, 80).replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || `bl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanModes(values) {
  const source = Array.isArray(values) ? values : [values || 'all'];
  const modes = [...new Set(source.map(value => text(value, 30)))]
    .filter(value => MODE_IDS.includes(value));
  if (!modes.length || modes.includes('all')) return ['all'];
  return modes;
}

function durationEnd(type, amount, until, now) {
  if (type === 'until') return iso(until);
  const multipliers = {
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  };
  return multipliers[type]
    ? new Date(now.getTime() + amount * multipliers[type]).toISOString()
    : null;
}

function normalizeRule(input, previous = null, nowValue = new Date()) {
  const source = input && typeof input === 'object' ? input : {};
  const now = new Date(nowValue);
  const targetType = TARGET_TYPES.includes(source.targetType)
    ? source.targetType : (previous && previous.targetType) || 'track';
  const durationType = DURATION_TYPES.includes(source.durationType)
    ? source.durationType : (previous && previous.durationType) || 'parties';
  const targetValue = text(source.targetValue !== undefined
    ? source.targetValue : previous && previous.targetValue, 300);
  if (!targetValue) throw new Error('La cible de l’exclusion est obligatoire.');

  const rawAmount = source.durationAmount !== undefined
    ? source.durationAmount : previous && previous.durationAmount;
  const durationAmount = Math.min(9999, Math.max(1, Math.floor(Number(rawAmount) || 1)));
  const sameDuration = previous
    && previous.durationType === durationType
    && Number(previous.durationAmount) === durationAmount
    && source.until === undefined;
  const persistedEnd = !previous ? iso(source.endsAt) : null;
  const endsAt = durationType === 'parties'
    ? null
    : (sameDuration
      ? previous.endsAt
      : persistedEnd || durationEnd(durationType, durationAmount, source.until || source.endsAt, now));
  if (durationType !== 'parties' && !endsAt) {
    throw new Error('La date de fin de l’exclusion est invalide.');
  }
  if (endsAt && new Date(endsAt).getTime() <= now.getTime()) {
    throw new Error('La fin de l’exclusion doit être dans le futur.');
  }

  const remainingParties = durationType === 'parties'
    ? Math.min(durationAmount, Math.max(0, Math.floor(Number(
      source.remainingParties !== undefined
        ? source.remainingParties
        : previous && previous.durationType === 'parties'
          ? previous.remainingParties : durationAmount
    ) || 0)))
    : null;

  return {
    id: previous ? previous.id : id(source.id),
    targetType,
    targetValue,
    durationType,
    durationAmount,
    remainingParties,
    endsAt,
    modes: cleanModes(source.modes !== undefined ? source.modes : previous && previous.modes),
    reason: text(source.reason !== undefined ? source.reason : previous && previous.reason, 240),
    active: source.active === undefined ? (previous ? previous.active !== false : true) : source.active !== false,
    createdAt: previous ? previous.createdAt : (iso(source.createdAt) || now.toISOString()),
    updatedAt: previous ? now.toISOString() : (iso(source.updatedAt) || now.toISOString()),
  };
}

function isExpired(rule, nowValue = new Date()) {
  if (!rule) return false;
  if (rule.durationType === 'parties') return Number(rule.remainingParties) <= 0;
  return Boolean(rule.endsAt && new Date(rule.endsAt).getTime() <= new Date(nowValue).getTime());
}

function appliesToMode(rule, mode) {
  const modes = cleanModes(rule && rule.modes);
  return modes.includes('all') || modes.includes(text(mode, 30));
}

function matches(rule, track, mode, nowValue = new Date()) {
  if (!rule || rule.active === false || isExpired(rule, nowValue) || !appliesToMode(rule, mode)) return false;
  const wanted = key(rule.targetValue);
  const year = Math.floor(Number(track && track.year) || 0);
  switch (rule.targetType) {
    case 'track': return key(track && track.id) === wanted;
    case 'artist': return key(track && track.artist) === wanted;
    case 'genre': return key(track && track.genre) === wanted;
    case 'theme': {
      const themes = [track && track.theme, track && track.genreDetail]
        .concat(Array.isArray(track && track.tags) ? track.tags : []);
      return themes.some(value => key(value) === wanted);
    }
    case 'year': return year > 0 && String(year) === wanted;
    case 'decade': return year > 0 && String(Math.floor(year / 10) * 10) === wanted.replace(/s$/, '');
    default: return false;
  }
}

function evaluate(tracks, rules, mode, nowValue = new Date()) {
  const activeRules = (Array.isArray(rules) ? rules : [])
    .filter(rule => rule && rule.active !== false && !isExpired(rule, nowValue));
  const allowed = [];
  const excluded = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const matchedRules = activeRules.filter(rule => matches(rule, track, mode, nowValue));
    if (matchedRules.length) excluded.push({ track, rules: matchedRules });
    else allowed.push(track);
  }
  return { allowed, excluded };
}

function purgeExpired(rules, nowValue = new Date()) {
  return (Array.isArray(rules) ? rules : []).filter(rule => !isExpired(rule, nowValue));
}

function consumeParty(rules, mode, nowValue = new Date()) {
  return purgeExpired(rules, nowValue).map(rule => {
    if (rule.active === false || rule.durationType !== 'parties' || !appliesToMode(rule, mode)) return rule;
    return {
      ...rule,
      remainingParties: Math.max(0, Number(rule.remainingParties) - 1),
      updatedAt: new Date(nowValue).toISOString(),
    };
  }).filter(rule => !isExpired(rule, nowValue));
}

module.exports = {
  TARGET_TYPES,
  DURATION_TYPES,
  MODE_IDS,
  normalizeRule,
  isExpired,
  appliesToMode,
  matches,
  evaluate,
  purgeExpired,
  consumeParty,
};
