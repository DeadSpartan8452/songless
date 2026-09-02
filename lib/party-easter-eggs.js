'use strict';

const PHASES = new Set(['hint', 'success', 'failure', 'reveal']);

const CATALOG = Object.freeze({
  portal: Object.freeze({
    id: 'portal',
    theme: 'portal',
    hint: 'Quelque chose vous observe depuis une autre chambre de test…',
    successText: 'Le gâteau est bien réel. Cette fois.',
    failureText: 'The cake is a lie',
    revealText: 'The cake is a lie',
  }),
});

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeDefinition(input) {
  const requested = typeof input === 'string' ? { id: input }
    : input && typeof input === 'object' ? input : {};
  const requestedId = clean(requested.id, 40).replace(/[^a-z0-9_-]/gi, '');
  const source = requestedId && CATALOG[requestedId]
    ? { ...CATALOG[requestedId], ...requested, id: requestedId }
    : requested;
  const id = clean(source.id, 40).replace(/[^a-z0-9_-]/gi, '');
  if (!id) return null;
  return {
    id,
    theme: clean(source.theme || id, 40).replace(/[^a-z0-9_-]/gi, ''),
    hint: clean(source.hint, 240),
    successText: clean(source.successText, 240),
    failureText: clean(source.failureText, 240),
    revealText: clean(source.revealText, 240),
  };
}

function lastAttempt(player) {
  const attempts = player && Array.isArray(player.attempts) ? player.attempts : [];
  return attempts.length ? attempts[attempts.length - 1] : null;
}

function playerVerdict(player) {
  if (!player) return null;
  if (player.found && player.correct === true) return 'success';
  const attempt = lastAttempt(player);
  // Un échec n’est définitif qu’après épuisement réel des tentatives. Un skip,
  // même sur le dernier palier, ne devient donc jamais un « guess false ».
  if (player.finished && player.correct === false && attempt && attempt.type === 'failed') {
    return 'failure';
  }
  return null;
}

function payload(definition, phase, outcome = null) {
  if (!definition || !PHASES.has(phase)) return null;
  let text = '';
  if (phase === 'hint') text = definition.hint;
  else if (phase === 'success') text = definition.successText || definition.revealText;
  else if (phase === 'failure') text = definition.failureText || definition.revealText;
  else text = definition.revealText
      || (outcome === 'success' ? definition.successText : definition.failureText);
  return {
    id: definition.id,
    theme: definition.theme,
    phase,
    outcome,
    text,
  };
}

function publicState(party, viewer, role) {
  const definition = party && party.easterEgg;
  if (!definition) return null;

  if (party.mode === 'indice' && party.status === 'round') {
    return payload(definition, 'hint');
  }

  const anySuccess = (party.players || []).some(player => playerVerdict(player) === 'success');
  if (party.status !== 'round') {
    const outcome = anySuccess ? 'success' : 'failure';
    return payload(definition, 'reveal', outcome);
  }

  const verdict = playerVerdict(viewer);
  if (verdict) return payload(definition, verdict, verdict);

  // Les écrans partagés peuvent célébrer une bonne réponse déjà donnée. En
  // revanche, ils ne diffusent jamais l’échec individuel d’un joueur pendant
  // que les autres jouent.
  if (['tv', 'host'].includes(role) && anySuccess) {
    return payload(definition, 'success', 'success');
  }
  return null;
}

module.exports = { CATALOG, playerVerdict, publicState, sanitizeDefinition };
