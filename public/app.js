// Variables globales d'état
let tracks = [];
let currentTrack = null;
let currentAttempt = 0;
let attempts = [];

// Durées des six essais, en secondes. Réglables (voir RÉGLAGES) : ce tableau
// est remplacé, jamais muté, pour que rien ne garde une référence périmée.
let durations = [0.2, 0.7, 2.5, 5, 9, 15];
const PALIERS_PRESETS = {
  facile:   [1, 3, 6, 10, 20, 30],
  normal:   [0.2, 0.7, 2.5, 5, 9, 15],
  hardcore: [0.1, 0.3, 0.8, 2, 4, 7],
};

let currentTrackOffset = 0;
let victoryAutoPlay = false;

// Contexte serveur : mode réseau local, et droit d'écrire ou non.
let contexte = { lan: false, local: true, readOnly: false, url: null };

// Les gestionnaires JavaScript écrits directement dans le HTML sont bloqués
// par notre politique de sécurité. On traite donc les pochettes cassées avec
// un écouteur central, compatible avec la CSP et avec les éléments dynamiques.
document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.matches('[data-cover-fallback]')) return;
  const parent = image.parentNode;
  if (parent) parent.textContent = '🎵';
}, true);

// --- Anti-triche : mémoire des manches entamées dans la session.
//
// Revenir en arrière (pavé num. 3) sur un morceau déjà commencé restituait une
// manche neuve : six essais tout frais sur une chanson déjà entendue. La manche
// est désormais mémorisée et rejouée telle qu'elle a été laissée.
//
// Au-delà de MAX_ESSAIS_REPRISE essais consommés, ou si elle est terminée
// (gagnée ou perdue), le morceau bascule en écoute seule : on peut l'écouter en
// entier, plus le deviner.
const manches = new Map();          // id du morceau -> { essais, essaiCourant, issue }
const MAX_ESSAIS_REPRISE = 2;

// Au-delà de ce nombre, une suppression groupée demande de recopier le total.
const SUPPRESSION_SANS_SAISIE = 5;

// Bibliothèque : n'afficher que les morceaux marqués « à renommer ».
let filtreARenommer = false;
let essaisDetail = [];              // [{ type, texte }] de la manche en cours
let issueManche = null;             // null | 'win' | 'lose'
let ecouteSeule = false;

// Session : une seed fixe l'ordre de passage des morceaux
let currentSeed = '';
let playlist = [];            // morceaux dans l'ordre de la seed, après filtre de genre
let playlistIndex = 0;
let allGenres = [];           // [{ name, count }]
let activeGenres = new Set(); // vide = aucun filtre, tous les genres jouent

// Décennies : même principe que les genres, mais sur l'année de sortie.
// `null` désigne le lot « sans année », qui est de loin le plus gros.
let allDecades = [];             // [{ key, label, count }]
let activeDecades = new Set();   // vide = aucun filtre

// Profils et réglages (chargés au démarrage, voir la section PROFILS)
let profils = [];
let profilActif = null;
let reglages = reglagesParDefaut();

// Lecteur Audio
let audio = new Audio();
let isPlaying = false;
let playTimeout = null;
let progressInterval = null;

// Lecture à l'envers : le morceau est décodé en mémoire et retourné. On garde
// le tampon du morceau en cours seulement — un AudioBuffer de quatre minutes
// pèse quelques dizaines de mégaoctets, on n'en collectionne pas.
let bufferMorceau = null;      // AudioBuffer du morceau en cours, à l'endroit
let bufferInverse = null;      // le même, retourné
let bufferPourId = null;       // identifiant du morceau décodé
let sourceTampon = null;       // AudioBufferSourceNode en cours de lecture
let preparation = null;        // promesse de décodage en cours
let refrainCherchePour = null; // morceau dont le refrain a déjà été cherché

// Lecteur d'aperçu de la bibliothèque : volontairement séparé du lecteur de jeu,
// qui est branché sur l'analyseur Web Audio et borné aux paliers de la manche.
const apercu = new Audio();
let apercuId = null;

// Web Audio API pour le Visualiseur
let audioContext = null;
let analyser = null;
let dataArray = null;
let sourceNode = null;
let animationFrameId = null;

// Éléments DOM
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const playBtn = document.getElementById('play-btn');
const timeCurrent = document.getElementById('time-current');
const timeMax = document.getElementById('time-max');
const progressIndicator = document.getElementById('progress-indicator');
const progressSegments = document.querySelectorAll('.progress-segment');
const guessInput = document.getElementById('guess-input');
const clearInputBtn = document.getElementById('clear-input-btn');
const autocompleteList = document.getElementById('autocomplete-list');
const skipBtn = document.getElementById('skip-btn');
const submitBtn = document.getElementById('submit-btn');
const guessInputContainer = document.getElementById('guess-input-container');
const resultCard = document.getElementById('result-card');
const nextGameBtn = document.getElementById('next-game-btn');
const waveformCanvas = document.getElementById('waveform-canvas');
const playerStatusText = document.getElementById('player-status-text');

// Éléments Bibliothèque
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const uploadProgressText = document.getElementById('upload-progress-text');
const refreshLibraryBtn = document.getElementById('refresh-library-btn');
const librarySearch = document.getElementById('library-search');
const tracksListContainer = document.getElementById('tracks-list-container');
const tracksCountSpan = document.getElementById('tracks-count');

// Éléments Session (seed & genres)
const seedValue = document.getElementById('seed-value');
const newSeedBtn = document.getElementById('new-seed-btn');
const copySeedBtn = document.getElementById('copy-seed-btn');
const editSeedBtn = document.getElementById('edit-seed-btn');
const playlistPosition = document.getElementById('playlist-position');
const playlistTotal = document.getElementById('playlist-total');
const toggleGenresBtn = document.getElementById('toggle-genres-btn');
const genrePanel = document.getElementById('genre-panel');
const genreChips = document.getElementById('genre-chips');
const genreSummary = document.getElementById('genre-summary');

// Éléments Téléchargement
const downloadQuery = document.getElementById('download-query');
const downloadGenre = document.getElementById('download-genre');
const downloadTitle = document.getElementById('download-title');
const downloadBtn = document.getElementById('download-btn');
const downloadLog = document.getElementById('download-log');
const toolsState = document.getElementById('tools-state');
const libraryGenreFilter = document.getElementById('library-genre-filter');

// Éléments Stats
const statsPlayed = document.getElementById('stats-played');
const statsWinrate = document.getElementById('stats-winrate');
const statsStreak = document.getElementById('stats-streak');
const statsMaxStreak = document.getElementById('stats-max-streak');
const distributionChart = document.getElementById('distribution-chart');
const resetStatsBtn = document.getElementById('reset-stats-btn');

/**
 * Dessine les icônes Lucide, sans jamais faire tomber le jeu avec elles.
 *
 * La bibliothèque est servie en local (`public/vendor/lucide.min.js`), mais si
 * le fichier venait à manquer — dossier incomplet, copie ratée — `lucide` serait
 * indéfini. Ces appels sont dispersés dans l'initialisation : sans garde-fou, le
 * premier plante et tout ce qui suit ne s'exécute jamais. Des icônes absentes
 * sont un défaut d'affichage ; un jeu qui ne démarre pas est une panne.
 */
function dessinerIcones() {
  if (typeof lucide === 'undefined' || !lucide.createIcons) {
    console.warn('Icônes Lucide indisponibles : vérifier public/vendor/lucide.min.js');
    return;
  }
  lucide.createIcons();
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  // Icônes Lucide
  dessinerIcones();

  // Qui joue, et avec quels réglages : tout le reste en dépend (clés de
  // stockage des statistiques, durées des paliers, mode de réponse).
  chargerProfils();
  chargerReglages();
  majBoutonProfil();
  initProfilEvents();
  initOptionsEvents();
  majSegmentsPaliers();
  majBoutonsOptions();
  majPlaceholderReponse();

  // Navigation par onglets
  initNavigation();

  // Seed de session : une nouvelle à chaque lancement, sauf si l'URL en impose une
  initSeed();

  // Configuration des écouteurs de jeu
  initGameEvents();

  // Filtre par genre, téléchargement, édition des fiches
  initSessionEvents();
  initDownloadEvents();
  initPlaylistEvents();
  initHealthEvents();
  initEditModalEvents();
  initSeekEvents();

  // Machine hôte ou téléphone du réseau : ça change ce qu'on a le droit de faire
  initContexte();

  // Initialisation de la bibliothèque musicale
  loadLibrary();

  // Configuration des écouteurs de la bibliothèque & upload
  initLibraryEvents();

  // Statistiques : on ancre la session dès l'ouverture pour dater son début
  if (!lireStats('session')) {
    writeStats('session', emptyStats());
  }
  initStatsEvents();
  updateStatsDisplay();
  
  // Visualiseur Canvas au repos
  initCanvas();
  drawIdleWaveform();
  
  // Redimensionnement du canvas
  window.addEventListener('resize', initCanvas);

  // Le serveur devient la source commune des profils : un profil créé sur le
  // téléphone réapparaît sur l'ordinateur avec les mêmes statistiques.
  if (window.songlessShared) window.songlessShared.initialize();
});

// ==========================================
// NAVIGATION & ONGLETS
// ==========================================
function initNavigation() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      if (targetTab !== 'game-tab' && window.songlessExpansions
          && window.songlessExpansions.shouldStayInGame
          && window.songlessExpansions.shouldStayInGame()) {
        showToast('Termine ou révèle la manche avant de quitter l’écran multijoueur.', 'warn');
        return;
      }
      
      // Activer le bouton de l'onglet
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Afficher le contenu correspondant
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.getAttribute('id') === targetTab) {
          content.classList.add('active');
        }
      });
      
      // Pause de l'audio si on quitte l'onglet jeu
      if (targetTab !== 'game-tab') {
        pauseAudio();
      }

      // Idem pour l'aperçu : il ne suit pas le joueur hors de la bibliothèque
      if (targetTab !== 'library-tab') {
        arreterApercu();
      }
    });
  });
}

// ==========================================
// VISUALISEUR AUDIO (WEB AUDIO API & CANVAS)
// ==========================================
function initCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = waveformCanvas.getBoundingClientRect();
  waveformCanvas.width = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  
  const ctx = waveformCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
}

let fxNodes = {
  shaper: null,
  filter: null,
  gain: null,
};

function fxSpeedMultiplier() {
  return String(reglages.fx || 'none') === 'nightcore' ? 1.25 : 1;
}

function make8bitCurve(steps = 14) {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

function connectAudioChain() {
  if (!audioContext || !sourceNode || !analyser) return;
  try {
    sourceNode.disconnect();
    if (fxNodes.shaper) fxNodes.shaper.disconnect();
    if (fxNodes.filter) fxNodes.filter.disconnect();
    if (fxNodes.gain) fxNodes.gain.disconnect();
  } catch (_) {}

  const isGameFinished = !resultCard.classList.contains('hidden');
  const fx = isGameFinished ? 'none' : (reglages.fx || 'none');

  let currentOut = sourceNode;

  if (fx === '8bit') {
    const shaper = audioContext.createWaveShaper();
    shaper.curve = make8bitCurve(12);
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3400;
    sourceNode.connect(shaper);
    shaper.connect(filter);
    fxNodes.shaper = shaper;
    fxNodes.filter = filter;
    currentOut = filter;
  } else if (fx === 'radio') {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 3.0;
    sourceNode.connect(filter);
    fxNodes.filter = filter;
    currentOut = filter;
  } else if (fx === 'nightcore') {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'highshelf';
    filter.frequency.value = 2500;
    filter.gain.value = 4;
    sourceNode.connect(filter);
    fxNodes.filter = filter;
    currentOut = filter;
  } else if (fx === 'underwater') {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 450;
    filter.Q.value = 3.5;
    sourceNode.connect(filter);
    fxNodes.filter = filter;
    currentOut = filter;
  } else if (fx === 'bass') {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowshelf';
    filter.frequency.value = 140;
    filter.gain.value = 14;
    sourceNode.connect(filter);
    fxNodes.filter = filter;
    currentOut = filter;
  } else if (fx === 'slowed') {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    sourceNode.connect(filter);
    fxNodes.filter = filter;
    currentOut = filter;
  }

  currentOut.connect(analyser);
  analyser.connect(audioContext.destination);
}

function initWebAudio() {
  if (audioContext) return;
  
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    // Connecter le tag audio au context et à l'analyseur
    // Note: crossorigin est nécessaire pour éviter les erreurs CORS en local
    audio.crossOrigin = "anonymous";
    sourceNode = audioContext.createMediaElementSource(audio);
    connectAudioChain();
    
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
  } catch (e) {
    console.error("Impossible d'initialiser la Web Audio API:", e);
  }
}

function drawIdleWaveform() {
  if (isPlaying) return; // Ne pas dessiner au repos si la musique tourne
  
  const ctx = waveformCanvas.getContext('2d');
  const width = waveformCanvas.width / (window.devicePixelRatio || 1);
  const height = waveformCanvas.height / (window.devicePixelRatio || 1);
  
  ctx.clearRect(0, 0, width, height);
  
  // Dessine une jolie onde sinusoïdale calme au repos
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)'; // Violet translucide
  
  const points = 80;
  const amplitude = 8;
  const frequency = 0.04;
  const time = Date.now() * 0.0006;
  
  for (let i = 0; i < points; i++) {
    const x = (width / points) * i;
    const y = height / 2 + Math.sin(i * frequency + time) * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  
  ctx.stroke();
  
  // Boucler l'animation au repos
  if (!isPlaying) {
    animationFrameId = requestAnimationFrame(drawIdleWaveform);
  }
}

function drawActiveWaveform() {
  if (!isPlaying || !analyser) return;
  
  const ctx = waveformCanvas.getContext('2d');
  const width = waveformCanvas.width / (window.devicePixelRatio || 1);
  const height = waveformCanvas.height / (window.devicePixelRatio || 1);
  
  analyser.getByteFrequencyData(dataArray);
  
  ctx.clearRect(0, 0, width, height);
  
  // Dessin des barres audio en miroir
  const barWidth = (width / dataArray.length) * 1.6;
  let barHeight;
  let x = 0;
  
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#6366f1'); // Indigo
  gradient.addColorStop(0.5, '#a855f7'); // Violet
  gradient.addColorStop(1, '#ec4899'); // Rose
  ctx.fillStyle = gradient;
  
  for (let i = 0; i < dataArray.length; i++) {
    // Normalise la valeur (0 à 255)
    barHeight = (dataArray[i] / 255) * (height * 0.7);
    
    // Dessiner en haut et en bas par rapport au centre (effet miroir)
    ctx.fillRect(x, (height / 2) - (barHeight / 2), barWidth - 2, barHeight);
    
    x += barWidth;
  }
  
  animationFrameId = requestAnimationFrame(drawActiveWaveform);
}

// ==========================================
// GESTION DU LECTEUR AUDIO
// ==========================================
function setupAudioForTrack(track) {
  pauseAudio();
  audio.src = `/api/tracks/${track.id}/audio`;
  audio.load();
  
  // Réinitialiser la barre de progression
  updatePlayerUI(0);
}

function playAudio(syncPlayback = null) {
  if (!currentTrack) return;

  // Une seule source à la fois : l'aperçu de la bibliothèque se tait.
  arreterApercu();

  initWebAudio();
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const isGameFinished = !resultCard.classList.contains('hidden');

  // Manche en cours et lecture à l'envers : le fichier audio du navigateur ne
  // sait pas faire, on passe par le tampon décodé. Une fois le morceau dévoilé,
  // on réécoute normalement — c'est le moment de le reconnaître, pas de jouer.
  if (!isGameFinished && reglages.sens === 'inverse') {
    jouerAlEnvers(syncPlayback);
    return;
  }

  // Départ au refrain : le morceau doit être décodé pour savoir où il est.
  // Une seule tentative par morceau — si le décodage échoue, on joue quand même,
  // depuis le point tiré par la seed, plutôt que de tourner en rond.
  if (!isGameFinished && reglages.depart === 'refrain' && refrainCherchePour !== currentTrack.id) {
    const track = currentTrack;
    refrainCherchePour = track.id;
    playerStatusText.classList.remove('hidden');
    playerStatusText.innerText = 'Repérage du refrain…';
    preparerExtrait(track).then(() => {
      if (currentTrack === track && !isPlaying) playAudio(syncPlayback);
    });
    return;
  }

  isPlaying = true;
  playerStatusText.classList.add('hidden');

  // Changer l'icône de play en pause
  playBtn.querySelector('.icon-play').classList.add('hidden');
  playBtn.querySelector('.icon-pause').classList.remove('hidden');

  // La vitesse ne s'applique qu'à la devinette : le morceau dévoilé se réécoute
  // tel qu'il est. `preservesPitch = false` laisse la hauteur du son suivre la
  // vitesse — c'est justement ce qui rend l'exercice retors.
  const speedSource = Number(reglages.vitesse) || 1;
  const vitesse = isGameFinished ? 1 : speedSource * fxSpeedMultiplier();
  audio.playbackRate = vitesse;
  audio.preservesPitch = false;
  audio.mozPreservesPitch = false;
  audio.webkitPreservesPitch = false;

  if (!isGameFinished) {
    // Une manche normale repart du début. En multijoueur synchronisé, on se
    // replace dans l'unique écoute en retirant les éventuelles pauses buzzer.
    const elapsed = syncPlayback ? Math.max(0, Number(syncPlayback.elapsed) || 0) : 0;
    const offset = syncPlayback ? Number(syncPlayback.offset) || 0 : currentTrackOffset;
    audio.currentTime = offset + elapsed;
  } else if (victoryAutoPlay) {
    // Première lecture après révélation : on démarre au point de l'extrait
    audio.currentTime = currentTrackOffset;
    victoryAutoPlay = false;
  }
  // Sinon (partie finie, relance manuelle) : on reprend là où est le curseur,
  // pour ne pas annuler un déplacement fait par le joueur.

  audio.play()
    .then(() => {
      // Annuler les intervalles/timeouts existants
      clearTimeout(playTimeout);
      clearInterval(progressInterval);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      // Démarrer le visualiseur dynamique
      drawActiveWaveform();

      if (isGameFinished) {
        // Morceau dévoilé : aucune limite, on écoute jusqu'au bout.
        timeMax.innerText = formatDuree(audio.duration);
        progressInterval = setInterval(updateRevealPlayer, 100);
        updateRevealPlayer();
        return;
      }

      // En jeu : la lecture est bornée au palier de l'essai en cours.
      // Le palier compte des secondes de musique, pas des secondes d'horloge :
      // à ×1,5 on entend la même chose, en un tiers de temps de moins.
      const maxPlayDuration = syncPlayback
        ? Math.max(0, Number(syncPlayback.duration) || 0)
        : durations[currentAttempt];
      const initialElapsed = syncPlayback
        ? Math.min(maxPlayDuration, Math.max(0, Number(syncPlayback.elapsed) || 0)) : 0;
      const remainingDuration = Math.max(0, maxPlayDuration - initialElapsed);
      if (remainingDuration <= 0) {
        pauseAudio();
        updatePlayerUI(maxPlayDuration, maxPlayDuration);
        return;
      }
      timeMax.innerText = `${maxPlayDuration.toFixed(1)}s`;

      const startTime = Date.now();
      progressInterval = setInterval(() => {
        const elapsed = initialElapsed + ((Date.now() - startTime) / 1000) * vitesse;
        updatePlayerUI(elapsed, maxPlayDuration);
      }, 30);

      playTimeout = setTimeout(() => {
        pauseAudio();
        updatePlayerUI(0, maxPlayDuration);
      }, (remainingDuration / vitesse) * 1000);
    })
    .catch(err => {
      // Déplacer le curseur pendant la lecture interrompt la promesse play() :
      // ce n'est pas une panne, le navigateur reprend tout seul. On ne coupe
      // donc pas le son et on n'affiche pas d'erreur.
      if (err && err.name === 'AbortError') return;

      console.error("Erreur de lecture audio:", err);
      pauseAudio();
      gererMorceauIntrouvable(currentTrack);
    });
}

