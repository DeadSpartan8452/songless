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
  {
    id: 'joker',
    label: 'Mode Joker',
    shortLabel: 'Joker',
    emoji: '🃏',
    summary: 'Trois atouts limités par joueur : réécoute, rallonge et multiplicateur de points.',
    minPlayers: 1,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
      joker: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
  {
    id: 'missions',
    label: 'Missions secrètes',
    shortLabel: 'Missions',
    emoji: '🕶️',
    summary: 'Un objectif privé par joueur, révélé et récompensé uniquement au podium.',
    minPlayers: 1,
    maxPlayers: null,
    capabilities: {
      teams: true,
      elimination: false,
      lives: false,
      buzzer: false,
      progressiveExcerpts: true,
      simultaneousAnswers: true,
      secretMissions: true,
    },
    surfaces: ['host', 'controller', 'tv', 'remote_admin'],
  },
];

const LOCAL_MODE_DEFINITIONS = [
  { id: 'solo_limited', label: 'Partie solo limitée', shortLabel: 'Partie avec une fin', emoji: '🏁', summary: 'Une partie de 5, 10, 20 ou 50 morceaux avec bilan final.', minPlayers: 1, maxPlayers: 1 },
  { id: 'solo_infinite', label: 'Partie solo sans fin', shortLabel: 'Sans fin', emoji: '♾️', summary: 'Les morceaux s’enchaînent jusqu’à l’arrêt manuel.', minPlayers: 1, maxPlayers: 1 },
  { id: 'solo_duel', label: 'Duel sur PC', shortLabel: 'Duel sur PC', emoji: '⚔️', summary: 'Un joueur affronte le bot ou deux joueurs partagent le même écran.', minPlayers: 1, maxPlayers: 2 },
  { id: 'solo_royale', label: 'Survie sur PC', shortLabel: 'Survie sur PC', emoji: '🛡️', summary: 'Trois cœurs pour tenir le plus longtemps possible.', minPlayers: 1, maxPlayers: 1 },
  { id: 'training', label: 'Entraînement intelligent', shortLabel: 'Entraînement', emoji: '🧠', summary: 'Songless cible les morceaux ratés, oubliés ou jamais joués.', minPlayers: 1, maxPlayers: 1 },
  { id: 'collections', label: 'Collections personnalisées', shortLabel: 'Collections', emoji: '📚', summary: 'Une sélection enregistrée de morceaux à rejouer librement.', minPlayers: 1, maxPlayers: 1 },
  { id: 'challenges', label: 'Défis enregistrés', shortLabel: 'Défis', emoji: '🏆', summary: 'Une partie reproductible avec la même seed, les mêmes filtres et options.', minPlayers: 1, maxPlayers: 1 },
].map(mode => ({
  ...mode,
  capabilities: {
    teams: false,
    elimination: mode.id === 'solo_royale',
    lives: mode.id === 'solo_royale',
    buzzer: false,
    progressiveExcerpts: !['solo_duel', 'solo_royale'].includes(mode.id),
    simultaneousAnswers: false,
  },
  surfaces: ['host'],
}));

