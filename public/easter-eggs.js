'use strict';

(function () {
  const rendered = new Map();

  function remove(surface) {
    const current = document.getElementById(`songless-easter-egg-${surface}`);
    if (current) current.remove();
    rendered.delete(surface);
  }

  function addText(parent, tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = String(value || '');
    parent.appendChild(element);
    return element;
  }

  function portalScene(root, egg) {
    const outcome = egg.phase === 'reveal' ? egg.outcome : egg.phase;
    const success = outcome === 'success';
    const hint = egg.phase === 'hint';
    root.classList.add('portal-scene', hint ? 'is-hint' : success ? 'is-success' : 'is-failure');

    const chamber = document.createElement('div');
    chamber.className = 'portal-chamber';
    chamber.setAttribute('aria-hidden', 'true');
    chamber.innerHTML = `
      <span class="portal-ring portal-ring-blue"></span>
      <span class="portal-ring portal-ring-orange"></span>
      <span class="portal-cake"><i></i><b></b><em></em></span>
      <span class="portal-flame"></span>`;
    if (success) {
      for (let index = 0; index < 18; index++) {
        const particle = document.createElement('i');
        particle.className = 'portal-confetti';
        particle.style.setProperty('--portal-i', String(index));
        chamber.appendChild(particle);
      }
    }
    root.appendChild(chamber);

    const copy = document.createElement('div');
    copy.className = 'easter-egg-copy';
    addText(copy, 'small', 'easter-egg-kicker', hint ? 'SIGNAL ANORMAL' : 'CHAMBRE DE TEST');
    addText(copy, 'strong', 'easter-egg-title', hint
      ? 'Une présence derrière le mur…'
      : success ? 'Le gâteau existe.' : 'Test non validé.');
    addText(copy, 'span', 'easter-egg-text', egg.text);
    root.appendChild(copy);
  }

  function genericScene(root, egg) {
    root.classList.add('generic-easter-egg');
    addText(root, 'small', 'easter-egg-kicker', 'EASTER EGG');
    addText(root, 'strong', 'easter-egg-title', egg.theme || egg.id);
    addText(root, 'span', 'easter-egg-text', egg.text);
  }

  function render(egg, options = {}) {
    const surface = String(options.surface || 'default').replace(/[^a-z0-9_-]/gi, '');
    if (!egg || !egg.id) {
      remove(surface);
      return null;
    }
    const signature = `${egg.id}:${egg.phase}:${egg.outcome || ''}:${egg.text || ''}`;
    const existing = document.getElementById(`songless-easter-egg-${surface}`);
    if (existing && rendered.get(surface) === signature) return existing;
    if (existing) existing.remove();

    const root = document.createElement('section');
    root.id = `songless-easter-egg-${surface}`;
    root.className = `songless-easter-egg surface-${surface}`;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', egg.phase === 'hint' ? 'polite' : 'assertive');
    root.dataset.easterEgg = egg.id;
    root.dataset.phase = egg.phase;
    if (egg.outcome) root.dataset.outcome = egg.outcome;

    if (egg.id === 'portal') portalScene(root, egg);
    else genericScene(root, egg);
    document.body.appendChild(root);
    rendered.set(surface, signature);

    const outcome = egg.phase === 'reveal' ? egg.outcome : egg.phase;
    if (outcome === 'success' && window.songlessTrophies
        && typeof window.songlessTrophies.record === 'function') {
      window.songlessTrophies.record('easter_egg', {
        id: egg.id, outcome: 'success',
      }, `${options.partyCode || ''}:${options.round || 0}:${egg.id}:success`);
    }
    return root;
  }

  window.songlessEasterEggs = { remove, render };
})();