/**
 * Un morceau que le serveur ne trouve plus.
 *
 * Cela arrive quand la bibliothèque a changé depuis le chargement de la page :
 * un doublon écarté, un fichier supprimé ou renommé. L'onglet garde alors en
 * mémoire une liste périmée et bute sur un fichier disparu. Plutôt qu'une
 * erreur sèche, on recharge la liste et on passe au morceau suivant.
 */
function gererMorceauIntrouvable(track) {
  if (!track) {
    showToast("Impossible de lire l'extrait.", 'error');
    return;
  }

  fetch(`/api/tracks/${track.id}/audio`, { method: 'HEAD' })
    .then(res => {
      if (res.ok) {
        showToast("Impossible de lire l'extrait. Vérifiez le format de la musique.", 'error');
        return;
      }
      showToast('Bibliothèque modifiée depuis l\'ouverture : liste actualisée.', 'warn');
      loadLibrary(() => startNewGame(true));
    })
    .catch(() => {
      showToast("Impossible de lire l'extrait.", 'error');
    });
}

// ==========================================
// EXTRAIT PIMENTÉ : ENVERS ET REFRAIN
// ==========================================
//
// Deux options demandent d'avoir le morceau en mémoire, décodé :
//   — le jouer à l'envers, ce qu'une balise <audio> ne sait pas faire ;
//   — repérer son passage le plus fort, pour démarrer sur le refrain plutôt
//     que sur une intro ou un silence.
//
// Le décodage coûte quelques centaines de millisecondes et beaucoup de
// mémoire : on ne garde que le morceau en cours, et on ne décode que si l'une
// des deux options est active.

/** Les réglages actuels demandent-ils de décoder le morceau ? */
function besoinDeDecoder() {
  return reglages.sens === 'inverse' || reglages.depart === 'refrain';
}

function arreterSourceTampon() {
  if (!sourceTampon) return;
  try {
    sourceTampon.onended = null;
    sourceTampon.stop();
  } catch (_) { /* déjà arrêtée */ }
  sourceTampon = null;
}

function oublierBuffers() {
  arreterSourceTampon();
  bufferMorceau = null;
  bufferInverse = null;
  bufferPourId = null;
  preparation = null;
  refrainCherchePour = null;
}

/**
 * Décode le morceau et en tire ce dont les options ont besoin.
 * Renvoie une promesse résolue quand c'est prêt (ou null si impossible).
 */
function preparerExtrait(track, force = false) {
  if (!track || (!force && !besoinDeDecoder())) return Promise.resolve(null);
  if (bufferPourId === track.id && preparation) return preparation;

  initWebAudio();
  if (!audioContext) return Promise.resolve(null);

  bufferPourId = track.id;
  preparation = fetch(`/api/tracks/${track.id}/audio`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then(brut => audioContext.decodeAudioData(brut))
    .then(buffer => {
      // Le joueur a pu changer de morceau pendant le décodage : ce qui arrive
      // en retard ne doit pas écraser l'extrait du morceau affiché.
      if (bufferPourId !== track.id) return null;

      bufferMorceau = buffer;

      if (reglages.depart === 'refrain') {
        currentTrackOffset = trouverPassageFort(buffer);
      }
      if (reglages.sens === 'inverse') {
        bufferInverse = retourner(buffer);
      }
      return buffer;
    })
    .catch(err => {
      console.warn('Décodage impossible :', err.message);
      if (bufferPourId === track.id) {
        bufferPourId = null;
        showToast('Extrait impossible à préparer : lecture normale pour ce morceau.', 'warn');
      }
      return null;
    });

  return preparation;
}

/** Copie un tampon audio à l'envers, échantillon par échantillon. */
function retourner(buffer) {
  const inverse = audioContext.createBuffer(
    buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const source = buffer.getChannelData(c);
    const cible = inverse.getChannelData(c);
    for (let i = 0, j = source.length - 1; i < source.length; i++, j--) {
      cible[i] = source[j];
    }
  }
  return inverse;
}

/**
 * Cherche le passage le plus énergique du morceau — en pratique, le refrain.
 *
 * On découpe en fenêtres d'une seconde, on mesure l'énergie de chacune (un
 * échantillon sur seize suffit largement), puis on prend la tranche la plus
 * forte de la longueur du plus long palier. Le tout début et la toute fin sont
 * écartés : une intro qui monte ou un final qui explose ne sont pas le refrain.
 */
function trouverPassageFort(buffer, largeurVoulue = null) {
  const sr = buffer.sampleRate;
  const duree = buffer.duration;

  const largeur = largeurVoulue === null
    ? Math.min(Math.max(durations[durations.length - 1], 5), 25)
    : Math.min(Math.max(Number(largeurVoulue) || 5, 3), 20);
  if (duree <= largeur + 10) return 0;

  const parFenetre = Math.floor(sr);              // une seconde
  const nb = Math.floor(buffer.length / parFenetre);
  const brute = new Float32Array(nb);

  for (let i = 0; i < nb; i++) {
    let somme = 0;
    let mesures = 0;
    const debut = i * parFenetre;
    // Les deux canaux comptent : un refrain panoramisé ne doit plus être raté
    // parce que sa partie la plus forte est surtout à droite.
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const canal = buffer.getChannelData(c);
      for (let j = 0; j < parFenetre && debut + j < canal.length; j += 24) {
        const v = canal[debut + j];
        somme += v * v;
        mesures++;
      }
    }
    brute[i] = mesures ? Math.sqrt(somme / mesures) : 0;
  }

  // Une pointe isolée est souvent un drop ou un bruit. Le lissage privilégie
  // les passages forts qui tiennent plusieurs secondes, typiquement le refrain.
  const energie = new Float32Array(nb);
  for (let i = 0; i < nb; i++) {
    energie[i] = (brute[Math.max(0, i - 1)] + brute[i] * 2
      + brute[Math.min(nb - 1, i + 1)]) / 4;
  }

  const fenetre = Math.round(largeur);
  const premier = Math.floor(nb * 0.08);
  const dernier = Math.floor(nb * 0.9) - fenetre;
  if (dernier <= premier) return 0;

  let meilleurScore = -Infinity;
  let meilleurDebut = premier;
  for (let i = premier; i <= dernier; i++) {
    let somme = 0;
    let carres = 0;
    let minimum = Infinity;
    for (let j = i; j < i + fenetre; j++) {
      somme += energie[j];
      carres += energie[j] * energie[j];
      minimum = Math.min(minimum, energie[j]);
    }
    const moyenne = somme / fenetre;
    const ecart = Math.sqrt(Math.max(0, carres / fenetre - moyenne * moyenne));
    const centre = (i + fenetre / 2) / nb;
    const bonusPosition = 1 - Math.min(0.08, Math.abs(centre - 0.48) * 0.12);
    const score = (moyenne - ecart * 0.2 + minimum * 0.08) * bonusPosition;
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleurDebut = i;
    }
  }
  return meilleurDebut;
}

/** Prépare en arrière-plan le passage le plus reconnaissable du morceau. */
async function preparerPassageConnu(track) {
  const buffer = await preparerExtrait(track, true);
  if (!buffer || currentTrack !== track) return currentTrackOffset;
  const debutFort = trouverPassageFort(buffer, 6);
  return Math.max(0, Math.min(buffer.duration - 5, debutFort + 0.5));
}

/**
 * Joue l'extrait à l'envers.
 *
 * On part du point de l'extrait et on remonte le morceau : les paliers
 * successifs découvrent donc ce qui précède, à rebours.
 */
async function jouerAlEnvers(syncPlayback = null) {
  const track = currentTrack;

  isPlaying = true;
  playerStatusText.classList.remove('hidden');
  playerStatusText.innerText = 'Préparation de l\'extrait à l\'envers…';
  playBtn.querySelector('.icon-play').classList.add('hidden');
  playBtn.querySelector('.icon-pause').classList.remove('hidden');

  await preparerExtrait(track);

  // Entre-temps : morceau changé, ou joueur qui a remis pause.
  if (!isPlaying || currentTrack !== track) return;
  if (!bufferInverse || !audioContext) {
    // Le décodage a échoué : on ne laisse pas le joueur devant un bouton mort.
    pauseAudio();
    return;
  }

  playerStatusText.classList.add('hidden');
  arreterSourceTampon();
  clearTimeout(playTimeout);
  clearInterval(progressInterval);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  const palier = syncPlayback
    ? Math.max(0, Number(syncPlayback.duration) || 0)
    : durations[currentAttempt];
  const initialElapsed = syncPlayback
    ? Math.min(palier, Math.max(0, Number(syncPlayback.elapsed) || 0)) : 0;
  const vitesse = (Number(reglages.vitesse) || 1) * fxSpeedMultiplier();
  const duree = bufferInverse.duration;

  // Position du point d'extrait dans le tampon retourné.
  const offset = syncPlayback ? Number(syncPlayback.offset) || 0 : currentTrackOffset;
  const depart = Math.max(0, Math.min(duree - 0.05, duree - offset + initialElapsed));
  const longueur = Math.min(Math.max(0, palier - initialElapsed), duree - depart);
  if (longueur <= 0) {
    pauseAudio();
    updatePlayerUI(palier, palier);
    return;
  }

  sourceTampon = audioContext.createBufferSource();
  sourceTampon.buffer = bufferInverse;
  sourceTampon.playbackRate.value = vitesse;
  sourceTampon.connect(analyser);

  timeMax.innerText = `${palier.toFixed(1)}s`;
  const debutHorloge = Date.now();
  progressInterval = setInterval(() => {
    const elapsed = initialElapsed + ((Date.now() - debutHorloge) / 1000) * vitesse;
    updatePlayerUI(elapsed, palier);
  }, 30);

  sourceTampon.onended = () => {
    sourceTampon = null;
    pauseAudio();
    updatePlayerUI(0, palier);
  };

  sourceTampon.start(0, depart, longueur);
  drawActiveWaveform();
}

function pauseAudio() {
  isPlaying = false;
  audio.pause();
  arreterSourceTampon();

  clearTimeout(playTimeout);
  clearInterval(progressInterval);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  
  // Rétablir le bouton
  playBtn.querySelector('.icon-play').classList.remove('hidden');
  playBtn.querySelector('.icon-pause').classList.add('hidden');
  
  playerStatusText.classList.remove('hidden');
  playerStatusText.innerText = "Cliquez sur Play pour écouter l'extrait";
  
  // Redessiner le visualiseur calme
  drawIdleWaveform();
}

/** Joue uniquement le court passage connu affiché sur l'écran de résultat. */
function jouerPassageResultat(syncPlayback) {
  if (!currentTrack || !syncPlayback) return;
  const duration = Math.max(0, Number(syncPlayback.duration) || 0);
  const elapsed = Math.min(duration, Math.max(0, Number(syncPlayback.elapsed) || 0));
  const remaining = Math.max(0, duration - elapsed);
  if (!remaining) return;

  pauseAudio();
  arreterApercu();
  audio.playbackRate = 1;
  audio.preservesPitch = false;
  audio.currentTime = Math.max(0, Number(syncPlayback.offset) || 0) + elapsed;
  audio.play().then(() => {
    isPlaying = true;
    playerStatusText.classList.add('hidden');
    playBtn.querySelector('.icon-play').classList.add('hidden');
    playBtn.querySelector('.icon-pause').classList.remove('hidden');
    clearTimeout(playTimeout);
    clearInterval(progressInterval);
    drawActiveWaveform();
    progressInterval = setInterval(updateRevealPlayer, 100);
    updateRevealPlayer();
    playTimeout = setTimeout(() => pauseAudio(), remaining * 1000);
  }).catch(error => {
    if (!error || error.name !== 'AbortError') {
      console.warn('Passage de résultat impossible à lire :', error && error.message);
    }
  });
}

// ==========================================
// LECTEUR DU MORCEAU DÉVOILÉ (fin de manche)
// ==========================================
const seekBar = document.getElementById('seek-bar');
const seekCurrent = document.getElementById('seek-current');
const seekTotal = document.getElementById('seek-total');
const heardleBar = document.getElementById('heardle-bar');
const revealPlayer = document.getElementById('reveal-player');

/**
 * Bascule la barre du haut entre ses deux rôles : jauge des paliers pendant la
 * manche, curseur de navigation une fois le morceau dévoilé.
 */
function modeRevelation(actif) {
  if (heardleBar) heardleBar.classList.toggle('reveal', actif);
  if (revealPlayer) revealPlayer.classList.toggle('hidden', !actif);
  if (!actif) {
    const zone = document.getElementById('extract-zone');
    if (zone) zone.classList.add('hidden');
    if (seekBar) seekBar.value = 0;
  }
}

let seekEnCours = false;   // vrai pendant que le joueur déplace le curseur

/**
 * Matérialise sur le curseur la portion du morceau qui a servi d'extrait,
 * pour que le joueur voie d'où venait ce qu'il a entendu.
 * @param {number} debut    seconde de départ de l'extrait
 * @param {number} duree    longueur entendue, en secondes
 * @param {number} totale   durée du morceau
 */
function afficherZoneExtrait(debut, duree, totale) {
  const zone = document.getElementById('extract-zone');
  const legende = document.getElementById('extract-legend');
  if (!zone || !isFinite(totale) || totale <= 0) return;

  const fin = Math.min(debut + duree, totale);
  zone.style.left = `${(debut / totale) * 100}%`;
  zone.style.width = `${Math.max(((fin - debut) / totale) * 100, 0.6)}%`;
  zone.classList.remove('hidden');

  if (legende) {
    legende.innerText = `Extrait joué : ${formatDuree(debut)} → ${formatDuree(fin)}`;
  }
}

function formatDuree(secondes) {
  if (!isFinite(secondes) || secondes < 0) return '0:00';
  const m = Math.floor(secondes / 60);
  const s = Math.floor(secondes % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Reflète la position de lecture dans le curseur et les compteurs. */
function updateRevealPlayer() {
  const duree = audio.duration;
  if (!isFinite(duree) || duree <= 0) return;

  if (seekTotal) seekTotal.innerText = formatDuree(duree);
  if (seekCurrent) seekCurrent.innerText = formatDuree(audio.currentTime);
  timeCurrent.innerText = formatDuree(audio.currentTime);

  // Pendant un glissement, on laisse la main au joueur.
  if (!seekEnCours && seekBar) {
    seekBar.value = Math.round((audio.currentTime / duree) * 1000);
  }
  progressIndicator.style.width = `${(audio.currentTime / duree) * 100}%`;
}

function initSeekEvents() {
  if (!seekBar) return;

  const deplacer = () => {
    const duree = audio.duration;
    if (!isFinite(duree) || duree <= 0) return;
    const cible = (seekBar.value / 1000) * duree;
    if (seekCurrent) seekCurrent.innerText = formatDuree(cible);
    return cible;
  };

  seekBar.addEventListener('pointerdown', () => { seekEnCours = true; });
  seekBar.addEventListener('input', deplacer);

  const relacher = () => {
    if (!seekEnCours) return;
    const cible = deplacer();
    seekEnCours = false;
    if (cible !== undefined) audio.currentTime = cible;
  };
  seekBar.addEventListener('change', relacher);
  seekBar.addEventListener('pointerup', relacher);

  // Le morceau va jusqu'au bout : on remet simplement le bouton sur « play ».
  audio.addEventListener('ended', () => {
    if (!resultCard.classList.contains('hidden')) pauseAudio();
  });

  // La durée n'est connue qu'une fois les métadonnées chargées.
  audio.addEventListener('loadedmetadata', () => {
    if (!resultCard.classList.contains('hidden')) updateRevealPlayer();
  });
}

function updatePlayerUI(elapsed, maxDuration = null) {
  if (!maxDuration) {
    maxDuration = resultCard.classList.contains('hidden') ? durations[currentAttempt] : (audio.duration || 30);
  }
  
  // Limiter elapsed pour ne pas dépasser maxDuration
  elapsed = Math.min(elapsed, maxDuration);
  
  timeCurrent.innerText = `${elapsed.toFixed(1)}s`;
  timeMax.innerText = `${maxDuration.toFixed(1)}s`;
  
  // Pourcentage de progression global sur 16 secondes (durée max du jeu)
  // En fin de jeu (chanson dévoilée), on base le pourcentage sur la durée totale du fichier
  const isGameFinished = !resultCard.classList.contains('hidden');
  const percent = isGameFinished 
    ? (elapsed / (audio.duration || 30)) * 100 
    : (elapsed / 15) * 100;
  
  progressIndicator.style.width = `${percent}%`;
}

// ==========================================
// LOGIQUE DE JEU (SONGLESS)
// ==========================================
/**
 * L'espace doit-il s'insérer dans le texte plutôt que lancer la musique ?
 *
 * Le champ de réponse reçoit le focus à chaque nouvelle chanson : sans ça,
 * la barre d'espace serait confisquée en permanence. On la laisse donc au
 * texte dès qu'il y a quelque chose d'écrit — tant que le champ est vide,
 * l'espace pilote la lecture.
 */
function isTypingSpace(target) {
  const el = target || document.activeElement;
  if (!el) return false;

  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;

  // Le champ de réponse vide ne sert à rien : on prend l'espace pour la lecture.
  if (el === guessInput) return guessInput.value.length > 0;
  return true;
}

/**
 * Bascule lecture/pause. Relancer après une pause repart du début de
 * l'extrait : c'est playAudio() qui repositionne sur currentTrackOffset.
 */
function togglePlayback() {
  if (!currentTrack) return;
  if (window.songlessExpansions && window.songlessExpansions.blocksManualPlayback
      && window.songlessExpansions.blocksManualPlayback()) {
    showToast('Une seule écoute par manche multijoueur.', 'warn');
    return;
  }
  if (isPlaying) pauseAudio();
  else playAudio();
}

function initGameEvents() {
  // Clic Play/Pause
  playBtn.addEventListener('click', togglePlayback);

  // Raccourcis clavier :
  //   Espace       lancer / pause / relancer l'extrait
  //   Pavé num. 1  passer (essai suivant, palier de temps débloqué)
  //   Pavé num. 2  chanson suivante (abandonne celle-ci)
  //   Pavé num. 3  chanson précédente
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!['Space', 'Numpad1', 'Numpad2', 'Numpad3'].includes(e.code)) return;

    // Pas pendant la saisie d'une fiche, ni hors de l'onglet Jouer
    const modal = document.getElementById('edit-modal');
    if (modal && !modal.classList.contains('hidden')) return;
    const gameTab = document.getElementById('game-tab');
    if (!gameTab || !gameTab.classList.contains('active')) return;

    if (e.code === 'Space') {
      if (isTypingSpace(e.target)) return;
      e.preventDefault();
      togglePlayback();
      return;
    }

    // Chanson suivante / précédente dans l'ordre de la seed. Marche aussi bien
    // en pleine manche que sur l'écran de fin. Une manche déjà entamée est
    // restituée dans l'état où elle a été laissée (voir `manches`).
    if (e.code === 'Numpad2' || e.code === 'Numpad3') {
      e.preventDefault();
      if (playlist.length === 0) return;
      if (window.songlessExpansions && !window.songlessExpansions.beforeAdvance()) return;
      startNewGame(e.code === 'Numpad2' ? 1 : -1);
      return;
    }

    // Passer : seulement si une manche est en cours. Une fois finie, le bouton
    // « Passer » n'existe plus et l'essai serait comptabilisé à tort.
    if (ecouteSeule) {
      e.preventDefault();
      showToast("Écoute seule : cette chanson n'est plus jouable.", 'warn');
      return;
    }
    if (!currentTrack || guessInputContainer.classList.contains('hidden')) return;
    e.preventDefault();
    handleSkip();
  });

  // Autocomplétion
  guessInput.addEventListener('input', handleAutocomplete);
  guessInput.addEventListener('focus', () => {
    if (guessInput.value.trim().length > 0) {
      autocompleteList.classList.remove('hidden');
    }
  });
  
  // Clic en dehors pour fermer l'autocomplétion
  document.addEventListener('click', (e) => {
    if (!guessInput.contains(e.target) && !autocompleteList.contains(e.target)) {
      autocompleteList.classList.add('hidden');
    }
  });

  // Nettoyage de l'input
  clearInputBtn.addEventListener('click', () => {
    guessInput.value = '';
    clearInputBtn.classList.add('hidden');
    autocompleteList.classList.add('hidden');
    guessInput.focus();
  });

  // Clic sur "Passer" (Skip)
  skipBtn.addEventListener('click', handleSkip);

  // Clic sur "Soumettre"
  submitBtn.addEventListener('click', handleSubmitGuess);
  guessInput.addEventListener('keydown', (e) => {
    const items = autocompleteList.querySelectorAll('.autocomplete-item');
    if (items.length === 0 || autocompleteList.classList.contains('hidden')) {
      if (e.key === 'Enter') {
        handleSubmitGuess();
      }
      return;
    }
    
    let activeIndex = Array.from(items).findIndex(item => item.classList.contains('active'));
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIndex !== -1) {
        items[activeIndex].classList.remove('active');
      }
      activeIndex = (activeIndex + 1) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex !== -1) {
        items[activeIndex].classList.remove('active');
      }
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex !== -1) {
        validerSuggestion(items[activeIndex]);
      } else {
        handleSubmitGuess();
      }
    } else if (e.key === 'Escape') {
      autocompleteList.classList.add('hidden');
    }
  });

  // Bouton Rejouer / Nouvelle Chanson : on avance dans l'ordre de la seed
  nextGameBtn.addEventListener('click', () => {
    if (window.songlessExpansions && !window.songlessExpansions.beforeAdvance()) return;
    startNewGame(true);
  });
}

