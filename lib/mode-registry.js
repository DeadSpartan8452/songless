'use strict';

const MODE_DEFINITIONS = [
  {
    id: 'classic',
    label: 'Réponses simultanées',
    shortLabel: 'Classique',
    emoji: '🎯',
    summary: 'Tout le monde répond à son rythme pendant que les extraits s’allongent.',
    minPlayers: 1,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'buzzer',
    label: 'Mode Buzzer',
    shortLabel: 'Buzzer',
    emoji: '🔔',
    summary: 'Le premier au buzzer bloque la musique et dispose de dix secondes pour répondre.',
    minPlayers: 2,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: true,
      progressiveExcerpts: false,
      simultaneousAnswers: false,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'royale',
    label: 'Battle Royale · 3 vies',
    shortLabel: 'Battle Royale',
    emoji: '👑',
    summary: 'Chaque manche ratée coûte une vie ; les éliminés suivent la fin en fantômes.',
    minPlayers: 2,
    maxPlayers: null,
    capabilities: {
      teams: false,
      elimination: true,
      lives: true,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'duel',
    label: 'Duel · Tir à la corde',
    shortLabel: 'Duel',
    emoji: '🥊',
    summary: 'Deux joueurs ou deux équipes tirent la corde en trouvant mieux que l’adversaire.',
    minPlayers: 2,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'confidence',
    label: 'Mode Confiance',
    shortLabel: 'Confiance',
    emoji: '🎲',
    summary: 'Choisis ton audace avant chaque réponse : plus tu risques, plus tu peux gagner.',
    minPlayers: 1,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
      confidence: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'cooperation',
    label: 'Mode Coopération',
    shortLabel: 'Coopération',
    emoji: '🤝',
    summary: 'Un score, une série et trois vies en commun ; chacun garde sa contribution.',
    minPlayers: 2,
    maxPlayers: null,
    capabilities: {
      teams: false,
      elimination: false,
      lives: true,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
      cooperation: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'intruder',
    label: 'Mode Intrus',
    shortLabel: 'Intrus',
    emoji: '🕵️',
    summary: 'Quatre propositions, une seule différence certaine à repérer et expliquer.',
    minPlayers: 1,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: false,
      simultaneousAnswers: true,
      intruder: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'auction',
    label: 'Mode Enchères',
    shortLabel: 'Enchères',
    emoji: '🔨',
    summary: 'Annonce l’extrait le plus court que tu peux reconnaître ; le plus audacieux répond d’abord.',
    minPlayers: 2,
    maxPlayers: null,
    capabilities: {
      teams: false,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: false,
      simultaneousAnswers: false,
      auction: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
];

function freezeDefinition(definition) {
  Object.freeze(definition.capabilities);
  Object.freeze(definition.surfaces);
  return Object.freeze(definition);
}

for (const definition of MODE_DEFINITIONS) freezeDefinition(definition);
Object.freeze(MODE_DEFINITIONS);

const MODES_BY_ID = new Map(MODE_DEFINITIONS.map(mode => [mode.id, mode]));

function getMode(modeId) {
  return MODES_BY_ID.get(String(modeId || '')) || null;
}

function normalizeModeId(modeId) {
  return getMode(modeId) ? String(modeId) : 'classic';
}

function hasCapability(modeId, capability) {
  const mode = getMode(modeId);
  return Boolean(mode && mode.capabilities[capability]);
}

function publicModes() {
  return MODE_DEFINITIONS.map(mode => ({
    ...mode,
    capabilities: { ...mode.capabilities },
    surfaces: [...mode.surfaces],
  }));
}

module.exports = {
  getMode,
  hasCapability,
  normalizeModeId,
  publicModes,
};