// Une même fiche accompagne chaque mode sur le PC hôte. Elle évite que les
// règles, la victoire ou les possibilités à distance divergent d'un écran à
// l'autre quand un mode évolue.
const MODE_GUIDES = {
  classic: {
    duration: '10 à 30 min',
    winCondition: 'Le meilleur score après la dernière manche.',
    playerActions: ['répondre', 'passer un palier', 'voter pour passer'],
    hostControls: ['lancer', 'révéler', 'ajuster les scores', 'manche suivante'],
    tvContent: 'Extrait, progression, réponses reçues et classement.',
  },
  buzzer: {
    duration: '10 à 25 min',
    winCondition: 'Le meilleur score après la dernière manche.',
    playerActions: ['buzzer', 'répondre pendant les 10 secondes', 'voter pour passer'],
    hostControls: ['lancer', 'rouvrir le buzzer', 'révéler', 'manche suivante'],
    tvContent: 'Buzzer actif, chrono, résultat et classement.',
  },
  royale: {
    duration: '15 à 35 min',
    winCondition: 'Dernier survivant, puis duel final au meilleur de trois.',
    playerActions: ['répondre', 'passer un palier', 'suivre en fantôme après élimination'],
    hostControls: ['lancer', 'révéler', 'suivre les vies', 'manche suivante'],
    tvContent: 'Cœurs, éliminations, survivants et duel final.',
  },
  duel: {
    duration: '5 à 15 min',
    winCondition: 'Tirer la corde jusqu’au camp adverse.',
    playerActions: ['répondre', 'passer un palier', 'jouer pour son camp'],
    hostControls: ['composer les camps', 'lancer', 'révéler', 'manche suivante'],
    tvContent: 'Corde, camps, réponses et progression du duel.',
  },
  confidence: {
    duration: '10 à 30 min',
    winCondition: 'Le meilleur score après gains et pertes de confiance.',
    playerActions: ['choisir une mise', 'verrouiller la mise', 'répondre'],
    hostControls: ['lancer', 'révéler', 'contrôler les mises', 'manche suivante'],
    tvContent: 'Mises verrouillées, variations de score et rentabilité.',
  },
  cooperation: {
    duration: '10 à 30 min',
    winCondition: 'Atteindre ensemble l’objectif avant de perdre les vies communes.',
    playerActions: ['répondre', 'passer un palier', 'protéger la série commune'],
    hostControls: ['fixer l’objectif', 'lancer', 'révéler', 'manche suivante'],
    tvContent: 'Objectif, vies communes, série et contributions.',
  },
  intruder: {
    duration: '10 à 20 min',
    winCondition: 'Le meilleur score d’identification des intrus.',
    playerActions: ['examiner quatre choix', 'désigner l’intrus'],
    hostControls: ['lancer', 'révéler l’explication', 'manche suivante'],
    tvContent: 'Quatre propositions, votes puis justification.',
  },
  auction: {
    duration: '15 à 30 min',
    winCondition: 'Le meilleur score après les enchères remportées.',
    playerActions: ['enchérir une durée', 'se coucher', 'répondre si sélectionné'],
    hostControls: ['ouvrir les enchères', 'révéler', 'arbitrer', 'manche suivante'],
    tvContent: 'Enchère courante, chronomètre, gagnant et extrait.',
  },
  joker: {
    duration: '10 à 30 min',
    winCondition: 'Le meilleur score après usage des trois jokers.',
    playerActions: ['répondre', 'utiliser un joker', 'passer un palier'],
    hostControls: ['lancer', 'révéler', 'contrôler les jokers', 'manche suivante'],
    tvContent: 'Jokers joués, effets actifs, résultat et classement.',
  },
  missions: {
    duration: '15 à 35 min',
    winCondition: 'Score principal augmenté des missions révélées au podium.',
    playerActions: ['consulter sa mission privée', 'répondre', 'accomplir l’objectif discrètement'],
    hostControls: ['lancer', 'révéler les morceaux', 'terminer et révéler les missions'],
    tvContent: 'Partie publique puis missions et bonus au podium.',
  },
  solo_limited: {
    duration: '5 à 45 min',
    winCondition: 'Terminer le nombre choisi puis consulter son bilan.',
    playerActions: ['répondre', 'demander un extrait plus long', 'passer'],
    hostControls: ['choisir 5, 10, 20 ou 50 morceaux', 'lancer', 'arrêter'],
    tvContent: 'Non utilisé : tout se joue sur l’appareil hôte.',
  },
  solo_infinite: {
    duration: 'Libre',
    winCondition: 'Aucune fin imposée ; le joueur décide quand arrêter.',
    playerActions: ['répondre', 'demander un extrait plus long', 'passer'],
    hostControls: ['lancer', 'arrêter à tout moment'],
    tvContent: 'Non utilisé : tout se joue sur l’appareil hôte.',
  },
  solo_duel: {
    duration: '5 à 15 min',
    winCondition: 'Tirer la corde entièrement dans son camp.',
    playerActions: ['répondre à tour de rôle', 'faire avancer son camp'],
    hostControls: ['choisir bot ou ami', 'lancer', 'arrêter'],
    tvContent: 'Non utilisé : la corde reste sur l’écran partagé.',
  },
  solo_royale: {
    duration: '5 à 20 min',
    winCondition: 'Conserver au moins un cœur le plus longtemps possible.',
    playerActions: ['répondre', 'passer un palier', 'surveiller ses trois cœurs'],
    hostControls: ['lancer', 'arrêter'],
    tvContent: 'Non utilisé : les cœurs restent sur l’appareil hôte.',
  },
  training: {
    duration: '10 min à libre',
    winCondition: 'Réviser le lot choisi ; la progression compte plus que le score.',
    playerActions: ['répondre', 'passer un palier', 'revoir ses erreurs'],
    hostControls: ['choisir 10, 20, 50 ou sans fin', 'lancer', 'arrêter'],
    tvContent: 'Non utilisé : entraînement personnel sur l’appareil hôte.',
  },
  collections: {
    duration: 'Selon la collection',
    winCondition: 'Même règle que le format choisi au lancement.',
    playerActions: ['créer une collection', 'la jouer', 'la supprimer'],
    hostControls: ['filtrer les morceaux', 'enregistrer', 'lancer'],
    tvContent: 'Non utilisé en solo ; la collection peut alimenter une soirée.',
  },
  challenges: {
    duration: 'Selon le défi',
    winCondition: 'Rejouer exactement la configuration enregistrée et comparer le bilan.',
    playerActions: ['enregistrer un défi', 'le rejouer', 'le supprimer'],
    hostControls: ['régler la seed et les options', 'enregistrer', 'lancer'],
    tvContent: 'Non utilisé en solo ; le défi conserve la configuration locale.',
  },
};

function freezeDefinition(definition) {
  Object.freeze(definition.capabilities);
  Object.freeze(definition.surfaces);
  return Object.freeze(definition);
}

for (const guide of Object.values(MODE_GUIDES)) {
  Object.freeze(guide.playerActions);
  Object.freeze(guide.hostControls);
  Object.freeze(guide);
}
Object.freeze(MODE_GUIDES);

for (const definition of MODE_DEFINITIONS) freezeDefinition(definition);
for (const definition of LOCAL_MODE_DEFINITIONS) freezeDefinition(definition);
Object.freeze(MODE_DEFINITIONS);
Object.freeze(LOCAL_MODE_DEFINITIONS);

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

function clonePublicMode(mode, kind) {
  const remote = kind === 'party';
  return {
    ...mode,
    kind,
    capabilities: { ...mode.capabilities },
    surfaces: [...mode.surfaces],
    guide: {
      ...MODE_GUIDES[mode.id],
      playerActions: [...MODE_GUIDES[mode.id].playerActions],
      hostControls: [...MODE_GUIDES[mode.id].hostControls],
      compatibility: { local: true, remote },
    },
  };
}

function publicModes() {
  return MODE_DEFINITIONS.map(mode => clonePublicMode(mode, 'party'));
}

function publicCatalog() {
  return [
    ...publicModes(),
    ...LOCAL_MODE_DEFINITIONS.map(mode => clonePublicMode(mode, 'local')),
  ];
}

module.exports = {
  getMode,
  hasCapability,
  normalizeModeId,
  publicCatalog,
  publicModes,
};