/**
 * Démarre une manche.
 * @param {number|boolean} step  +1 morceau suivant, -1 précédent, 0 on reste
 *                               (true accepté pour compatibilité = +1)
 */
function startNewGame(step = 0) {
  if (tracks.length === 0) {
    showToast("Ajoutez des musiques dans la bibliothèque pour commencer à jouer !", 'warn');
    return;
  }
  if (playlist.length === 0) {
    showToast("Aucun morceau dans les genres sélectionnés.", 'warn');
    return;
  }

  // On se déplace dans l'ordre fixé par la seed, en bouclant aux deux bouts.
  const delta = step === true ? 1 : (typeof step === 'number' ? step : 0);
  if (delta) {
    playlistIndex = (playlistIndex + delta + playlist.length) % playlist.length;
  }
  saveSessionPosition();

  // Reset de l'état
  currentAttempt = 0;
  attempts = [];
  essaisDetail = [];
  issueManche = null;
  ecouteSeule = false;
  isPlaying = false;
  victoryAutoPlay = false;
  pauseAudio();
  arreterApercu();

  // Cacher le panneau de résultat et afficher la zone de saisie
  resultCard.classList.add('hidden');
  const partyResultIcon = document.getElementById('party-result-icon');
  if (partyResultIcon) partyResultIcon.classList.add('hidden');
  modeRevelation(false);
  guessInputContainer.classList.remove('hidden');
  guessInput.value = '';
  clearInputBtn.classList.add('hidden');
  autocompleteList.classList.add('hidden');

  // Sélectionner la chanson : on suit l'ordre tiré par la seed
  currentTrack = playlist[playlistIndex];
  if (window.songlessExpansions) window.songlessExpansions.onRoundStart(currentTrack);

  // Point de départ dans le morceau. Par défaut il est dérivé de la seed, pour
  // qu'une même partie rejoue exactement le même passage ; « refrain » le
  // remplacera dès que le morceau sera décodé.
  currentTrackOffset = reglages.depart === 'debut'
    ? 0
    : offsetForTrack(currentTrack, currentSeed);

  // Configurer l'audio
  oublierBuffers();
  setupAudioForTrack(currentTrack);
  preparerExtrait(currentTrack);

  // Mettre à jour l'interface des lignes d'essais
  resetAttemptsUI();
  updateProgressSegmentsUI();
  updateSessionUI();

  // --- Anti-triche : ce morceau a-t-il déjà été joué dans cette session ?
  //
  // Seul un déplacement volontaire (pavé num. 2 / 3, « Nouvelle chanson »)
  // consulte la mémoire. Une relance sur place (changement de mode, de genre,
  // suppression d'un morceau) repart d'une manche vierge et efface la mémoire,
  // sinon on restituerait plus tard un état devenu incohérent.
  if (!delta) {
    manches.delete(currentTrack.id);
    sauverManches();
  } else {
    const memoire = manches.get(currentTrack.id);
    if (memoire) {
      if (memoire.issue || memoire.essais.length > MAX_ESSAIS_REPRISE) {
        passerEnEcouteSeule(memoire);
      } else {
        reprendreManche(memoire);
      }
      return;
    }
  }

  // Focus sur l'input
  guessInput.focus();
}

/** Écrit l'état de la manche en cours là où il doit être retrouvé. */
function memoriserManche() {
  if (!currentTrack || ecouteSeule) return;

  const etat = {
    essais: essaisDetail.map(e => ({ ...e })),
    essaiCourant: currentAttempt,
    issue: issueManche,
  };

  manches.set(currentTrack.id, etat);
  sauverManches();
}

/**
 * Repeint les six lignes d'essais à partir de `essaisDetail`.
 * @param {boolean} figer  true = manche close, aucune ligne « en cours »
 */
function peindreEssais({ figer = false } = {}) {
  const rows = document.querySelectorAll('.attempt-row');
  rows.forEach((row, idx) => {
    row.className = 'attempt-row';
    const textDiv = row.querySelector('.attempt-text');

    const essai = essaisDetail[idx];
    if (essai) {
      row.classList.add(essai.type);
      textDiv.innerText = essai.texte;
      return;
    }

    textDiv.innerHTML = '';
    if (!figer && idx === currentAttempt) {
      row.classList.add('current');
      const dur = durations[idx];
      const label = dur >= 2 ? 'secondes disponibles' : 'seconde disponible';
      textDiv.innerHTML = `<span class="placeholder">${dur} ${label}</span>`;
    }
  });
}

/** Reprise d'une manche laissée en plan : on remet le joueur là où il était. */
function reprendreManche(memoire, { silencieux = false } = {}) {
  essaisDetail = memoire.essais.map(e => ({ ...e }));
  attempts = essaisDetail.map(e => e.type);
  currentAttempt = memoire.essaiCourant;
  issueManche = null;

  peindreEssais();
  updateProgressSegmentsUI();
  guessInput.focus();

  if (silencieux) return;
  const n = essaisDetail.length;
  showToast(`Manche reprise : ${n} essai${n > 1 ? 's' : ''} déjà consommé${n > 1 ? 's' : ''}.`, 'warn');
}

/**
 * Morceau grillé : trop d'indices déjà entendus, ou manche terminée.
 * On dévoile la fiche et on ouvre la lecture complète.
 *
 * Les manches gagnées ou perdues ont déjà été comptabilisées en leur temps :
 * on ne les recompte pas. En revanche une manche **abandonnée** ne l'avait
 * jamais été — on la laissait disparaître des statistiques, alors qu'elle
 * verrouille définitivement le morceau. Elle est enregistrée ici, une fois,
 * comme une défaite.
 */
function passerEnEcouteSeule(memoire) {
  const abandonAcompter = !memoire.issue;

  ecouteSeule = true;
  essaisDetail = memoire.essais.map(e => ({ ...e }));
  attempts = essaisDetail.map(e => e.type);
  currentAttempt = Math.min(memoire.essaiCourant, durations.length - 1);
  issueManche = memoire.issue || 'abandon';

  if (abandonAcompter) {
    // On grave l'issue avant de compter : si le joueur repasse sur ce morceau,
    // `memoire.issue` sera renseignée et le compteur ne bougera plus.
    memoire.issue = 'abandon';
    manches.set(currentTrack.id, memoire);
    sauverManches();
    noterManche(currentTrack, 'abandon', null);
    saveStats(false, null, { abandon: true });
  }

  peindreEssais({ figer: true });

  guessInputContainer.classList.add('hidden');
  resultCard.classList.remove('hidden');
  modeRevelation(true);

  const resultTitle = document.getElementById('result-title');
  const resultSubtitle = document.getElementById('result-subtitle');
  const n = memoire.essais.length;

  if (memoire.issue === 'win') {
    resultTitle.innerText = 'Déjà trouvée 🏆';
    resultSubtitle.innerText = `Devinée en ${n} essai${n > 1 ? 's' : ''}. Écoute libre :`;
  } else if (memoire.issue === 'lose') {
    resultTitle.innerText = 'Déjà perdue 😢';
    resultSubtitle.innerText = 'Manche terminée. Écoute libre :';
  } else {
    resultTitle.innerText = 'Abandonnée 🔒';
    resultSubtitle.innerText =
      `${n} essais consommés puis laissée en plan : comptée comme perdue. Écoute libre :`;
  }

  remplirFicheResultat();

  // Lecture depuis le début, sans limite de palier.
  try { audio.currentTime = 0; } catch (_) { /* métadonnées pas encore là */ }

  const dureeTotale = currentTrack.duration || audio.duration;
  const dureeEcoutee = durations[Math.min(currentAttempt, durations.length - 1)];
  afficherZoneExtrait(currentTrackOffset, dureeEcoutee, dureeTotale);

  // Le compteur de droite affichait encore le palier de la manche : on le passe
  // sur la durée du morceau, cohérente avec le curseur de navigation.
  if (isFinite(dureeTotale) && dureeTotale > 0) timeMax.innerText = formatDuree(dureeTotale);

  updateRevealPlayer();
}

function resetAttemptsUI() {
  const rows = document.querySelectorAll('.attempt-row');
  rows.forEach((row, idx) => {
    row.className = 'attempt-row';
    const textDiv = row.querySelector('.attempt-text');
    if (idx === 0) {
      row.classList.add('current');
      // La durée vient des paliers réglés, pas d'un 0,2 s gravé dans le marbre.
      const dur = durations[0];
      const label = dur >= 2 ? 'secondes disponibles' : 'seconde disponible';
      textDiv.innerHTML = `<span class="placeholder">${dur} ${label}</span>`;
    } else {
      textDiv.innerHTML = '';
    }
  });
}

function updateProgressSegmentsUI() {
  progressSegments.forEach((segment, idx) => {
    segment.className = 'progress-segment';
    if (idx <= currentAttempt) {
      segment.classList.add('unlocked');
    }
  });
  
  // Mettre à jour la durée d'écoute restante affichée
  timeCurrent.innerText = `0.0s`;
  timeMax.innerText = `${durations[currentAttempt].toFixed(1)}s`;
  progressIndicator.style.width = '0%';
  
  // Configurer le bouton skip avec le nombre de secondes débloquées au clic
  if (currentAttempt < 5) {
    const addedSeconds = durations[currentAttempt + 1] - durations[currentAttempt];
    const addedSecondsText = addedSeconds.toFixed(1).replace('.0', '') + 's';
    skipBtn.innerHTML = `Passer (+<span id="skip-seconds-next">${addedSecondsText}</span>)`;
  } else {
    skipBtn.innerHTML = `Dernier essai !`;
  }
}

// ==========================================
// CE QU'IL FAUT DEVINER
// ==========================================
//
// Trois façons de répondre au même extrait : son titre (le mode d'origine),
// son artiste, ou son année de sortie. Le reste de la manche — paliers,
// essais, statistiques — ne change pas d'un mode à l'autre.

/** Un artiste exploitable, c'est-à-dire ni vide ni « Artiste inconnu ». */
function aUnArtiste(track) {
  const a = stripAll((track && track.artist) || '');
  return a.length > 0 && a !== 'artisteinconnu' && a !== 'artisteinconnue';
}

/** Les artistes distincts de la bibliothèque, pour l'autocomplétion. */
let allArtists = [];

function rebuildArtists() {
  const compte = new Map();
  for (const t of tracks) {
    if (!aUnArtiste(t)) continue;
    const nom = t.artist.trim();
    compte.set(nom, (compte.get(nom) || 0) + 1);
  }
  allArtists = [...compte.entries()]
    .map(([nom, count]) => ({ nom, count }))
    .sort((a, b) => b.count - a.count || a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * La réponse désigne-t-elle bien l'artiste attendu ?
 *
 * On accepte les parties d'un crédit multiple : pour « 6arelyhuman, asteria »,
 * répondre « asteria » est juste. On refuse en revanche les bouts de mot, sinon
 * « ar » validerait la moitié de la bibliothèque.
 */
function artisteCorrespond(saisie, attendu) {
  const s = stripAll(saisie);
  if (s.length < 2) return false;

  const morceaux = String(attendu || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bavec\b|\bx\b|\/|\+/i)
    .map(stripAll)
    .filter(a => a.length >= 2);

  return morceaux.includes(s) || stripAll(attendu) === s;
}

function soumettreArtiste(saisie) {
  pauseAudio();
  autocompleteList.classList.add('hidden');
  const bon = artisteCorrespond(saisie, currentTrack.artist);
  registerAttempt(bon ? 'success' : 'failed', saisie.trim());
}

const ANNEE_MINI = 1900;

function soumettreAnnee(saisie) {
  const an = parseInt(String(saisie).replace(/\D/g, ''), 10);
  const maxi = new Date().getFullYear() + 1;

  if (!an || an < ANNEE_MINI || an > maxi) {
    showToast(`Donne une année entre ${ANNEE_MINI} et ${maxi}.`, 'warn');
    return;
  }

  pauseAudio();
  autocompleteList.classList.add('hidden');

  const ecart = an - currentTrack.year;
  if (Math.abs(ecart) <= TOLERANCE_ANNEE) {
    registerAttempt('success', `${an}`);
    return;
  }
  // Un essai raté sert au moins à orienter le suivant.
  const indice = ecart < 0 ? 'plus récent ↑' : 'plus ancien ↓';
  const loin = Math.abs(ecart) > 12 ? ' (très loin)' : '';
  registerAttempt('failed', `${an} — c'est ${indice}${loin}`);
}

// Autocomplétion en direct
function handleAutocomplete() {
  const query = guessInput.value.trim();

  if (query.length > 0) {
    clearInputBtn.classList.remove('hidden');
  } else {
    clearInputBtn.classList.add('hidden');
    autocompleteList.classList.add('hidden');
    return;
  }

  // Une année ne s'autocomplète pas : quatre chiffres, et c'est tout.
  if (reglages.reponse === 'annee') {
    autocompleteList.classList.add('hidden');
    return;
  }
  if (reglages.reponse === 'artiste') {
    autocompleterArtistes(query);
    return;
  }

  // Filtrer les chansons de manière extrêmement tolérante (accents, apostrophes, espaces, tirets)
  const queryStrip = stripAll(query);

  // On cherche dans le titre, l'artiste, le titre d'origine et tous les alias
  // (« polish cow » doit trouver le morceau nommé en polonais).
  const matches = tracks.filter(t => {
    if (stripAll(t.title).includes(queryStrip)) return true;
    if (stripAll(t.artist).includes(queryStrip)) return true;
    if (stripAll(`${t.artist} ${t.title}`).includes(queryStrip)) return true;
    if (t.originalTitle && stripAll(t.originalTitle).includes(queryStrip)) return true;
    return (t.aliases || []).some(a => stripAll(a).includes(queryStrip));
  }).slice(0, 6);

  if (matches.length > 0) {
    autocompleteList.innerHTML = '';
    matches.forEach((track, index) => {
      const div = document.createElement('div');
      div.className = `autocomplete-item${index === 0 ? ' active' : ''}`;
      div.setAttribute('data-track', JSON.stringify(track));
      const orig = track.originalTitle
        ? `<span class="autocomplete-original">${escapeHtml(track.originalTitle)}</span>` : '';
      div.innerHTML = `
        <div class="autocomplete-title">${escapeHtml(track.title)} ${orig}</div>
        <div class="autocomplete-artist">${escapeHtml(track.artist)}</div>
      `;
      div.addEventListener('click', () => {
        selectSuggestion(track);
      });
      autocompleteList.appendChild(div);
    });
    autocompleteList.classList.remove('hidden');
  } else {
    autocompleteList.innerHTML = '<div class="autocomplete-item"><div class="autocomplete-title">Aucun résultat</div></div>';
    autocompleteList.classList.remove('hidden');
  }
}

/** Propose les artistes de la bibliothèque, du plus fourni au moins fourni. */
function autocompleterArtistes(query) {
  const q = stripAll(query);
  const matches = allArtists.filter(a => stripAll(a.nom).includes(q)).slice(0, 6);

  autocompleteList.innerHTML = '';
  if (matches.length === 0) {
    autocompleteList.innerHTML =
      '<div class="autocomplete-item"><div class="autocomplete-title">Aucun artiste de ce nom</div></div>';
    autocompleteList.classList.remove('hidden');
    return;
  }

  matches.forEach((a, index) => {
    const div = document.createElement('div');
    div.className = `autocomplete-item${index === 0 ? ' active' : ''}`;
    div.setAttribute('data-artist', a.nom);
    div.innerHTML = `
      <div class="autocomplete-title">${escapeHtml(a.nom)}</div>
      <div class="autocomplete-artist">${a.count} morceau${a.count > 1 ? 'x' : ''}</div>
    `;
    div.addEventListener('click', () => {
      guessInput.value = a.nom;
      soumettreArtiste(a.nom);
    });
    autocompleteList.appendChild(div);
  });
  autocompleteList.classList.remove('hidden');
}

function selectSuggestion(track) {
  autocompleteList.classList.add('hidden');
  guessInput.value = `${track.artist} - ${track.title}`;
  // Soumettre directement !
  submitTrackGuess(track);
}

/** Valide l'entrée surlignée de l'autocomplétion, quel que soit le mode. */
function validerSuggestion(item) {
  const artiste = item.getAttribute('data-artist');
  if (artiste !== null) {
    guessInput.value = artiste;
    soumettreArtiste(artiste);
    return;
  }
  const brut = item.getAttribute('data-track');
  if (brut) selectSuggestion(JSON.parse(brut));
}

function handleSkip() {
  registerAttempt('skipped', 'Passé ↷');
}

function submitTrackGuess(track) {
  pauseAudio();
  autocompleteList.classList.add('hidden'); // S'assurer que le dropdown disparait et ne repop pas
  
  const isMatch = (track.id === currentTrack.id);
  const guessText = `${track.artist} - ${track.title}`;
  
  if (isMatch) {
    registerAttempt('success', guessText);
  } else {
    registerAttempt('failed', guessText);
  }
}

function handleSubmitGuess() {
  autocompleteList.classList.add('hidden'); // Cacher le dropdown

  const guess = guessInput.value.trim();
  if (!guess) {
    showToast(reglages.reponse === 'annee'
      ? 'Donne une année.'
      : reglages.reponse === 'artiste'
        ? 'Donne un nom d\'artiste.'
        : 'Veuillez saisir ou choisir une chanson.', 'warn');
    return;
  }

  if (reglages.reponse === 'annee') {
    soumettreAnnee(guess);
    return;
  }
  if (reglages.reponse === 'artiste') {
    soumettreArtiste(guess);
    return;
  }

  // Chercher si la saisie correspond à un morceau de la liste
  const matchedTrack = tracks.find(t => 
    stripAll(`${t.artist} - ${t.title}`) === stripAll(guess) ||
    stripAll(`${t.title} - ${t.artist}`) === stripAll(guess)
  );

  if (matchedTrack) {
    submitTrackGuess(matchedTrack);
  } else {
    // Sinon on compare la saisie libre à toutes les réponses acceptées
    const guessStrip = stripAll(guess);
    const correctTitleStrip = stripAll(currentTrack.title);
    const correctArtistStrip = stripAll(currentTrack.artist);
    const correctFullStrip = stripAll(`${currentTrack.artist}${currentTrack.title}`);
    const correctFullRevStrip = stripAll(`${currentTrack.title}${currentTrack.artist}`);

    const accepted = [
      currentTrack.originalTitle,
      ...(currentTrack.aliases || []),
    ].filter(Boolean).map(stripAll).filter(a => a.length > 2);

    const isMatch = (
      guessStrip === correctFullStrip ||
      guessStrip === correctFullRevStrip ||
      guessStrip === correctTitleStrip ||
      accepted.includes(guessStrip) ||
      (correctArtistStrip && guessStrip.includes(correctTitleStrip) && guessStrip.includes(correctArtistStrip))
    );

    if (isMatch) {
      submitTrackGuess(currentTrack);
    } else {
      registerAttempt('failed', guess);
    }
  }
}

function registerAttempt(type, text) {
  pauseAudio();
  
  const currentRow = document.querySelector(`.attempt-row[data-index="${currentAttempt}"]`);
  currentRow.classList.remove('current');
  currentRow.classList.add(type);
  
  const textDiv = currentRow.querySelector('.attempt-text');
  textDiv.innerText = text;

  attempts.push(type);
  essaisDetail.push({ type, texte: text });

  if (type === 'success') {
    endGame(true);
  } else {
    // Passer à l'essai suivant
    if (currentAttempt < 5) {
      currentAttempt++;
      const nextRow = document.querySelector(`.attempt-row[data-index="${currentAttempt}"]`);
      nextRow.classList.add('current');
      const dur = durations[currentAttempt];
      const label = dur >= 2 ? 'secondes disponibles' : 'seconde disponible';
      nextRow.querySelector('.attempt-text').innerHTML = `<span class="placeholder">${dur} ${label}</span>`;

      guessInput.value = '';
      clearInputBtn.classList.add('hidden');
      updateProgressSegmentsUI();
      memoriserManche();
      guessInput.focus();
      playAudio();
    } else {
      // C'était la dernière tentative
      endGame(false);
    }
  }
}

function endGame(isWin) {
  // Masquer la zone de saisie
  guessInputContainer.classList.add('hidden');
  
  // Afficher le panneau de résultat, et rendre la barre du haut navigable
  resultCard.classList.remove('hidden');
  modeRevelation(true);
  
  // Configurer les textes de résultats
  const resultTitle = document.getElementById('result-title');
  const resultSubtitle = document.getElementById('result-subtitle');
  
  if (isWin) {
    resultTitle.innerText = "Gagné ! 🎉";
    resultSubtitle.innerText = `Trouvé en ${currentAttempt + 1} essai${currentAttempt > 0 ? 's' : ''}.`;
    
    // Déclencher une petite animation de confettis ou flash si on le souhaite
    triggerWinAnimation();

    // Auto-play l'extrait prolongé de 30 secondes !
    victoryAutoPlay = true;
    setTimeout(() => {
      playAudio();
    }, 500);
  } else {
    resultTitle.innerText = "Perdu... 😢";
    resultSubtitle.innerText = "La bonne réponse était :";
  }

  remplirFicheResultat();

  // Lecture complète débloquée : plus aucune limite de durée.
  // Gagné : on repart du point de l'extrait et on enchaîne jusqu'à la fin.
  // Perdu : on propose le morceau depuis son début.
  audio.currentTime = isWin ? currentTrackOffset : 0;

  // Portion réellement entendue : le palier atteint au dernier essai.
  const dureeEcoutee = durations[Math.min(currentAttempt, durations.length - 1)];
  const dureeTotale = currentTrack.duration || audio.duration;
  afficherZoneExtrait(currentTrackOffset, dureeEcoutee, dureeTotale);

  updateRevealPlayer();

  // La manche est close : y revenir n'ouvrira plus que l'écoute.
  issueManche = isWin ? 'win' : 'lose';
  memoriserManche();

  // Mettre à jour les statistiques
  noterManche(currentTrack, issueManche, isWin ? currentAttempt + 1 : null);
  saveStats(isWin, isWin ? currentAttempt + 1 : null);
  if (window.songlessExpansions) {
    window.songlessExpansions.onRoundEnd({
      track: currentTrack,
      isWin,
      attempt: isWin ? currentAttempt + 1 : null,
    });
  }
  if (window.songlessTrophies) {
    window.songlessTrophies.evaluateRound({
      track: currentTrack,
      isWin,
      attempt: isWin ? currentAttempt + 1 : null,
      durIndex: isWin ? currentAttempt : null,
      mode: reglages.reponse,
      speed: reglages.vitesse,
      way: reglages.sens,
      start: reglages.depart,
      preset: reglages.preset,
      fx: reglages.fx,
    });
  }
}

/** Renseigne la fiche du morceau dévoilé (titre, artiste, genre, pochette). */
function remplirFicheResultat() {
  document.getElementById('result-song-title').innerText = currentTrack.title;
  document.getElementById('result-song-artist').innerText = currentTrack.artist;

  // Titre d'origine (pour les morceaux renommés en nom connu) et genre
  const originalEl = document.getElementById('result-song-original');
  if (currentTrack.originalTitle) {
    originalEl.innerText = `Titre d'origine : ${currentTrack.originalTitle}`;
    originalEl.classList.remove('hidden');
  } else {
    originalEl.classList.add('hidden');
  }

  const genreEl = document.getElementById('result-song-genre');
  if (currentTrack.genre) {
    genreEl.innerText = currentTrack.genre;
    genreEl.classList.remove('hidden');
  } else {
    genreEl.classList.add('hidden');
  }

  const coverImg = document.getElementById('result-cover');
  const coverFallback = document.getElementById('result-cover-fallback');

  if (currentTrack.hasCover) {
    // La fiche peut annoncer une pochette que le serveur n'a plus (fichier
    // remplacé, bibliothèque modifiée) : on retombe alors sur la note de
    // musique plutôt que sur une image cassée.
    coverImg.onerror = () => {
      coverImg.onerror = null;
      coverImg.classList.add('hidden');
      coverFallback.classList.remove('hidden');
    };
    coverImg.src = `/api/tracks/${currentTrack.id}/cover`;
    coverImg.classList.remove('hidden');
    coverFallback.classList.add('hidden');
  } else {
    coverImg.onerror = null;
    coverImg.classList.add('hidden');
    coverFallback.classList.remove('hidden');
  }
}

// ==========================================
// ANIMATION DE VICTOIRE
// ==========================================
function triggerWinAnimation() {
  // Un effet visuel sympa sur la carte de jeu
  const card = document.querySelector('.game-card');
  card.style.transform = 'scale(1.02)';
  card.style.boxShadow = '0 15px 40px rgba(79, 139, 99, 0.25)'; // Ombre verte
  
  setTimeout(() => {
    card.style.transform = '';
    card.style.boxShadow = '';
  }, 400);
}

// ==========================================
// BIBLIOTHÈQUE / UPLOAD
// ==========================================
function initLibraryEvents() {
  // Clic sur Dropzone déclenche l'input file
  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  // Sélection de fichier
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFilesUpload(fileInput.files);
    }
  });

  // Glisser-Déposer
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFilesUpload(files);
    }
  });

  // Bouton rafraîchir
  refreshLibraryBtn.addEventListener('click', () => {
    loadLibrary(() => {
      showToast("Bibliothèque actualisée !");
    });
  });

  // Recherche dans la bibliothèque
  librarySearch.addEventListener('input', () => {
    filterLibraryDisplay();
  });

  // Sélectionner tout
  const selectAllCheckbox = document.getElementById('select-all-tracks');
  selectAllCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const checkboxes = tracksListContainer.querySelectorAll('.track-select-checkbox');
    checkboxes.forEach(cb => {
      const item = cb.closest('.track-item');
      if (!item.classList.contains('hidden')) {
        cb.checked = isChecked;
      }
    });
    updateBulkActionsUI();
  });

  // Filtre « à renommer »
  initReviewFilter();

  // Supprimer la sélection
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  deleteSelectedBtn.addEventListener('click', () => {
    const checkedBoxes = tracksListContainer.querySelectorAll('.track-select-checkbox:checked');
    const ids = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-id'));
    
    if (ids.length === 0) return;

    // La suppression efface les fichiers du disque, sans corbeille. « Tout
    // sélectionner » suivi d'un clic distrait effaçait toute la bibliothèque
    // derrière un unique OK. Au-delà de quelques morceaux, on demande de
    // recopier le nombre : le geste devient volontaire.
    if (ids.length > SUPPRESSION_SANS_SAISIE) {
      const saisie = prompt(
        `Suppression DÉFINITIVE de ${ids.length} musiques (fichiers effacés du disque, pas de corbeille).\n\n`
        + `Pour confirmer, tape le nombre ${ids.length} :`
      );
      if (saisie === null) return;
      if (saisie.trim() !== String(ids.length)) {
        showToast('Suppression annulée : le nombre ne correspond pas.', 'warn');
        return;
      }
      deleteMultipleTracks(ids);
      return;
    }

    if (confirm(`Supprimer définitivement ${ids.length} musique${ids.length > 1 ? 's' : ''} du disque ?`)) {
      deleteMultipleTracks(ids);
    }
  });
}

function loadLibrary(callback = null) {
  Promise.all([
    fetch('/api/tracks').then(res => res.json()),
    fetch('/api/genres').then(res => res.json()).catch(() => ({ genres: [] })),
  ])
    .then(([trackData, genreData]) => {
      tracks = trackData;
      allGenres = genreData.genres || [];
      tracksCountSpan.innerText = tracks.length;

      rebuildArtists();
      renderGenreChips();
      renderDecadeChips();
      renderGenreSelects();
      renderLibraryList();
      majBoutonsOptions();

      // L'ordre de passage dépend de la seed : on le recalcule à chaque chargement.
      rebuildPlaylist();

      // Un mode de réponse retenu d'une session précédente peut ne plus avoir
      // de morceau jouable — bibliothèque changée, années effacées. Plutôt que
      // d'ouvrir sur un jeu vide, on retombe sur le titre.
      if (playlist.length === 0 && tracks.length > 0 && reglages.reponse !== 'titre') {
        reglages.reponse = 'titre';
        sauverReglages();
        majBoutonsOptions();
        majPlaceholderReponse();
        rebuildPlaylist();
        showToast('Aucun morceau jouable dans ce mode : retour au titre.', 'warn');
      }

      // Si la chanson de jeu n'a pas encore été définie, lancer une partie
      if (!currentTrack && playlist.length > 0) {
        startNewGame();
      }

      if (callback) callback();
    })
    .catch(err => {
      console.error("Erreur chargement bibliothèque:", err);
      showToast("Erreur lors de la récupération de la bibliothèque.", 'error');
    });
}

function renderLibraryList() {
  // La liste est reconstruite : les boutons de l'aperçu en cours disparaissent.
  arreterApercu();
  tracksListContainer.innerHTML = '';

  if (tracks.length === 0) {
    tracksListContainer.innerHTML = `
      <div class="empty-library">
        <i data-lucide="music-4"></i>
        <p>Aucune musique détectée. Ajoutez-en pour commencer à jouer !</p>
      </div>
    `;
    document.getElementById('tracks-bulk-actions').classList.add('hidden');
    dessinerIcones();
    return;
  }

  tracks.forEach(track => {
    const item = document.createElement('div');
    item.className = 'track-item';
    item.setAttribute('data-title', track.title.toLowerCase());
    item.setAttribute('data-artist', track.artist.toLowerCase());
    
    // Pochette
    // Pochette manquante côté serveur : on remplace l'image cassée par la note.
    let coverHtml = '🎵';
    if (track.hasCover) {
      coverHtml = `<img src="/api/tracks/${track.id}/cover" alt="Pochette"
        data-cover-fallback>`;
    }

    const review = track.needsReview
      ? '<span class="track-flag" title="Titre à renommer en nom connu">⚠</span>' : '';
    const original = track.originalTitle
      ? `<span class="track-item-original">${escapeHtml(track.originalTitle)}</span>` : '';

    item.setAttribute('data-genre', track.genre || 'Autre');
    item.setAttribute('data-review', track.needsReview ? '1' : '0');
    item.innerHTML = `
      <div class="preview-progress" aria-hidden="true"><span></span></div>
      <input type="checkbox" class="track-select-checkbox" data-id="${track.id}">
      <div class="track-item-cover">${coverHtml}</div>
      <div class="track-item-details">
        <div class="track-item-title">${escapeHtml(track.title)} ${review}</div>
        <div class="track-item-artist">${escapeHtml(track.artist)} ${original}</div>
      </div>
      <span class="genre-badge small">${escapeHtml(track.genre || 'Autre')}</span>
      <span class="preview-time" aria-hidden="true"></span>
      <button class="preview-track-btn" data-id="${track.id}" title="Écouter ce morceau">
        <i data-lucide="play" class="icon-play"></i>
        <i data-lucide="pause" class="icon-pause hidden"></i>
      </button>
      <button class="edit-track-btn" data-id="${track.id}" title="Modifier titre et genre">
        <i data-lucide="pencil"></i>
      </button>
      <button class="delete-track-btn" data-id="${track.id}" title="Supprimer la musique">
        <i data-lucide="trash-2"></i>
      </button>
    `;

    // Écouteur checkbox
    item.querySelector('.track-select-checkbox').addEventListener('change', () => {
      updateBulkActionsUI();
    });

    // Écouteur lecture
    item.querySelector('.preview-track-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      basculerApercu(track);
    });

    // Écouteur édition
    item.querySelector('.edit-track-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(track);
    });

    // Écouteur suppression
    item.querySelector('.delete-track-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      const trackName = track.title;
      if (confirm(`Voulez-vous vraiment supprimer "${trackName}" ?`)) {
        deleteTrack(id);
      }
    });

    tracksListContainer.appendChild(item);
  });

  updateBulkActionsUI();
  majCompteurARenommer();
  filterLibraryDisplay();   // la liste vient d'être reconstruite : on réapplique les filtres
  dessinerIcones();
}

// ==========================================
// APERÇU DEPUIS LA BIBLIOTHÈQUE
// ==========================================

/**
 * Lance ou arrête l'écoute d'un morceau depuis la bibliothèque.
 * Le lecteur du jeu se tait : une seule source sonore à la fois.
 */
function basculerApercu(track) {
  if (apercuId === track.id && !apercu.paused) {
    apercu.pause();
    apercuId = null;
    majBoutonsApercu();
    return;
  }

  pauseAudio();

  apercu.src = `/api/tracks/${track.id}/audio`;
  apercuId = track.id;
  majBoutonsApercu();

  apercu.play().catch(err => {
    // Changer de morceau interrompt la promesse précédente : ce n'est pas
    // une panne, le navigateur enchaîne tout seul.
    if (err && err.name === 'AbortError') return;
    console.error('Aperçu impossible :', err);
    apercuId = null;
    majBoutonsApercu();
    showToast(`Lecture impossible : ${track.title}`, 'error');
  });
}

function arreterApercu() {
  if (!apercuId) return;
  apercu.pause();
  apercuId = null;
  majBoutonsApercu();
}

/** Reflète l'aperçu en cours sur les boutons et la ligne concernée. */
function majBoutonsApercu() {
  tracksListContainer.querySelectorAll('.preview-track-btn').forEach(btn => {
    const actif = apercuId !== null && btn.getAttribute('data-id') === apercuId;

    const ligne = btn.closest('.track-item');
    if (ligne) {
      ligne.classList.toggle('playing', actif);
      if (!actif) {
        const barre = ligne.querySelector('.preview-progress span');
        if (barre) barre.style.width = '0%';
        const temps = ligne.querySelector('.preview-time');
        if (temps) temps.innerText = '';
      }
    }

    const iconPlay = btn.querySelector('.icon-play');
    const iconPause = btn.querySelector('.icon-pause');
    if (iconPlay) iconPlay.classList.toggle('hidden', actif);
    if (iconPause) iconPause.classList.toggle('hidden', !actif);
  });
}

/**
 * Avance la barre et le compteur de la ligne en écoute.
 *
 * On s'accroche aux événements du lecteur plutôt qu'à un intervalle : le
 * navigateur les déclenche déjà, et ils s'arrêtent tout seuls avec la lecture.
 *
 * La durée totale n'est connue qu'une fois les métadonnées lues — sur une
 * grosse bibliothèque ça peut prendre un instant. On affiche donc le temps
 * écoulé sans attendre, et la barre dès que la durée arrive : mieux vaut un
 * compteur qui tourne qu'une ligne muette.
 */
function majProgressionApercu() {
  if (!apercuId) return;
  const bouton = tracksListContainer.querySelector(`.preview-track-btn[data-id="${CSS.escape(apercuId)}"]`);
  const ligne = bouton && bouton.closest('.track-item');
  if (!ligne) return;

  const duree = apercu.duration;
  const dureeConnue = isFinite(duree) && duree > 0;

  const barre = ligne.querySelector('.preview-progress span');
  if (barre && dureeConnue) barre.style.width = `${(apercu.currentTime / duree) * 100}%`;

  const temps = ligne.querySelector('.preview-time');
  if (temps) {
    temps.innerText = dureeConnue
      ? `${formatDuree(apercu.currentTime)} / ${formatDuree(duree)}`
      : formatDuree(apercu.currentTime);
  }
}

// `durationchange` et `loadedmetadata` rattrapent le cas où la durée arrive
// après les premiers `timeupdate`.
['timeupdate', 'durationchange', 'loadedmetadata'].forEach(evt =>
  apercu.addEventListener(evt, majProgressionApercu));

apercu.addEventListener('ended', arreterApercu);

function updateBulkActionsUI() {
  const bulkActionsBar = document.getElementById('tracks-bulk-actions');
  const selectAllCheckbox = document.getElementById('select-all-tracks');
  const selectedCountSpan = document.getElementById('selected-tracks-count');
  
  const allCheckboxes = tracksListContainer.querySelectorAll('.track-select-checkbox');
  const checkedBoxes = tracksListContainer.querySelectorAll('.track-select-checkbox:checked');
  
  if (allCheckboxes.length > 0) {
    bulkActionsBar.classList.remove('hidden');
    selectedCountSpan.innerText = checkedBoxes.length;
    
    selectAllCheckbox.checked = (allCheckboxes.length === checkedBoxes.length);
  } else {
    bulkActionsBar.classList.add('hidden');
  }
}

function deleteMultipleTracks(ids) {
  showToast(`Suppression de ${ids.length} musiques...`);
  
  const promises = ids.map(id => 
    fetch(`/api/tracks/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .catch(err => ({ success: false, error: err.message }))
  );
  
  Promise.all(promises)
    .then(results => {
      const successCount = results.filter(r => r.success).length;
      showToast(`${successCount} musiques supprimées.`);
      loadLibrary();
      
      // Réinitialiser la sélection tout
      document.getElementById('select-all-tracks').checked = false;
      
      // Si la chanson en cours a été supprimée, relancer une partie
      if (currentTrack && ids.includes(currentTrack.id)) {
        currentTrack = null;
        if (tracks.length > ids.length) startNewGame();
      }
    });
}

function filterLibraryDisplay() {
  const query = librarySearch.value.trim().toLowerCase();
  const genre = libraryGenreFilter ? libraryGenreFilter.value : '';
  const items = tracksListContainer.querySelectorAll('.track-item');

  let visibles = 0;
  items.forEach(item => {
    const title = item.getAttribute('data-title');
    const artist = item.getAttribute('data-artist');
    const itemGenre = item.getAttribute('data-genre') || 'Autre';

    const matchesText = title.includes(query) || artist.includes(query);
    const matchesGenre = !genre || itemGenre === genre;
    const matchesReview = !filtreARenommer || item.getAttribute('data-review') === '1';

    const visible = matchesText && matchesGenre && matchesReview;
    item.classList.toggle('hidden', !visible);
    if (visible) visibles++;
  });

  // Le compteur du titre suit ce qui est réellement affiché : sinon « Musiques
  // installées (1564) » au-dessus de 12 lignes filtrées prête à confusion.
  const filtreActif = query || genre || filtreARenommer;
  tracksCountSpan.innerText = filtreActif ? `${visibles} / ${tracks.length}` : tracks.length;
}

/** Bascule le filtre « à renommer » et rafraîchit l'affichage. */
function initReviewFilter() {
  const btn = document.getElementById('review-filter-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    filtreARenommer = !filtreARenommer;
    btn.classList.toggle('active', filtreARenommer);
    btn.setAttribute('aria-pressed', String(filtreARenommer));
    filterLibraryDisplay();

    if (filtreARenommer && !tracks.some(t => t.needsReview)) {
      showToast('Aucun titre à renommer : la bibliothèque est propre.', 'ok');
    }
  });
}

/** Met à jour le compteur du bouton, et le masque s'il n'y a rien à renommer. */
function majCompteurARenommer() {
  const btn = document.getElementById('review-filter-btn');
  const compteur = document.getElementById('review-count');
  if (!btn || !compteur) return;

  const n = tracks.filter(t => t.needsReview).length;
  compteur.innerText = n;
  btn.classList.toggle('hidden', n === 0);

  // Plus rien à renommer alors que le filtre était actif : on le relâche,
  // sinon la liste resterait vide sans explication.
  if (n === 0 && filtreARenommer) {
    filtreARenommer = false;
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  }
}

function handleFilesUpload(files) {
  const file = files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('audio', file);

  // Afficher la barre de progression
  uploadProgressContainer.classList.remove('hidden');
  uploadProgressBar.style.width = '0%';
  uploadProgressText.innerText = `Envoi de ${file.name} (0%)`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload', true);
  const pair = window.songlessShared && window.songlessShared.pairToken();
  if (pair) xhr.setRequestHeader('X-Songless-Pair', pair);

  // Suivi de l'upload
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);

    if (percent < 100) {
      uploadProgressBar.classList.remove('indetermine');
      uploadProgressBar.style.width = `${percent}%`;
      uploadProgressText.innerText = `Envoi ${percent}%`;
      return;
    }

    // L'envoi est fini, mais le serveur travaille encore : lecture des tags,
    // titres, genres, doublons. Sans ça la barre restait figée sur 100 % et
    // rien ne disait si ça avançait ou si c'était planté.
    uploadProgressBar.style.width = '100%';
    uploadProgressBar.classList.add('indetermine');
    uploadProgressText.innerText = 'Envoi terminé — tri des morceaux en cours…';
  };

  xhr.onload = () => {
    uploadProgressBar.classList.remove('indetermine');
    uploadProgressContainer.classList.add('hidden');
    if (xhr.status === 200) {
      afficherRapportImport(JSON.parse(xhr.responseText));
      loadLibrary(); // Actualiser
    } else {
      let errMsg = "Erreur lors de l'envoi.";
      try {
        const response = JSON.parse(xhr.responseText);
        errMsg = response.error || errMsg;
      } catch (e) {}
      showToast(errMsg, 'error');
    }
  };

  xhr.onerror = () => {
    uploadProgressBar.classList.remove('indetermine');
    uploadProgressContainer.classList.add('hidden');
    showToast("Erreur réseau lors de l'envoi.", 'error');
  };

  xhr.send(formData);
}

/** Rend compte de ce qui a été ajouté, écarté ou refusé lors d'un import. */
function afficherRapportImport(rapport) {
  const zone = document.getElementById('import-report');
  if (!zone) return;

  const ajoutes = rapport.ajoutes || [];
  const doublons = rapport.doublons || [];
  const erreurs = rapport.erreurs || [];
  const aRevoir = rapport.aRevoir || [];

  const lignes = [];
  if (rapport.antivirus) {
    lignes.push(`<div class="report-line ok">🛡 ${escapeHtml(rapport.antivirus)}</div>`);
  }
  lignes.push(`<div class="report-head">${ajoutes.length} ajouté${ajoutes.length > 1 ? 's' : ''}`
    + (doublons.length ? ` · ${doublons.length} doublon${doublons.length > 1 ? 's' : ''} écarté${doublons.length > 1 ? 's' : ''}` : '')
    + (erreurs.length ? ` · ${erreurs.length} en échec` : '')
    + '</div>');

  for (const a of ajoutes.slice(0, 20)) {
    lignes.push(`<div class="report-line ok">+ ${escapeHtml(a.titre)}`
      + (a.artiste ? ` <span class="report-dim">— ${escapeHtml(a.artiste)}</span>` : '')
      + ` <span class="report-genre">${escapeHtml(a.genre)}</span></div>`);
  }
  if (ajoutes.length > 20) lignes.push(`<div class="report-line report-dim">… et ${ajoutes.length - 20} autres</div>`);

  for (const d of doublons.slice(0, 10)) {
    lignes.push(`<div class="report-line dup">= déjà présent : ${escapeHtml(d.doublonDe)}</div>`);
  }
  if (doublons.length > 10) lignes.push(`<div class="report-line report-dim">… et ${doublons.length - 10} autres doublons</div>`);

  for (const e of erreurs.slice(0, 5)) {
    lignes.push(`<div class="report-line ko">✗ ${escapeHtml(e.fichier)} : ${escapeHtml(e.erreur)}</div>`);
  }

  if (aRevoir.length) {
    lignes.push(`<div class="report-line warn">⚠ ${aRevoir.length} titre(s) en alphabet non latin à renommer (crayon dans la liste)</div>`);
  }
  if (rapport.genresIncomplets) {
    lignes.push('<div class="report-line warn">'
      + `⚠ ${rapport.genresIncomplets} morceaux sans genre : lance <code>node tools/enrich.js</code> pour les compléter</div>`);
  }

  zone.innerHTML = lignes.join('');
  zone.classList.remove('hidden');

  if (ajoutes.length === 0 && doublons.length > 0) {
    showToast('Tout était déjà dans la bibliothèque.');
  } else if (ajoutes.length) {
    showToast(`${ajoutes.length} morceau${ajoutes.length > 1 ? 'x' : ''} ajouté${ajoutes.length > 1 ? 's' : ''}.`, 'ok');
  }
}

function deleteTrack(id) {
  fetch(`/api/tracks/${id}`, {
    method: 'DELETE'
  })
    .then(res => res.json())
    .then(response => {
      if (response.success) {
        showToast("Musique supprimée.", 'ok');
        loadLibrary();
        
        // Si c'était la chanson en cours, on relance une partie
        if (currentTrack && currentTrack.id === id) {
          currentTrack = null;
          if (tracks.length > 1) startNewGame();
        }
      } else {
        showToast(response.error || "Impossible de supprimer la musique.", 'error');
      }
    })
    .catch(err => {
      console.error("Erreur suppression:", err);
      showToast("Erreur réseau lors de la suppression.", 'error');
    });
}

// ==========================================
// PROFILS
// ==========================================
//
// Plusieurs personnes jouent sur le même ordinateur. Sans profil, la série de
// l'un s'effondre à cause des manches de l'autre, et le taux de réussite ne
// veut plus rien dire. Chaque profil a donc ses statistiques, son historique
// et ses réglages ; la bibliothèque, elle, reste commune.

const CLE_PROFILS = 'songless_profils';

function profilsParDefaut() {
  return { actif: 'p1', liste: [{ id: 'p1', nom: 'Manaël', emoji: '🎧' }] };
}

/** Suffixe des clés de stockage propres au profil actif. */
function cleProfil(base) {
  return `${base}:${profilActif ? profilActif.id : 'p1'}`;
}

function chargerProfils() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(CLE_PROFILS) || 'null');
  } catch (_) { /* illisible : on repart des valeurs par défaut */ }

  if (!data || !Array.isArray(data.liste) || data.liste.length === 0) {
    data = profilsParDefaut();

    // Reprise de l'existant : les statistiques d'avant les profils
    // appartiennent au premier joueur, il serait absurde de les jeter.
    try {
      const ancien = localStorage.getItem('songless_stats');
      if (ancien && !localStorage.getItem('songless_stats:p1')) {
        localStorage.setItem('songless_stats:p1', ancien);
      }
    } catch (_) { /* sans conséquence */ }
  }

  profils = data.liste;
  profilActif = profils.find(p => p.id === data.actif) || profils[0];
  sauverProfils();
}

function sauverProfils() {
  try {
    localStorage.setItem(CLE_PROFILS, JSON.stringify({
      actif: profilActif ? profilActif.id : profils[0].id,
      liste: profils,
    }));
  } catch (_) { /* stockage indisponible : les profils vivent le temps de l'onglet */ }
  if (window.songlessShared && window.songlessShared.ready) {
    profils.forEach(p => window.songlessShared.queueProfile(p.id));
  }
}

function majBoutonProfil() {
  const emoji = document.getElementById('profile-emoji');
  const nom = document.getElementById('profile-name');
  if (emoji) emoji.innerText = profilActif ? profilActif.emoji : '🎧';
  if (nom) nom.innerText = profilActif ? profilActif.nom : 'Manaël';
}

/** Bascule de profil : tout ce qui est personnel est rechargé. */
function changerProfil(id) {
  const cible = profils.find(p => p.id === id);
  if (!cible || cible === profilActif) return;

  profilActif = cible;
  sauverProfils();
  majBoutonProfil();

  chargerReglages();
  appliquerReglages({ relancer: true });

  // La session (compteurs « depuis l'ouverture ») repart pour le nouveau venu.
  if (!lireStats('session')) writeStats('session', emptyStats());
  updateStatsDisplay();

  showToast(`${cible.emoji} ${cible.nom} : à toi de jouer.`);
}

function renderProfileList() {
  const zone = document.getElementById('profile-list');
  if (!zone) return;

  zone.innerHTML = '';
  for (const p of profils) {
    const ligne = document.createElement('div');
    ligne.className = `profile-row${p === profilActif ? ' active' : ''}`;
    ligne.setAttribute('data-id', p.id);

    if (p.id === profilEnRenommage) {
      ligne.innerHTML = ligneRenommage(p);
    } else {
      const stats = lireStats('all', p.id) || emptyStats();
      const multi = p.multiplayer && typeof p.multiplayer === 'object' ? p.multiplayer : {};
      const sessionsMulti = Number(multi.sessions) || 0;
      const winsMulti = Number(multi.wins) || 0;
      ligne.innerHTML = `
        <button class="profile-pick" data-id="${escapeHtml(p.id)}">
          <span class="profile-emoji">${escapeHtml(p.emoji)}</span>
          <span class="profile-row-name">${escapeHtml(p.nom)}</span>
          <span class="profile-row-stats">Solo : ${stats.played} manche${stats.played > 1 ? 's' : ''} · Multi : ${sessionsMulti} soirée${sessionsMulti > 1 ? 's' : ''}, ${winsMulti} victoire${winsMulti > 1 ? 's' : ''}</span>
        </button>
        <button class="profile-edit" data-id="${escapeHtml(p.id)}" title="Renommer ce profil">
          <i data-lucide="pencil"></i>
        </button>
        <button class="profile-del" data-id="${escapeHtml(p.id)}" title="Supprimer ce profil">
          <i data-lucide="trash-2"></i>
        </button>
      `;
    }
    zone.appendChild(ligne);
  }

  zone.querySelectorAll('.profile-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      changerProfil(btn.getAttribute('data-id'));
      renderProfileList();
    });
  });

  zone.querySelectorAll('.profile-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      profilEnRenommage = btn.getAttribute('data-id');
      renderProfileList();
    });
  });

  zone.querySelectorAll('.profile-del').forEach(btn => {
    btn.addEventListener('click', () => supprimerProfil(btn.getAttribute('data-id')));
  });

  brancherRenommage(zone);
  dessinerIcones();
}

/** Le profil dont la ligne est en cours d'édition, s'il y en a un. */
let profilEnRenommage = null;

function ligneRenommage(p) {
  return `
    <div class="profile-rename">
      <input type="text" class="rename-emoji" maxlength="2" value="${escapeHtml(p.emoji)}"
             aria-label="Emoji du profil">
      <input type="text" class="rename-name" maxlength="20" value="${escapeHtml(p.nom)}"
             aria-label="Nom du profil">
      <button class="cta-btn rename-ok" title="Enregistrer"><i data-lucide="check"></i></button>
      <button class="ghost-btn rename-cancel" title="Annuler"><i data-lucide="x"></i></button>
    </div>
  `;
}

/**
 * Écouteurs de la ligne en cours d'édition.
 * Entrée valide, Échap annule : renommer un profil ne mérite pas d'aller
 * chercher la souris.
 */
function brancherRenommage(zone) {
  const champNom = zone.querySelector('.rename-name');
  if (!champNom) return;

  const champEmoji = zone.querySelector('.rename-emoji');
  const ligne = champNom.closest('.profile-row');
  const id = ligne.getAttribute('data-id');

  const annuler = () => {
    profilEnRenommage = null;
    renderProfileList();
  };

  const valider = () => {
    const nom = champNom.value.trim();
    if (!nom) {
      showToast('Un profil a besoin d\'un nom.', 'warn');
      champNom.focus();
      return;
    }
    renommerProfil(id, nom, champEmoji.value.trim());
  };

  zone.querySelector('.rename-ok').addEventListener('click', valider);
  zone.querySelector('.rename-cancel').addEventListener('click', annuler);

  [champNom, champEmoji].forEach(champ => {
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); valider(); }
      if (e.key === 'Escape') { e.preventDefault(); annuler(); }
    });
  });

  champNom.focus();
  champNom.select();
}

/**
 * Renomme un profil. Seul l'affichage change : l'identifiant reste le même, donc
 * les statistiques, l'historique et les réglages suivent le profil renommé.
 */
function renommerProfil(id, nom, emoji) {
  const cible = profils.find(p => p.id === id);
  if (!cible) return;

  const avant = cible.nom;
  cible.nom = nom;
  cible.emoji = emoji || cible.emoji || '🎧';

  sauverProfils();
  profilEnRenommage = null;
  majBoutonProfil();
  renderProfileList();

  if (avant !== nom) showToast(`« ${avant} » s'appelle maintenant « ${nom} ».`, 'ok');
}

function supprimerProfil(id) {
  if (profils.length <= 1) {
    showToast('Il faut au moins un profil.', 'warn');
    return;
  }
  const cible = profils.find(p => p.id === id);
  if (!cible) return;
  if (!confirm(`Supprimer le profil « ${cible.nom} » et toutes ses statistiques ?`)) return;

  if (window.songlessShared && window.songlessShared.ready) {
    window.songlessShared.api(`/api/player/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(error => showToast(error.message, 'warn'));
  }

  // On efface aussi ce qui lui appartient, sinon les clés s'accumulent sans
  // que rien ne les rattache plus à personne.
  for (const base of ['songless_stats', 'songless_historique']) {
    try { localStorage.removeItem(`${base}:${id}`); } catch (_) {}
  }
  try { localStorage.removeItem(`songless_reglages:${id}`); } catch (_) {}

  const etaitActif = profilActif && profilActif.id === id;
  profils = profils.filter(p => p.id !== id);
  if (etaitActif) {
    profilActif = profils[0];
    chargerReglages();
    appliquerReglages({ relancer: true });
    updateStatsDisplay();
  }
  sauverProfils();
  majBoutonProfil();
  renderProfileList();
}

function initProfilEvents() {
  const btn = document.getElementById('profile-btn');
  const modal = document.getElementById('profile-modal');
  if (!btn || !modal) return;

  btn.addEventListener('click', () => {
    profilEnRenommage = null;   // on ne rouvre pas sur une édition laissée en plan
    renderProfileList();
    modal.classList.remove('hidden');
  });

  document.getElementById('profile-close-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  const ajouter = () => {
    const nomInput = document.getElementById('new-profile-name');
    const emojiInput = document.getElementById('new-profile-emoji');
    const nom = nomInput.value.trim();
    if (!nom) {
      showToast('Donne un prénom au profil.', 'warn');
      return;
    }
    const id = `p${Date.now().toString(36)}`;
    profils.push({ id, nom, emoji: emojiInput.value.trim() || '🎧' });
    sauverProfils();
    nomInput.value = '';
    changerProfil(id);
    renderProfileList();
  };

  const picker = document.getElementById('pc-emoji-picker');
  if (picker) {
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-emoji]');
      if (!btn) return;
      picker.querySelectorAll('.emoji-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const emojiInput = document.getElementById('new-profile-emoji');
      if (emojiInput) emojiInput.value = btn.getAttribute('data-emoji') || '🎧';
    });
  }

  document.getElementById('add-profile-btn').addEventListener('click', ajouter);
  document.getElementById('new-profile-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ajouter();
  });
}

// ==========================================
// RÉGLAGES DE JEU
// ==========================================
//
// Ce qui change la façon de jouer sans toucher à la bibliothèque : ce qu'il
// faut deviner, comment sonne l'extrait, et la durée des six paliers.

function reglagesParDefaut() {
  return {
    reponse: 'titre',       // 'titre' | 'artiste' | 'annee'
    vitesse: 1,             // 0.75 | 1 | 1.25 | 1.5
    sens: 'normal',         // 'normal' | 'inverse'
    depart: 'seed',         // 'seed' | 'refrain' | 'debut'
    preset: 'normal',       // 'facile' | 'normal' | 'hardcore' | 'perso'
    fx: 'none',             // 'none' | '8bit' | 'radio' | 'underwater' | 'nightcore' | 'slowed' | 'bass'
    paliers: [...PALIERS_PRESETS.normal],
  };
}

// L'année exacte se devine rarement : on accepte l'à-peu-près.
const TOLERANCE_ANNEE = 2;

function chargerReglages() {
  const def = reglagesParDefaut();
  try {
    const brut = JSON.parse(localStorage.getItem(cleProfil('songless_reglages')) || 'null');
    reglages = brut ? { ...def, ...brut } : def;
  } catch (_) {
    reglages = def;
  }
  if (!Array.isArray(reglages.paliers) || reglages.paliers.length !== 6) {
    reglages.paliers = [...def.paliers];
  }
  durations = normaliserPaliers(reglages.paliers);
}

function sauverReglages() {
  try {
    localStorage.setItem(cleProfil('songless_reglages'), JSON.stringify(reglages));
  } catch (_) { /* sans conséquence : les réglages tiennent le temps de l'onglet */ }
  if (window.songlessShared && window.songlessShared.ready && profilActif) {
    window.songlessShared.queueProfile(profilActif.id);
  }
}

/**
 * Rend une suite de paliers utilisable : six nombres croissants, bornés.
 * Une saisie farfelue ne doit jamais casser une manche.
 */
function normaliserPaliers(liste) {
  const out = [];
  let mini = 0.05;
  for (let i = 0; i < 6; i++) {
    let v = Number(liste[i]);
    if (!isFinite(v) || v <= 0) v = PALIERS_PRESETS.normal[i];
    v = Math.min(Math.max(v, mini), 120);
    v = Math.round(v * 10) / 10;
    if (v <= mini && i > 0) v = Math.round((mini + 0.1) * 10) / 10;
    out.push(v);
    mini = v;
  }
  return out;
}

/**
 * Applique les réglages à l'interface et, si besoin, relance la manche.
 * @param {boolean} relancer  true quand le changement invalide la manche en cours
 */
function appliquerReglages({ relancer = false } = {}) {
  durations = normaliserPaliers(reglages.paliers);

  majSegmentsPaliers();
  majBoutonsOptions();
  majPlaceholderReponse();

  // La vitesse s'applique au lecteur du jeu ; le morceau dévoilé, lui, se
  // réécoute toujours à sa vitesse normale.
  audio.playbackRate = 1;

  if (relancer) {
    rebuildPlaylist({ keepCurrent: reglages.reponse !== 'annee' });
    if (playlist.length > 0) startNewGame();
  } else {
    updateProgressSegmentsUI();
  }
  sauverReglages();
}

/**
 * La barre du haut est découpée selon les paliers : elle doit suivre les
 * durées choisies, sinon le 6ᵉ segment prétend valoir 15 s alors qu'il en
 * vaut 30. Chaque segment occupe sa part du temps total.
 */
function majSegmentsPaliers() {
  const total = durations[durations.length - 1];
  let precedent = 0;
  progressSegments.forEach((segment, idx) => {
    const part = ((durations[idx] - precedent) / total) * 100;
    segment.style.width = `${part}%`;
    segment.setAttribute('data-seconds', String(durations[idx]));
    precedent = durations[idx];
  });

  const note = document.getElementById('paliers-note');
  if (note) note.innerText = durations.map(formatSecondes).join(' · ');
}

function formatSecondes(v) {
  const arrondi = Math.round(v * 10) / 10;
  return `${String(arrondi).replace('.', ',')} s`;
}

/** Reflète les réglages sur les boutons segmentés du panneau d'options. */
function majBoutonsOptions() {
  const marquer = (selecteur, attribut, valeur) => {
    document.querySelectorAll(selecteur).forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute(attribut) === String(valeur));
    });
  };
  marquer('[data-answer]', 'data-answer', reglages.reponse);
  marquer('[data-speed]', 'data-speed', reglages.vitesse);
  marquer('[data-way]', 'data-way', reglages.sens);
  marquer('[data-start]', 'data-start', reglages.depart);
  marquer('[data-preset]', 'data-preset', reglages.preset);
  marquer('[data-fx]', 'data-fx', reglages.fx || 'none');

  const note = document.getElementById('answer-note');
  if (note) {
    if (reglages.reponse === 'annee') {
      const n = tracks.filter(t => t.year).length;
      note.innerText = `${n} morceau${n > 1 ? 'x' : ''} daté${n > 1 ? 's' : ''} sur ${tracks.length}`
        + ` · réponse acceptée à ${TOLERANCE_ANNEE} ans près`;
    } else if (reglages.reponse === 'artiste') {
      const n = tracks.filter(aUnArtiste).length;
      note.innerText = `${n} morceaux ont un artiste renseigné`;
    } else {
      note.innerText = '';
    }
  }
}

/** Le champ de réponse annonce ce qu'on attend de lui. */
function majPlaceholderReponse() {
  if (!guessInput) return;
  if (reglages.reponse === 'annee') {
    guessInput.placeholder = 'Année de sortie (ex. : 2016)';
    guessInput.setAttribute('inputmode', 'numeric');
  } else if (reglages.reponse === 'artiste') {
    guessInput.placeholder = "Nom de l'artiste...";
    guessInput.removeAttribute('inputmode');
  } else {
    guessInput.placeholder = 'Rechercher une chanson ou un artiste...';
    guessInput.removeAttribute('inputmode');
  }
}

function initOptionsEvents() {
  const panneau = document.getElementById('options-panel');
  const toggle = document.getElementById('toggle-options-btn');
  if (toggle && panneau) {
    toggle.addEventListener('click', () => panneau.classList.toggle('hidden'));
  }

  // Ce qu'il faut deviner : la playlist change (le mode « année » exclut les
  // morceaux non datés), donc la manche repart.
  document.querySelectorAll('[data-answer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-answer');
      if (mode === reglages.reponse) return;

      if (mode === 'annee' && tracks.filter(t => t.year).length < 5) {
        showToast('Trop peu de morceaux datés : lance « node tools/years.js » d\'abord.', 'warn');
        return;
      }
      reglages.reponse = mode;
      appliquerReglages({ relancer: true });
      showToast(mode === 'annee'
        ? 'Mode année : seuls les morceaux datés sont tirés.'
        : `Il faut maintenant deviner ${mode === 'artiste' ? "l'artiste" : 'le titre'}.`);
    });
  });

  document.querySelectorAll('[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      reglages.vitesse = parseFloat(btn.getAttribute('data-speed'));
      appliquerReglages();
      showToast(reglages.vitesse === 1
        ? 'Vitesse normale.'
        : `Extrait joué à ×${String(reglages.vitesse).replace('.', ',')}.`);
    });
  });

  document.querySelectorAll('[data-way]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sens = btn.getAttribute('data-way');
      if (sens === reglages.sens) return;
      reglages.sens = sens;
      appliquerReglages();
      oublierBuffers();
      if (currentTrack) preparerExtrait(currentTrack);
      showToast(sens === 'inverse' ? 'Extraits joués à l\'envers.' : 'Lecture remise à l\'endroit.');
    });
  });

  document.querySelectorAll('[data-start]').forEach(btn => {
    btn.addEventListener('click', () => {
      const depart = btn.getAttribute('data-start');
      if (depart === reglages.depart) return;
      reglages.depart = depart;
      appliquerReglages();
      // Le point de départ fait partie de la manche : la relancer est plus
      // honnête que de déplacer l'extrait sous les pieds du joueur.
      startNewGame();
      showToast(depart === 'refrain' ? 'Départ au passage le plus fort.'
        : depart === 'debut' ? 'Départ au tout début du morceau.'
        : 'Départ tiré par la seed.');
    });
  });

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      if (preset === 'perso') {
        ouvrirPaliersModal();
        return;
      }
      reglages.preset = preset;
      reglages.paliers = [...PALIERS_PRESETS[preset]];
      appliquerReglages();
      startNewGame();
      showToast(`Paliers ${preset} : ${durations.map(formatSecondes).join(' · ')}`);
    });
  });

  document.querySelectorAll('[data-fx]').forEach(btn => {
    btn.addEventListener('click', () => {
      reglages.fx = btn.getAttribute('data-fx') || 'none';
      appliquerReglages();
      connectAudioChain();
      const labels = {
        none: 'Son pur sans distorsion.',
        '8bit': 'Filtre 8-Bit Chiptune activé.',
        radio: 'Filtre Radio Vintage 1920 activé.',
        underwater: 'Filtre Sous l’Eau activé.',
        nightcore: 'Effet Nightcore survolté activé.',
        slowed: 'Effet Slowed + Reverb activé.',
        bass: 'Effet Bass Boost activé.',
      };
      showToast(labels[reglages.fx] || 'Filtre audio appliqué.');
    });
  });

  initPaliersModal();
}

// ---- Paliers sur mesure

function ouvrirPaliersModal() {
  const modal = document.getElementById('paliers-modal');
  const grille = document.getElementById('paliers-grid');
  if (!modal || !grille) return;

  grille.innerHTML = durations.map((d, i) => `
    <label class="palier-field">
      <span>Essai ${i + 1}</span>
      <input type="number" step="0.1" min="0.1" max="120" value="${d}" data-palier="${i}">
    </label>
  `).join('');

  document.getElementById('paliers-error').innerText = '';
  modal.classList.remove('hidden');
}

function initPaliersModal() {
  const modal = document.getElementById('paliers-modal');
  if (!modal) return;

  const fermer = () => {
    modal.classList.add('hidden');
    majBoutonsOptions();   // le bouton « Sur mesure… » ne reste pas allumé pour rien
  };

  document.getElementById('paliers-cancel-btn').addEventListener('click', fermer);
  modal.addEventListener('click', (e) => { if (e.target === modal) fermer(); });

  document.getElementById('paliers-save-btn').addEventListener('click', () => {
    const valeurs = [...modal.querySelectorAll('[data-palier]')].map(i => Number(i.value));
    const erreur = document.getElementById('paliers-error');

    if (valeurs.some(v => !isFinite(v) || v <= 0)) {
      erreur.innerText = 'Chaque palier doit être un nombre de secondes positif.';
      return;
    }
    for (let i = 1; i < valeurs.length; i++) {
      if (valeurs[i] <= valeurs[i - 1]) {
        erreur.innerText = `Le palier ${i + 1} doit être plus long que le précédent.`;
        return;
      }
    }

    reglages.paliers = valeurs;
    reglages.preset = 'perso';
    appliquerReglages();
    modal.classList.add('hidden');
    startNewGame();
    showToast(`Paliers sur mesure : ${durations.map(formatSecondes).join(' · ')}`);
  });
}

// ==========================================
// STATISTIQUES & LOCAL STORAGE
// ==========================================
// Deux portées tenues en parallèle :
//   all     — depuis toujours, dans localStorage (survit à tout)
//   session — depuis l'ouverture de Songless, dans sessionStorage : l'onglet
//             fermé, le compteur repart de zéro ; un simple F5 le conserve.
//
// Les deux portées sont propres au profil actif : « Joueur 1 » et « Joueur 2 »
// ne partagent ni leur série, ni leur taux de réussite.
const STATS_SCOPES = {
  all: { store: () => localStorage, cle: () => cleProfil('songless_stats') },
  session: { store: () => sessionStorage, cle: () => cleProfil('songless_stats_session') },
};
let statsScope = 'all';

/** Lit les statistiques brutes d'un profil, sans valeurs par défaut. null si vide. */
function lireStats(scope, profilId = null) {
  const def = STATS_SCOPES[scope] || STATS_SCOPES.all;
  const base = scope === 'session' ? 'songless_stats_session' : 'songless_stats';
  const cle = profilId ? `${base}:${profilId}` : def.cle();
  try {
    const raw = def.store().getItem(cle);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function emptyStats() {
  return {
    played: 0,
    wins: 0,
    abandons: 0,   // manches laissées en plan puis verrouillées en écoute seule
    streak: 0,
    maxStreak: 0,
    distribution: [0, 0, 0, 0, 0, 0],
    startedAt: new Date().toISOString(),
  };
}

function getStats(scope = statsScope) {
  const def = STATS_SCOPES[scope] || STATS_SCOPES.all;
  try {
    const raw = def.store().getItem(def.cle());
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw);
    // Une sauvegarde d'une version précédente peut être incomplète. Sans date
    // de départ connue, on n'en invente pas une : la légende l'omettra.
    return { ...emptyStats(), startedAt: null, ...parsed };
  } catch (e) {
    return emptyStats();
  }
}

function writeStats(scope, stats) {
  const def = STATS_SCOPES[scope];
  if (!def) return;
  try {
    def.store().setItem(def.cle(), JSON.stringify(stats));
  } catch (e) {
    console.warn(`Statistiques « ${scope} » non enregistrées :`, e.message);
  }
  if (scope === 'all' && window.songlessShared && window.songlessShared.ready && profilActif) {
    window.songlessShared.queueProfile(profilActif.id);
  }
}

/**
 * Enregistre une manche close dans les deux portées à la fois.
 * @param {boolean} isWin
 * @param {number|null} attempt   essai gagnant (1 à 6), pour l'histogramme
 * @param {boolean} abandon       manche laissée en plan plutôt que jouée au bout
 */
function saveStats(isWin, attempt = null, { abandon = false } = {}) {
  for (const scope of Object.keys(STATS_SCOPES)) {
    const stats = getStats(scope);

    stats.played += 1;
    if (abandon) stats.abandons = (stats.abandons || 0) + 1;
    if (isWin) {
      stats.wins += 1;
      stats.streak += 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      if (attempt >= 1 && attempt <= 6) {
        stats.distribution[attempt - 1] += 1;
      }
    } else {
      stats.streak = 0;
    }

    writeStats(scope, stats);
  }
  updateStatsDisplay();
}

// ==========================================
// HISTORIQUE DES MANCHES
// ==========================================
//
// Les compteurs globaux disent « 62 % de réussite » sans jamais dire sur quoi.
// On garde donc une ligne par manche close — genre, artiste, issue, essais —
// ce qui permet de répondre aux vraies questions : quels genres tu rates, quels
// artistes te tombent dessus sans que tu les reconnaisses.
//
// Le journal est plafonné : au-delà, les plus vieilles manches sortent. Une
// bibliothèque de 1 700 morceaux ne produira jamais assez de parties pour que
// la limite gêne, mais un stockage qui gonfle sans fin finit toujours mal.

const HISTORIQUE_MAX = 3000;

function chargerHistorique() {
  try {
    const brut = JSON.parse(localStorage.getItem(cleProfil('songless_historique')) || '[]');
    return Array.isArray(brut) ? brut : [];
  } catch (_) {
    return [];
  }
}

function ecrireHistorique(liste) {
  try {
    localStorage.setItem(cleProfil('songless_historique'),
      JSON.stringify(liste.slice(-HISTORIQUE_MAX)));
  } catch (_) { /* stockage plein : les tableaux détaillés s'arrêtent là */ }
  if (window.songlessShared && window.songlessShared.ready && profilActif) {
    window.songlessShared.queueProfile(profilActif.id);
  }
}

/**
 * Consigne une manche terminée.
 * @param {object} track   le morceau joué
 * @param {string} issue   'win' | 'lose' | 'abandon'
 * @param {number} essai   essai gagnant (1 à 6), null si perdu
 */
function noterManche(track, issue, essai) {
  if (!track) return;
  const liste = chargerHistorique();
  liste.push({
    id: track.id,
    titre: track.title,
    artiste: track.artist || '',
    genre: track.genre || 'Autre',
    annee: track.year || null,
    issue,
    essai: essai || null,
    // Le détail des essais sert à dessiner la grille du résumé partageable.
    essais: essaisDetail.map(e => e.type),
    mode: reglages.reponse,
    seed: currentSeed,
    ts: Date.now(),
  });
  ecrireHistorique(liste);
}

/** Les manches de la portée affichée (tout l'historique, ou la session en cours). */
function historiqueVisible() {
  const liste = chargerHistorique();
  if (statsScope !== 'session') return liste;

  const debut = Date.parse(getStats('session').startedAt || '');
  if (!isFinite(debut)) return liste;
  return liste.filter(m => m.ts >= debut);
}

/** Regroupe les manches par clé et calcule le taux de réussite de chaque groupe. */
function regrouper(manches, cle) {
  const table = new Map();
  for (const m of manches) {
    const k = cle(m);
    if (!k) continue;
    if (!table.has(k)) table.set(k, { cle: k, joues: 0, gagnes: 0 });
    const ligne = table.get(k);
    ligne.joues++;
    if (m.issue === 'win') ligne.gagnes++;
  }
  return [...table.values()];
}

function renderBreakdowns() {
  const manches = historiqueVisible();

  // --- Par genre : à partir de 3 manches, sinon un 0/1 malheureux passerait
  // pour une bête noire absolue.
  const zoneGenre = document.getElementById('genre-breakdown');
  if (zoneGenre) {
    const lignes = regrouper(manches, m => m.genre)
      .filter(l => l.joues >= 3)
      .sort((a, b) => (b.gagnes / b.joues) - (a.gagnes / a.joues) || b.joues - a.joues);

    zoneGenre.innerHTML = lignes.length
      ? lignes.map(l => ligneBreakdown(l.cle, l.gagnes, l.joues)).join('')
      : '<p class="empty-note">Pas encore assez de manches pour dire quoi que ce soit.</p>';
  }

  // --- Bêtes noires : les artistes les plus souvent ratés.
  const zoneArtiste = document.getElementById('artist-breakdown');
  if (zoneArtiste) {
    const lignes = regrouper(manches, m => m.artiste)
      .filter(l => l.joues >= 2 && l.gagnes < l.joues)
      .map(l => ({ ...l, rates: l.joues - l.gagnes }))
      .sort((a, b) => b.rates - a.rates || (a.gagnes / a.joues) - (b.gagnes / b.joues))
      .slice(0, 10);

    zoneArtiste.innerHTML = lignes.length
      ? lignes.map(l => ligneBreakdown(l.cle, l.gagnes, l.joues)).join('')
      : '<p class="empty-note">Aucun artiste ne te résiste pour l\'instant.</p>';
  }

  majApercuPartage();
}

function ligneBreakdown(nom, gagnes, joues) {
  const taux = Math.round((gagnes / joues) * 100);
  return `
    <div class="breakdown-row">
      <span class="breakdown-name" title="${escapeHtml(nom)}">${escapeHtml(nom)}</span>
      <div class="breakdown-bar-wrapper">
        <div class="breakdown-bar" style="width: ${Math.max(taux, 3)}%"></div>
      </div>
      <span class="breakdown-value">${taux}% <span class="breakdown-count">${gagnes}/${joues}</span></span>
    </div>
  `;
}

// ==========================================
// RÉSUMÉ PARTAGEABLE
// ==========================================
//
// Une grille d'emojis qui raconte la session sans dévoiler un seul titre :
// on peut l'envoyer à quelqu'un qui va jouer la même seed après toi.

const CASES = { success: '🟩', failed: '🟥', skipped: '🟨', vide: '⬜' };

function ligneGrille(manche) {
  const cases = [];
  for (let i = 0; i < durations.length; i++) {
    const type = manche.essais && manche.essais[i];
    cases.push(CASES[type] || CASES.vide);
  }
  return cases.join('');
}

/** Construit le texte à copier. Renvoie '' si la session n'a rien à raconter. */
function construireResume() {
  // Toujours la session en cours : un résumé « depuis toujours » ne se partage
  // pas, il ne correspond à aucune partie précise.
  const debut = Date.parse(getStats('session').startedAt || '');
  const manches = chargerHistorique()
    .filter(m => (!isFinite(debut) || m.ts >= debut) && m.seed === currentSeed);

  if (manches.length === 0) return '';

  const gagnes = manches.filter(m => m.issue === 'win').length;
  const essaisMoyens = gagnes
    ? (manches.filter(m => m.issue === 'win').reduce((s, m) => s + (m.essai || 0), 0) / gagnes)
    : 0;

  const entete = [
    `🎵 Songless — seed ${formatSeed(currentSeed)}`,
    `${manches.length} morceau${manches.length > 1 ? 'x' : ''} · ${gagnes} trouvé${gagnes > 1 ? 's' : ''}`
      + (gagnes ? ` · ${essaisMoyens.toFixed(1)} essais en moyenne` : ''),
  ];

  const reponse = { titre: 'titre', artiste: 'artiste', annee: 'année' }[reglages.reponse];
  const epices = [];
  if (reglages.reponse !== 'titre') epices.push(`deviner l'${reponse}`);
  if (reglages.vitesse !== 1) epices.push(`×${String(reglages.vitesse).replace('.', ',')}`);
  if (reglages.sens === 'inverse') epices.push('à l\'envers');
  if (reglages.depart !== 'seed') epices.push(reglages.depart === 'refrain' ? 'départ refrain' : 'départ 0:00');
  if (reglages.preset !== 'normal') epices.push(`paliers ${reglages.preset}`);
  if (epices.length) entete.push(`⚙ ${epices.join(' · ')}`);

  // Les 20 dernières manches suffisent : au-delà, personne ne lit.
  const grille = manches.slice(-20).map(ligneGrille);

  return [...entete, '', ...grille].join('\n');
}

function majApercuPartage() {
  const zone = document.getElementById('share-preview');
  if (!zone) return;
  const texte = construireResume();
  zone.innerText = texte || 'Aucune manche terminée sur cette seed pour l\'instant.';
}

function partagerResume() {
  const texte = construireResume();
  if (!texte) {
    showToast('Termine au moins une manche avant de partager.', 'warn');
    return;
  }
  const complet = `${texte}\n${location.origin}${location.pathname}?seed=${currentSeed}`;

  navigator.clipboard.writeText(complet)
    .then(() => showToast('Résumé copié : plus qu\'à le coller.', 'ok'))
    .catch(() => {
      // Le presse-papier est refusé hors HTTPS sur certains navigateurs :
      // plutôt que d'échouer en silence, on met le texte sous les yeux.
      const zone = document.getElementById('share-preview');
      if (zone) zone.innerText = complet;
      showToast('Copie refusée par le navigateur : le résumé est affiché dans l\'onglet Statistiques.', 'warn');
    });
}

function initStatsEvents() {
  const partager = document.getElementById('share-btn');
  if (partager) partager.addEventListener('click', partagerResume);

  const copier = document.getElementById('share-copy-btn');
  if (copier) copier.addEventListener('click', partagerResume);

  document.querySelectorAll('.scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      statsScope = btn.getAttribute('data-scope');
      document.querySelectorAll('.scope-btn').forEach(b =>
        b.classList.toggle('active', b === btn));
      updateStatsDisplay();
    });
  });
}

function formatSince(iso) {
  // Attention : new Date(null) vaut le 1er janvier 1970, pas une date invalide.
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const memeJour = d.toDateString() === new Date().toDateString();
  if (memeJour) return `depuis ${heure}`;
  return `depuis le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

function updateStatsDisplay() {
  const stats = getStats();

  // Légende et libellé du bouton de remise à zéro, selon la portée affichée
  const caption = document.getElementById('stats-scope-caption');
  if (caption) {
    const depuis = formatSince(stats.startedAt);
    const base = statsScope === 'session' ? 'Session en cours' : 'Toutes tes parties';
    caption.innerText = depuis ? `${base}, ${depuis}` : base;
  }
  const resetLabel = document.getElementById('reset-stats-label');
  if (resetLabel) {
    resetLabel.innerText = statsScope === 'session'
      ? 'Réinitialiser cette session'
      : 'Réinitialiser tout mon historique';
  }

  statsPlayed.innerText = stats.played;
  const winRate = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0;
  statsWinrate.innerText = `${winRate}%`;

  const abandonsEl = document.getElementById('stats-abandons');
  if (abandonsEl) {
    const a = stats.abandons || 0;
    abandonsEl.innerText = a ? `dont ${a} abandon${a > 1 ? 's' : ''}` : '';
    abandonsEl.classList.toggle('hidden', a === 0);
  }

  statsStreak.innerText = stats.streak;
  statsMaxStreak.innerText = stats.maxStreak;
  
  // Trouver le max pour l'échelle des barres
  const maxDist = Math.max(...stats.distribution, 1);
  
  // Générer les barres
  const chartHtml = stats.distribution.map((val, idx) => {
    const percent = (val / maxDist) * 100;
    // Mettre en valeur l'essai actuel si le joueur vient de gagner
    const isHighlight = !resultCard.classList.contains('hidden') && 
                         attempts.includes('success') && 
                         (currentAttempt === idx);
                         
    return `
      <div class="dist-row">
        <span class="dist-num">${idx + 1}</span>
        <div class="dist-bar-wrapper">
          <div class="dist-bar${isHighlight ? ' highlight' : ''}" style="width: ${Math.max(percent, 8)}%">
            ${val}
          </div>
        </div>
      </div>
    `;
  }).join('');

  distributionChart.innerHTML = chartHtml;

  renderBreakdowns();
}

// Bouton reset : n'efface que la portée affichée
resetStatsBtn.addEventListener('click', () => {
  const estSession = statsScope === 'session';
  const question = estSession
    ? 'Remettre à zéro les statistiques de cette session ? Ton historique complet est conservé.'
    : 'Effacer tout ton historique de statistiques ? Cette action est irréversible.';

  if (!confirm(question)) return;

  const def = STATS_SCOPES[statsScope];
  try {
    def.store().removeItem(def.cle());
  } catch (e) {
    console.warn('Effacement impossible :', e.message);
  }
  if (estSession) {
    writeStats('session', emptyStats());   // nouvelle session, datée de maintenant
  } else {
    // L'historique détaillé nourrit les tableaux par genre et par artiste :
    // le garder après un effacement rendrait les deux incohérents.
    try { localStorage.removeItem(cleProfil('songless_historique')); } catch (_) {}
  }

  updateStatsDisplay();
  showToast(estSession ? 'Session remise à zéro.' : 'Historique effacé.');
});

// ==========================================
// SEED DE SESSION
// ------------------------------------------
// Une seed = un ordre de passage précis. Elle est tirée au hasard à chaque
// lancement, et le bouton "Nouvelle seed" en tire une autre. Rejouer la même
// seed rejoue exactement la même suite de morceaux, extraits compris.
// ==========================================

// Alphabet sans caractères ambigus (pas de 0/O ni de 1/I) : une seed se relit.
const SEED_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const SEED_LENGTH = 8;

/** Hachage d'une chaîne quelconque vers un entier 32 bits. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** Générateur pseudo-aléatoire déterministe : même graine, même suite. */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Générateur amorcé par une chaîne (la seed, ou seed + identifiant de morceau). */
function rngFrom(str) {
  return mulberry32(xmur3(String(str))());
}

/** Tire une seed au hasard, avec l'aléatoire cryptographique du navigateur. */
function randomSeed() {
  const bytes = new Uint8Array(SEED_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => SEED_ALPHABET[b % SEED_ALPHABET.length]).join('');
}

/** Nettoie une seed saisie à la main. */
function normalizeSeed(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

/** Mélange déterministe (Fisher-Yates) piloté par le générateur fourni. */
function seededShuffle(array, rand) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function initSeed() {
  // Une seed passée dans l'URL est volontaire (lien partagé) : elle gagne.
  const fromUrl = normalizeSeed(new URLSearchParams(location.search).get('seed'));
  currentSeed = fromUrl || randomSeed();
  playlistIndex = fromUrl ? loadSessionPosition(currentSeed) : 0;
  chargerManches();
  updateSessionUI();
}

/** Position mémorisée le temps de l'onglet, pour ne pas la perdre en changeant de genre. */
function saveSessionPosition() {
  try {
    sessionStorage.setItem('songless_session', JSON.stringify({ seed: currentSeed, index: playlistIndex }));
  } catch (_) { /* stockage indisponible : sans conséquence */ }
}

function loadSessionPosition(seed) {
  try {
    const raw = JSON.parse(sessionStorage.getItem('songless_session') || '{}');
    return raw.seed === seed ? (raw.index || 0) : 0;
  } catch (_) {
    return 0;
  }
}

// ==========================================
// MÉMOIRE DES MANCHES — survit au rechargement
// ==========================================
//
// La Map vivait en RAM : un F5 sur un lien `?seed=XXXX` restituait la position
// dans la playlist mais oubliait les essais déjà consommés, et rendait six
// essais neufs sur la chanson où l'on séchait. On la range donc à côté de la
// position, indexée par seed — changer de seed la périme naturellement.

const CLE_MANCHES = 'songless_manches';

function sauverManches() {
  try {
    sessionStorage.setItem(CLE_MANCHES, JSON.stringify({
      seed: currentSeed,
      manches: Object.fromEntries(manches),
    }));
  } catch (_) { /* stockage plein ou indisponible : l'anti-triche reste en RAM */ }
}

function chargerManches() {
  manches.clear();
  try {
    const raw = JSON.parse(sessionStorage.getItem(CLE_MANCHES) || '{}');
    if (raw.seed !== currentSeed || !raw.manches) return;
    for (const [id, etat] of Object.entries(raw.manches)) {
      // On se méfie d'un stockage bricolé à la main : sans essais exploitables,
      // l'entrée est ignorée plutôt que de casser l'affichage.
      if (etat && Array.isArray(etat.essais)) manches.set(id, etat);
    }
  } catch (_) { /* illisible : on repart d'une mémoire vide */ }
}

/** Applique une nouvelle seed : nouvel ordre, retour au premier morceau. */
function applySeed(seed, { silent = false } = {}) {
  currentSeed = seed;
  playlistIndex = 0;
  // Nouvelle seed = nouvelle partie : ordre et extraits changent, la mémoire
  // des manches précédentes n'a plus de sens.
  manches.clear();
  sauverManches();
  saveSessionPosition();
  rebuildPlaylist({ keepCurrent: false });
  updateSessionUI();
  if (playlist.length > 0) startNewGame();
  if (!silent) showToast(`Nouvelle seed : ${formatSeed(seed)}`);
}

/**
 * Recalcule l'ordre de passage.
 * Le mélange porte sur toute la bibliothèque, le filtre de genre s'applique
 * ensuite : cocher/décocher un genre ne rebat donc pas les cartes.
 */
function rebuildPlaylist({ keepCurrent = true } = {}) {
  const base = [...tracks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shuffled = seededShuffle(base, rngFrom(currentSeed));

  playlist = shuffled.filter(t => {
    if (activeGenres.size > 0 && !activeGenres.has(t.genre || 'Autre')) return false;
    if (activeDecades.size > 0 && !activeDecades.has(decennieDe(t))) return false;
    // Un morceau sans artiste n'est pas jouable en mode « Deviner l'artiste »,
    // et un morceau sans année n'a pas de réponse en mode « Deviner l'année ».
    if (reglages.reponse === 'artiste' && !aUnArtiste(t)) return false;
    if (reglages.reponse === 'annee' && !t.year) return false;
    return true;
  });

  if (window.songlessExpansions) {
    playlist = window.songlessExpansions.filterPlaylist(playlist);
  }

  if (keepCurrent && currentTrack) {
    const pos = playlist.findIndex(t => t.id === currentTrack.id);
    if (pos !== -1) playlistIndex = pos;
    else if (playlistIndex >= playlist.length) playlistIndex = 0;
  } else if (playlistIndex >= playlist.length) {
    playlistIndex = 0;
  }

  updateSessionUI();
}

/**
 * Point de départ de l'extrait dans le morceau.
 * Dérivé de la seed ET du morceau : une même seed rejoue le même passage.
 */
function offsetForTrack(track, graine = currentSeed) {
  if (!track || !track.duration || track.duration <= 40) return 0;
  const rand = rngFrom(`${graine}|${track.id}`);
  return Math.floor(rand() * (track.duration - 40)) + 20;
}

function formatSeed(seed) {
  return String(seed).replace(/(.{4})(?=.)/g, '$1-');
}

function updateSessionUI() {
  if (seedValue) seedValue.innerText = formatSeed(currentSeed);
  if (playlistPosition) playlistPosition.innerText = playlist.length ? playlistIndex + 1 : 0;
  if (playlistTotal) playlistTotal.innerText = playlist.length;
}

function initSessionEvents() {
  newSeedBtn.addEventListener('click', () => {
    applySeed(randomSeed());
    // La seed tirée ici n'est pas celle de l'URL : on nettoie le lien.
    history.replaceState(null, '', location.pathname);
  });

  copySeedBtn.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?seed=${currentSeed}`;
    navigator.clipboard.writeText(url)
      .then(() => showToast('Lien de la seed copié.'))
      .catch(() => showToast(`Seed : ${formatSeed(currentSeed)}`));
  });

  editSeedBtn.addEventListener('click', () => {
    const input = prompt('Seed à rejouer :', currentSeed);
    if (input === null) return;
    const seed = normalizeSeed(input);
    if (!seed) {
      showToast('Seed invalide.', 'error');
      return;
    }
    applySeed(seed, { silent: true });
    history.replaceState(null, '', `${location.pathname}?seed=${seed}`);
    showToast(`Seed appliquée : ${formatSeed(seed)}`);
  });

  toggleGenresBtn.addEventListener('click', () => {
    genrePanel.classList.toggle('hidden');
  });

  document.getElementById('genre-all-btn').addEventListener('click', () => {
    allGenres.forEach(g => activeGenres.add(g.name));
    refreshGenreSelection();
  });

  document.getElementById('genre-none-btn').addEventListener('click', () => {
    activeGenres.clear();
    refreshGenreSelection();
  });

  const decadeNone = document.getElementById('decade-none-btn');
  if (decadeNone) {
    decadeNone.addEventListener('click', () => {
      activeDecades.clear();
      refreshDecadeSelection();
    });
  }
}

// ==========================================
// CONTEXTE : MACHINE HÔTE OU APPAREIL DU RÉSEAU
// ==========================================
//
// Depuis un téléphone, on joue mais on ne touche pas à la bibliothèque : le
// serveur refuse toute écriture venue du réseau. Plutôt que de laisser le
// joueur découvrir l'interdit en cliquant, on retire ce qui ne marchera pas.

function initContexte() {
  const requete = window.songlessShared
    ? window.songlessShared.api('/api/context')
    : fetch('/api/context').then(r => r.json());
  requete
    .then(info => {
      contexte = info;
      if (info.readOnly) {
        document.body.classList.add('lecture-seule');
        if (info.canAdd) document.body.classList.add('ajout-distance');
        const banniere = document.getElementById('readonly-banner');
        if (banniere) {
          banniere.innerHTML = info.canAdd
            ? '<i data-lucide="shield-check"></i> Téléphone appairé : tu peux jouer et proposer des musiques. Suppression et édition restent sur l’ordinateur.'
            : '<i data-lucide="lock"></i> Téléphone non appairé : jeu uniquement.';
          banniere.classList.remove('hidden');
        }
        dessinerIcones();
      }
    })
    .catch(() => { /* vieille version du serveur : on ne bride rien */ });

  initPhoneModal();
}

function initPhoneModal() {
  const btn = document.getElementById('phone-btn');
  const modal = document.getElementById('phone-modal');
  if (!btn || !modal) return;

  const fermer = () => modal.classList.add('hidden');
  document.getElementById('phone-close-btn').addEventListener('click', fermer);
  modal.addEventListener('click', (e) => { if (e.target === modal) fermer(); });

  btn.addEventListener('click', () => {
    const zone = document.getElementById('phone-content');
    const urls = (contexte.urls && contexte.urls.length > 0)
      ? contexte.urls
      : (contexte.url ? [contexte.url] : []);
    const listeUrls = urls
      .map((url, index) => `
        <p class="share-preview">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(url)}
          </a>
        </p>`)
      .join('');

    if (!contexte.lan) {
      zone.innerHTML = `
        <p class="modal-file">
          Songless n'écoute que cet ordinateur. Pour jouer depuis le téléphone,
          relance-le en mode réseau :
        </p>
        <pre class="share-preview">node server.js --lan</pre>
        <p class="modal-file">
          Le téléphone doit être sur le même wifi. Les appareils appairés
          servent uniquement de télécommandes pour une soirée multijoueur.
        </p>`;
    } else if (!contexte.url) {
      zone.innerHTML = `
        <p class="modal-file">
          Mode réseau actif, mais aucune adresse IPv4 n'a été détectée sur cette
          machine : vérifie que le wifi ou le câble est bien connecté.
        </p>`;
    } else {
      zone.innerHTML = `
        <p class="modal-file">Scanne ce code avec l'appareil photo du téléphone :</p>
        <div class="qr-wrapper"><img src="/api/lan/qr.svg" alt="QR code de l'adresse locale"></div>
        ${listeUrls}
        <p class="modal-file">
          Même wifi obligatoire. Chaque téléphone choisit son profil à chaque
          ouverture, rejoint le code affiché dans « Modes », puis répond ou
          buzze. Il peut aussi offrir une musique ; seul le PC contrôle le jeu.
        </p>`;
    }

    modal.classList.remove('hidden');
    dessinerIcones();
  });
}

// ==========================================
// FILTRE PAR GENRE
// ==========================================
const knownGenres = new Set();

function renderGenreChips() {
  if (!genreChips) return;

  // Tout nouveau genre (après un téléchargement) est actif par défaut.
  for (const g of allGenres) {
    if (!knownGenres.has(g.name)) {
      knownGenres.add(g.name);
      activeGenres.add(g.name);
    }
  }

  genreChips.innerHTML = '';
  for (const g of allGenres) {
    const chip = document.createElement('button');
    chip.className = `genre-chip${activeGenres.has(g.name) ? ' active' : ''}`;
    chip.innerHTML = `${escapeHtml(g.name)} <span class="chip-count">${g.count}</span>`;
    chip.addEventListener('click', () => {
      if (activeGenres.has(g.name)) activeGenres.delete(g.name);
      else activeGenres.add(g.name);
      refreshGenreSelection();
    });
    genreChips.appendChild(chip);
  }
  updateGenreSummary();
}

function refreshGenreSelection() {
  renderGenreChips();
  const before = currentTrack;
  rebuildPlaylist({ keepCurrent: true });

  if (playlist.length === 0) {
    showToast('Aucun morceau dans cette sélection de genres.', 'warn');
    return;
  }
  // Si le morceau en cours ne fait plus partie de la sélection, on enchaîne.
  if (!before || !playlist.some(t => t.id === before.id)) startNewGame();
}

function updateGenreSummary() {
  if (!genreSummary) return;
  const total = allGenres.length;
  const n = activeGenres.size;
  genreSummary.innerText = (n === 0) ? 'aucun' : (n >= total ? 'tous' : `${n} sur ${total}`);
}

// ==========================================
// FILTRE PAR DÉCENNIE
// ==========================================
//
// Attention à ce que promet ce filtre : l'année de sortie n'est connue que
// pour une partie de la bibliothèque, et le téléchargeur la déduit parfois de
// la date de mise en ligne de la vidéo. Le compte des morceaux datés est donc
// affiché en clair sous les pastilles, et « sans année » est un lot comme un
// autre plutôt qu'un oubli silencieux.

/** Clé de décennie d'un morceau : « 1990 », « 2020 »… ou « ? » sans année. */
function decennieDe(track) {
  if (!track || !track.year) return '?';
  return String(Math.floor(track.year / 10) * 10);
}

function renderDecadeChips() {
  const zone = document.getElementById('decade-chips');
  if (!zone) return;

  const compte = new Map();
  for (const t of tracks) {
    const k = decennieDe(t);
    compte.set(k, (compte.get(k) || 0) + 1);
  }

  allDecades = [...compte.entries()]
    .filter(([k]) => k !== '?')
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, count]) => ({ key, label: `${key}s`, count }));

  if (compte.has('?')) {
    allDecades.push({ key: '?', label: 'Sans année', count: compte.get('?') });
  }

  zone.innerHTML = '';
  for (const d of allDecades) {
    const chip = document.createElement('button');
    chip.className = `genre-chip${activeDecades.has(d.key) ? ' active' : ''}`;
    chip.innerHTML = `${escapeHtml(d.label)} <span class="chip-count">${d.count}</span>`;
    chip.addEventListener('click', () => {
      if (activeDecades.has(d.key)) activeDecades.delete(d.key);
      else activeDecades.add(d.key);
      refreshDecadeSelection();
    });
    zone.appendChild(chip);
  }

  const note = document.getElementById('decade-note');
  if (note) {
    const dates = tracks.filter(t => t.year).length;
    note.innerText = dates === 0
      ? 'aucune année connue — lance node tools/years.js'
      : `${dates} morceaux datés sur ${tracks.length}`;
  }
}

function refreshDecadeSelection() {
  renderDecadeChips();
  const avant = currentTrack;
  rebuildPlaylist({ keepCurrent: true });

  if (playlist.length === 0) {
    showToast('Aucun morceau dans cette sélection.', 'warn');
    return;
  }
  if (!avant || !playlist.some(t => t.id === avant.id)) startNewGame();
}

/** Remplit les menus déroulants de genre (téléchargement, édition, bibliothèque). */
function renderGenreSelects() {
  const canonical = (window.__songlessGenres || []);
  const names = canonical.length ? canonical : allGenres.map(g => g.name);

  const optionsGenres = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

  if (downloadGenre) {
    const keep = downloadGenre.value;
    downloadGenre.innerHTML = `<option value="">Genre : auto</option>${optionsGenres}`;
    downloadGenre.value = keep;
  }

  const playlistGenre = document.getElementById('playlist-genre');
  if (playlistGenre) {
    const keep = playlistGenre.value;
    playlistGenre.innerHTML = `<option value="">Genre : auto</option>${optionsGenres}`;
    playlistGenre.value = keep;
  }

  const editGenre = document.getElementById('edit-genre');
  if (editGenre) {
    editGenre.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  }

  if (libraryGenreFilter) {
    const keep = libraryGenreFilter.value;
    libraryGenreFilter.innerHTML = '<option value="">Tous les genres</option>'
      + allGenres.map(g => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} (${g.count})</option>`).join('');
    libraryGenreFilter.value = keep;
  }
}

// ==========================================
// TÉLÉCHARGEMENT AUTOMATIQUE
// ==========================================
function initDownloadEvents() {
  if (!downloadBtn) return;

  initDownloadApprovalPolling();

  // On mémorise la liste canonique des genres pour les menus déroulants.
  fetch('/api/genres')
    .then(r => r.json())
    .then(d => { window.__songlessGenres = d.all || []; renderGenreSelects(); })
    .catch(() => {});

  // État des outils externes : autant le dire tout de suite si ffmpeg manque.
  fetch('/api/download/status')
    .then(r => r.json())
    .then(state => {
      if (!toolsState) return;
      if (state.ok) {
        toolsState.innerHTML = '<span class="ok">yt-dlp + ffmpeg prêts</span>';
      } else {
        toolsState.innerHTML = `<span class="ko">manquant : ${escapeHtml(state.missing.join(', '))}</span>`;
        downloadBtn.disabled = true;
      }
    })
    .catch(() => {});

  downloadBtn.addEventListener('click', startDownload);
  downloadQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startDownload();
  });

  if (libraryGenreFilter) {
    libraryGenreFilter.addEventListener('change', filterLibraryDisplay);
  }
}

let downloadApprovalBusy = false;
const handledDownloadApprovals = new Set();

/**
 * Affiche sur le PC les demandes de grosses compilations venues des
 * téléphones. Le serveur ne donne cette route qu'à l'hôte local.
 */
function initDownloadApprovalPolling() {
  const poll = async () => {
    if (downloadApprovalBusy || document.hidden) return;
    try {
      const response = await fetch('/api/download/approvals', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const approval = (data.pending || []).find(item => !handledDownloadApprovals.has(item.id));
      if (!approval) return;

      downloadApprovalBusy = true;
      const capped = approval.sourceCount > approval.count
        ? `\nLa vidéo en contient ${approval.sourceCount}, le plafond est ${approval.count}.`
        : '';
      const accepted = confirm(
        `Un téléphone propose « ${approval.title} » (${approval.sourceCount} morceaux).`
        + `${capped}\n\nOK : importer jusqu'à ${approval.count} morceaux.`
        + '\nAnnuler : importer seulement les 30 premiers.'
      );
      const decisionResponse = await fetch(`/api/download/approvals/${encodeURIComponent(approval.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted }),
      });
      if (!decisionResponse.ok) throw new Error('Décision non transmise');
      handledDownloadApprovals.add(approval.id);
      showToast(accepted
        ? `Import de ${approval.count} morceaux autorisé.`
        : 'Import limité aux 30 premiers morceaux.', accepted ? 'ok' : 'warn');
    } catch (_) {
      // Le prochain passage retentera si le serveur ou la page se reconnecte.
    } finally {
      downloadApprovalBusy = false;
    }
  };

  poll();
  setInterval(poll, 2000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
}

function logDownload(message, type = '') {
  downloadLog.classList.remove('hidden');
  const line = document.createElement('div');
  line.className = `download-line${type ? ' ' + type : ''}`;
  line.innerText = message;
  downloadLog.appendChild(line);
  downloadLog.scrollTop = downloadLog.scrollHeight;
}

async function startDownload() {
  const query = downloadQuery.value.trim();
  if (!query) {
    showToast('Indique un titre de musique ou une URL.', 'warn');
    return;
  }

  downloadBtn.disabled = true;
  downloadLog.innerHTML = '';
  logDownload(`« ${query} »`);

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: window.songlessShared
        ? window.songlessShared.pairHeaders({ 'Content-Type': 'application/json' })
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        genre: downloadGenre.value || null,
        title: downloadTitle.value.trim() || null,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logDownload(err.error || `Erreur ${res.status}`, 'ko');
      return;
    }

    // Flux d'événements : on suit la progression ligne par ligne.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop();
      for (const block of blocks) handleDownloadEvent(block);
    }
  } catch (e) {
    logDownload(`Échec : ${e.message}`, 'ko');
  } finally {
    downloadBtn.disabled = false;
  }
}

function handleDownloadEvent(block) {
  const eventMatch = block.match(/^event:\s*(.+)$/m);
  const dataMatch = block.match(/^data:\s*(.+)$/m);
  if (!eventMatch || !dataMatch) return;

  let data;
  try {
    data = JSON.parse(dataMatch[1]);
  } catch (_) {
    return;
  }

  if (eventMatch[1] === 'progress') {
    logDownload(data.message);
  } else if (eventMatch[1] === 'list' && data.compilation) {
    logDownload(`Compilation détectée : ${data.total} chapitres à rechercher séparément.`);
    if (data.tronquee) {
      logDownload(`Import limité aux ${data.limite} premiers morceaux sur cet appareil.`, 'warn');
    }
  } else if (eventMatch[1] === 'item') {
    if (data.etat === 'en-cours') {
      logDownload(`${data.index}/${data.total} · recherche de « ${data.titre} »`);
    } else if (data.etat === 'ajoute') {
      logDownload(`✓ ${data.titre}${data.genre ? `  [${data.genre}]` : ''}`, 'ok');
    } else if (data.etat === 'doublon') {
      logDownload(`= déjà présent : ${data.titre}`);
    } else if (data.etat === 'erreur') {
      logDownload(`✗ ${data.titre} : ${data.erreur}`, 'ko');
    }
  } else if (eventMatch[1] === 'error') {
    logDownload(data.error, 'ko');
    showToast('Téléchargement échoué.', 'error');
  } else if (eventMatch[1] === 'done') {
    if (data.compilation) {
      const added = (data.ajoutes || []).length;
      const duplicates = (data.doublons || []).length;
      const errors = (data.erreurs || []).length;
      logDownload(`Terminé : ${added} ajouté${added > 1 ? 's' : ''}, ${duplicates} déjà présent${duplicates > 1 ? 's' : ''}, ${errors} en échec.`, added ? 'ok' : '');
      showToast(added ? `${added} morceau${added > 1 ? 'x' : ''} ajouté${added > 1 ? 's' : ''}.` : 'Aucun nouveau morceau ajouté.', added ? 'ok' : 'info');
      downloadQuery.value = '';
      downloadTitle.value = '';
      loadLibrary();
      return;
    }
    const t = data.track || {};
    if (t.alreadyPresent) {
      logDownload('Ce morceau est déjà dans la bibliothèque.', 'ok');
    } else {
      logDownload(`✓ ${t.title}${t.artist ? ' — ' + t.artist : ''}  [${t.genre}]`, 'ok');
      if (t.needsReview) {
        logDownload('⚠ Titre en alphabet non latin : donne-lui son nom connu (crayon dans la liste).', 'warn');
      }
      showToast(`« ${t.title} » ajouté.`, 'ok');
      downloadQuery.value = '';
      downloadTitle.value = '';
    }
    loadLibrary();
  }
}

// ==========================================
// IMPORT D'UNE PLAYLIST
// ==========================================
//
// Même chemin que l'ajout à l'unité, en boucle : c'est le serveur qui
// enchaîne, et qui rend compte titre par titre. Un morceau introuvable ou
// bloqué n'arrête pas les autres.

let importEnCours = false;

function initPlaylistEvents() {
  const btn = document.getElementById('playlist-btn');
  if (!btn) return;

  btn.addEventListener('click', lancerImportPlaylist);
  document.getElementById('playlist-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lancerImportPlaylist();
  });
}

function journalPlaylist(message, type = '') {
  const zone = document.getElementById('playlist-log');
  zone.classList.remove('hidden');
  const ligne = document.createElement('div');
  ligne.className = `download-line${type ? ' ' + type : ''}`;
  ligne.innerText = message;
  zone.appendChild(ligne);
  zone.scrollTop = zone.scrollHeight;
}

function majProgressionPlaylist(fait, total) {
  const barre = document.getElementById('playlist-progress');
  const rempli = document.getElementById('playlist-progress-fill');
  const texte = document.getElementById('playlist-progress-text');
  if (!barre) return;

  barre.classList.remove('hidden');
  const pourcent = total ? Math.round((fait / total) * 100) : 0;
  rempli.style.width = `${pourcent}%`;
  texte.innerText = `${fait} / ${total}`;
}

async function lancerImportPlaylist() {
  if (importEnCours) return;

  const url = document.getElementById('playlist-url').value.trim();
  if (!url) {
    showToast('Colle l\'adresse d\'une playlist.', 'warn');
    return;
  }

  const btn = document.getElementById('playlist-btn');
  const zone = document.getElementById('playlist-log');
  zone.innerHTML = '';
  importEnCours = true;
  btn.disabled = true;

  try {
    const res = await fetch('/api/download/playlist', {
      method: 'POST',
      headers: window.songlessShared
        ? window.songlessShared.pairHeaders({ 'Content-Type': 'application/json' })
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        genre: document.getElementById('playlist-genre').value || null,
        limite: Number(document.getElementById('playlist-limit').value) || 50,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      journalPlaylist(err.error || `Erreur ${res.status}`, 'ko');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let tampon = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      tampon += decoder.decode(value, { stream: true });

      const blocs = tampon.split('\n\n');
      tampon = blocs.pop();
      for (const bloc of blocs) traiterEvenementPlaylist(bloc);
    }
  } catch (e) {
    journalPlaylist(`Échec : ${e.message}`, 'ko');
  } finally {
    importEnCours = false;
    btn.disabled = false;
  }
}

function traiterEvenementPlaylist(bloc) {
  const nom = bloc.match(/^event:\s*(.+)$/m);
  const brut = bloc.match(/^data:\s*(.+)$/m);
  if (!nom || !brut) return;

  let data;
  try {
    data = JSON.parse(brut[1]);
  } catch (_) {
    return;
  }

  if (nom[1] === 'list') {
    journalPlaylist(`« ${data.titre || 'playlist'} » : ${data.total} titres à traiter.`);
    if (data.tronquee) {
      journalPlaylist('La playlist est plus longue que le plafond demandé : seuls les premiers titres sont pris.', 'warn');
    }
    majProgressionPlaylist(0, data.total);
    return;
  }

  if (nom[1] === 'item') {
    majProgressionPlaylist(data.index, data.total);
    if (data.etat === 'ajoute') {
      journalPlaylist(`✓ ${data.titre}${data.genre ? `  [${data.genre}]` : ''}`, 'ok');
    } else if (data.etat === 'doublon') {
      journalPlaylist(`= déjà présent : ${data.titre}`);
    } else if (data.etat === 'erreur') {
      journalPlaylist(`✗ ${data.titre} : ${data.erreur}`, 'ko');
    }
    return;
  }

  if (nom[1] === 'error') {
    journalPlaylist(data.error, 'ko');
    showToast('Import de playlist échoué.', 'error');
    return;
  }

  if (nom[1] === 'done') {
    const a = (data.ajoutes || []).length;
    const d = (data.doublons || []).length;
    const e = (data.erreurs || []).length;
    journalPlaylist(`Terminé : ${a} ajouté${a > 1 ? 's' : ''}, ${d} déjà présent${d > 1 ? 's' : ''}, ${e} en échec.`,
      a ? 'ok' : '');
    showToast(a ? `${a} morceau${a > 1 ? 'x' : ''} ajouté${a > 1 ? 's' : ''}.` : 'Rien de nouveau dans cette playlist.',
      a ? 'ok' : 'info');
    loadLibrary();
  }
}

// ==========================================
// DIAGNOSTIC DE LA BIBLIOTHÈQUE
// ==========================================

const LIBELLES_PROBLEMES = {
  illisible: 'Fichiers illisibles',
  muet: 'Fichiers muets',
  'intro-silencieuse': 'Longs silences en intro',
  'duree-inconnue': 'Durée inconnue',
  'trop-court': 'Morceaux trop courts',
  'trop-long': 'Morceaux trop longs',
  'titre-douteux': 'Titres indevinables',
  'a-renommer': 'Titres à renommer',
  doublon: 'Doublons probables',
  orphelin: 'Fiches sans fichier',
  'sans-fiche': 'Fichiers sans fiche',
  'sans-artiste': 'Sans artiste',
  'sans-genre': 'Sans genre',
  'sans-annee': 'Sans année',
  'ffmpeg-absent': 'Analyse audio impossible',
};

let diagnosticEnCours = false;

function initHealthEvents() {
  const btn = document.getElementById('health-btn');
  if (!btn) return;
  btn.addEventListener('click', lancerDiagnostic);
}

async function lancerDiagnostic() {
  if (diagnosticEnCours) return;

  const btn = document.getElementById('health-btn');
  const deep = document.getElementById('health-deep').checked;
  const progression = document.getElementById('health-progress');
  const rapport = document.getElementById('health-report');

  diagnosticEnCours = true;
  btn.disabled = true;
  rapport.classList.add('hidden');
  progression.classList.remove('hidden');
  progression.innerText = 'Analyse en cours…';

  try {
    const res = await fetch(`/api/library/health${deep ? '?deep=1' : ''}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let tampon = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      tampon += decoder.decode(value, { stream: true });

      const blocs = tampon.split('\n\n');
      tampon = blocs.pop();
      for (const bloc of blocs) {
        const nom = bloc.match(/^event:\s*(.+)$/m);
        const brut = bloc.match(/^data:\s*(.+)$/m);
        if (!nom || !brut) continue;

        let data;
        try { data = JSON.parse(brut[1]); } catch (_) { continue; }

        if (nom[1] === 'progress') {
          const etapes = { fiches: 'Lecture des fiches', doublons: 'Recherche de doublons', audio: 'Écoute des fichiers' };
          progression.innerText = `${etapes[data.etape] || 'Analyse'} — ${data.fait} / ${data.total}`;
        } else if (nom[1] === 'error') {
          progression.innerText = `Échec : ${data.error}`;
        } else if (nom[1] === 'done') {
          progression.classList.add('hidden');
          afficherRapportSante(data);
        }
      }
    }
  } catch (e) {
    progression.innerText = `Échec : ${e.message}`;
  } finally {
    diagnosticEnCours = false;
    btn.disabled = false;
  }
}

function afficherRapportSante(rapport) {
  const zone = document.getElementById('health-report');
  const r = rapport.resume;

  // Un défaut partagé par mille morceaux se raconte par son total : le serveur
  // n'envoie qu'un échantillon de chaque type, et on le dit.
  const groupes = new Map();
  for (const p of rapport.problemes) {
    if (!groupes.has(p.type)) groupes.set(p.type, []);
    groupes.get(p.type).push(p);
  }

  const ordre = { bloquant: 0, genant: 1, cosmetique: 2 };
  const types = [...groupes.keys()].sort((a, b) => {
    const ga = ordre[groupes.get(a)[0].gravite];
    const gb = ordre[groupes.get(b)[0].gravite];
    return ga - gb || (r.parType[b] - r.parType[a]);
  });

  const blocs = [`
    <div class="health-summary">
      <span><strong>${r.fichiers}</strong> morceaux</span>
      <span class="sev-bloquant"><strong>${r.bloquants}</strong> bloquants</span>
      <span class="sev-genant"><strong>${r.genants}</strong> gênants</span>
      <span class="sev-cosmetique"><strong>${r.cosmetiques}</strong> cosmétiques</span>
    </div>`];

  if (types.length === 0) {
    blocs.push('<p class="empty-note">Rien à signaler : la bibliothèque est saine.</p>');
  }

  for (const type of types) {
    const liste = groupes.get(type);
    const total = r.parType[type];
    const gravite = liste[0].gravite;

    const lignes = liste.slice(0, 12).map(p => `
      <div class="health-line">
        <span class="health-title">${escapeHtml(p.titre)}</span>
        <span class="health-detail">${escapeHtml(p.detail)}</span>
      </div>`).join('');

    const reste = total - Math.min(liste.length, 12);

    blocs.push(`
      <details class="health-group sev-${gravite}" ${gravite === 'bloquant' ? 'open' : ''}>
        <summary>
          <span class="health-group-name">${escapeHtml(LIBELLES_PROBLEMES[type] || type)}</span>
          <span class="health-count">${total}</span>
        </summary>
        ${lignes}
        ${reste > 0 ? `<div class="health-more">… et ${reste} autre${reste > 1 ? 's' : ''}</div>` : ''}
        <div class="health-action">${escapeHtml(liste[0].action || '')}</div>
      </details>`);
  }

  if (!rapport.deep) {
    blocs.push('<p class="empty-note">Les fichiers n\'ont pas été écoutés : coche l\'option pour repérer les muets et les intros vides.</p>');
  }

  zone.innerHTML = blocs.join('');
  zone.classList.remove('hidden');
}

// ==========================================
// ÉDITION D'UNE FICHE
// ==========================================
let editingTrack = null;

function openEditModal(track) {
  editingTrack = track;
  document.getElementById('edit-file-name').innerText = track.fileName || '';
  document.getElementById('edit-title').value = track.title || '';
  document.getElementById('edit-artist').value = track.artist || '';
  document.getElementById('edit-aliases').value = '';

  const genreSelect = document.getElementById('edit-genre');
  if (![...genreSelect.options].some(o => o.value === track.genre)) {
    genreSelect.insertAdjacentHTML('beforeend',
      `<option value="${escapeHtml(track.genre)}">${escapeHtml(track.genre)}</option>`);
  }
  genreSelect.value = track.genre || 'Autre';

  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('edit-title').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  editingTrack = null;
}

function initEditModalEvents() {
  const modal = document.getElementById('edit-modal');
  if (!modal) return;

  document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeEditModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeEditModal();
  });

  document.getElementById('edit-save-btn').addEventListener('click', async () => {
    if (!editingTrack) return;
    const payload = {
      title: document.getElementById('edit-title').value.trim(),
      artist: document.getElementById('edit-artist').value.trim(),
      genre: document.getElementById('edit-genre').value,
      aliases: document.getElementById('edit-aliases').value
        .split(',').map(s => s.trim()).filter(Boolean),
    };
    if (!payload.title) {
      showToast('Le titre affiché ne peut pas être vide.', 'warn');
      return;
    }

    try {
      const res = await fetch(`/api/tracks/${editingTrack.id}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      showToast('Fiche mise à jour.', 'ok');
      closeEditModal();
      loadLibrary();
    } catch (e) {
      showToast(`Impossible d'enregistrer : ${e.message}`, 'error');
    }
  });
}

// ==========================================
// UTILS / HELPERS
// ==========================================
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function normalizeString(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Enlève les accents
    .replace(/[^\w\s-]/g, "")       // Enlève la ponctuation sauf espaces et tirets
    .replace(/\s+/g, " ")           // Normalise les multi-espaces
    .replace(/\(.*\)|\[.*\]/g, "")  // Enlève ce qui est entre parenthèses ou crochets (ex: "(Remastered)")
    .trim();
}

function stripAll(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Enlève les accents
    .replace(/[^\w]/g, "");         // Garde uniquement les lettres et les chiffres
}

let toastTimer = null;

/**
 * Message flottant.
 * @param {string} message
 * @param {'info'|'ok'|'warn'|'error'} type  colore la bordure ; un échec doit
 *   se distinguer d'une confirmation au premier coup d'œil.
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.classList.remove('hidden', 'ok', 'warn', 'error');
  if (type !== 'info') toast.classList.add(type);

  // Un message d'erreur reste plus longtemps : il y a souvent à lire.
  const duree = type === 'error' ? 7000 : 3500;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, duree);
}
