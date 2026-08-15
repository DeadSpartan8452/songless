const express = require('express');
const multer = require('multer');
const musicMetadata = require('music-metadata');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

const T = require('./lib/titles');
const store = require('./lib/store');
const downloader = require('./lib/downloader');
const importer = require('./lib/importer');
const health = require('./lib/health');
const playerStore = require('./lib/player-store');
const partyStore = require('./lib/party');
const antivirus = require('./lib/antivirus');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNET = process.argv.includes('--internet');
const PUBLIC_PORT = Number(process.env.SONGLESS_PUBLIC_PORT) || 3001;
const PUBLIC_URL = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(String(process.env.SONGLESS_PUBLIC_URL || '').replace(/\/$/, ''))
  ? String(process.env.SONGLESS_PUBLIC_URL).replace(/\/$/, '') : '';

// ==========================================
// MODE RÉSEAU LOCAL
// ==========================================
//
// Par défaut le serveur n'écoute que la boucle locale : lui seul peut jouer.
// Avec `--lan` (ou SONGLESS_LAN=1), il s'ouvre au réseau de la maison pour
// qu'on joue depuis le téléphone. Les appareils distants deviennent des
// manettes : ils peuvent répondre et offrir un morceau, mais ne peuvent ni
// consulter la bibliothèque, ni éditer, supprimer ou commander la partie.
const LAN = process.argv.includes('--lan') || process.env.SONGLESS_LAN === '1';
const HOTE = LAN ? '0.0.0.0' : '127.0.0.1';
// Secret éphémère transmis uniquement dans le QR affiché sur l'ordinateur.
// Un voisin sur le même Wi-Fi ne peut donc pas modifier les profils partagés.
const LAN_PAIR_TOKEN = crypto.randomBytes(18).toString('base64url');

/** Adresses IPv4 par lesquelles le téléphone peut joindre cette machine. */
function adressesLocales() {
  const out = [];
  const cartes = os.networkInterfaces();
  for (const [nom, liste] of Object.entries(cartes)) {
    for (const carte of liste || []) {
      if (carte.family !== 'IPv4' && carte.family !== 4) continue;
      if (carte.internal) continue;
      out.push({ nom, adresse: carte.address });
    }
  }
  // Une carte virtuelle (VirtualBox, WSL, VPN) donne une adresse que le
  // téléphone ne joindra jamais : les réseaux domestiques passent devant.
  const domestique = (a) => /^192\.168\./.test(a) || /^10\./.test(a)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  return out.sort((a, b) => Number(domestique(b.adresse)) - Number(domestique(a.adresse)));
}

function urlLan(paired = false) {
  const premiere = adressesLocales()[0];
  if (!premiere) return null;
  const base = `http://${premiere.adresse}:${PORT}`;
  return paired ? `${base}/controller.html?pair=${encodeURIComponent(LAN_PAIR_TOKEN)}` : base;
}

/**
 * La requête vient-elle de la machine qui héberge le jeu ?
 *
 * La boucle locale ne suffit pas : ouvrir soi-même http://192.168.1.x:3000 sur
 * le PC hôte arrive par l'adresse réseau de la machine, et on se retrouverait
 * en lecture seule chez soi. Ses propres adresses comptent donc comme locales.
 */
function estLocal(req) {
  // Un tunnel arrive depuis la boucle locale. Sans ce test, cette connexion
  // serait prise à tort pour l'hôte du jeu et recevrait les droits du PC.
  if (estEntreeInternet(req)) return false;
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return adressesLocales().some(a => a.adresse === ip);
}

function estEntreeInternet(req) {
  return Boolean(req.get('CF-Connecting-IP'))
    || (INTERNET && Number(req.socket.localPort) === PUBLIC_PORT);
}

// Dossiers de stockage
const MUSIC_DIR = path.join(__dirname, 'musiques');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Création des dossiers s'ils n'existent pas
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Les archives transitent par un dossier temporaire, pas par musiques/
const UPLOAD_TMP = path.join(__dirname, '.cache', 'upload');

const estArchive = (nom) => path.extname(nom).toLowerCase() === '.zip';

// Configuration de Multer pour l'upload de musiques
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Même un MP3 reste en quarantaine jusqu'au verdict antivirus.
    fs.mkdirSync(UPLOAD_TMP, { recursive: true });
    cb(null, UPLOAD_TMP);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    // On conserve les accents : le nom sert de repli si les tags manquent.
    cb(null, importer.nomLibre(`${importer.nomSur(base)}${ext}`));
  }
});

// Filtre : fichiers audio courants, plus les archives .zip
const fileFilter = (req, file, cb) => {
  const mimeTypes = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/ogg', 'audio/x-m4a', 'audio/mp4', 'audio/aac',
    'audio/flac', 'audio/x-flac', 'audio/opus', 'audio/ogg; codecs=opus',
    'application/zip', 'application/x-zip-compressed', 'multipart/x-zip',
  ];
  const fileExts = [...importer.AUDIO_EXT, '.zip'];

  const ext = path.extname(file.originalname).toLowerCase();
  if (mimeTypes.includes(file.mimetype) || fileExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporté. Audio : MP3, WAV, OGG, M4A, FLAC, AAC, OPUS. Ou une archive .zip.'), false);
  }
};

// Le serveur ne tourne que sur cette machine : le seul plafond utile est celui
// du disque. 32 Go laisse passer n'importe quelle archive de musique.
const TAILLE_MAX = 32 * 1024 * 1024 * 1024;

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: TAILLE_MAX },
});
const REMOTE_UPLOAD_MAX = 200 * 1024 * 1024;
const remoteUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: REMOTE_UPLOAD_MAX, files: 1 },
});

// Middleware
app.use(express.json());

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (estEntreeInternet(req)) {
    res.set('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

const remoteRates = new Map();
function remoteIp(req) {
  return String(req.get('CF-Connecting-IP') || req.socket.remoteAddress || 'inconnue').split(',')[0].trim();
}
function rateAllowed(req, bucket, limit, windowMs) {
  if (estLocal(req)) return true;
  const now = Date.now();
  const key = `${bucket}:${remoteIp(req)}`;
  const current = remoteRates.get(key);
  if (!current || current.until <= now) {
    if (remoteRates.size > 5000) {
      for (const [storedKey, stored] of remoteRates) {
        if (stored.until <= now) remoteRates.delete(storedKey);
      }
      if (remoteRates.size > 5000) remoteRates.clear();
    }
    remoteRates.set(key, { count: 1, until: now + windowMs });
    return true;
  }
  current.count++;
  return current.count <= limit;
}

app.use('/api/', (req, res, next) => {
  if (!rateAllowed(req, 'api', 900, 60_000)) {
    return res.status(429).json({ error: 'Trop de requêtes. Réessaie dans une minute.' });
  }
  next();
});

function invitationFromRequest(req) {
  const pathMatch = req.path.match(/^\/api\/party\/([^/]+)/);
  const codeValue = req.get('X-Songless-Party') || (pathMatch && decodeURIComponent(pathMatch[1])) || '';
  return partyStore.isInvited(codeValue, req.get('X-Songless-Invite'));
}

// Garde-fou du mode réseau : le téléphone ne reçoit que les routes nécessaires
// à une télécommande Kahoot. Il peut créer son profil, rejoindre, répondre et
// offrir un morceau ; bibliothèque, réglages et commandes d'hôte restent cachés.
app.use((req, res, next) => {
  const local = estLocal(req);
  if (local) return next();
  const throughTunnel = estEntreeInternet(req);
  const paired = !throughTunnel && req.get('X-Songless-Pair') === LAN_PAIR_TOKEN;
  const invited = invitationFromRequest(req);
  req.songlessRemote = true;

  if (req.path === '/api/controller/profiles') {
    if (!paired && !invited) return res.status(403).json({ error: 'Invitation Songless invalide ou expirée.' });
    if (req.method === 'GET' || req.method === 'POST') return next();
  }

  // Seule exception d'écriture accordée aux téléphones : offrir un morceau
  // à la bibliothèque, par fichier ou par recherche/URL.
  if (req.path === '/api/upload' || req.path === '/api/download') {
    if (!paired && !invited) return res.status(403).json({ error: 'Invitation Songless invalide ou expirée.' });
    if (!rateAllowed(req, 'music', 10, 60 * 60_000)) {
      return res.status(429).json({ error: 'Limite de 10 propositions de musique par heure atteinte.' });
    }
    if (req.method === 'POST') return next();
  }

  if (req.path.startsWith('/api/party/')) {
    if (!paired && !invited) return res.status(403).json({ error: 'Invitation Songless invalide ou expirée.' });
    if (req.path === '/api/party/create' || req.path.endsWith('/command')) {
      return res.status(403).json({ error: 'Commande réservée à l’ordinateur hôte.' });
    }
    return next();
  }

  if (req.path === '/api/context') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Cette fonction est réservée à l’ordinateur hôte.' });
  }

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.status(403).json({
    error: 'Le téléphone est une télécommande de jeu : aucune modification n’est autorisée.',
  });
});

app.get(['/', '/index.html'], (req, res, next) => {
  if (LAN && !estLocal(req)) return res.sendFile(path.join(PUBLIC_DIR, 'controller.html'));
  next();
});

app.use(express.static(PUBLIC_DIR));

/**
 * Route: contexte de la page.
 * Dit au navigateur s'il est sur la machine hôte ou sur un appareil du réseau,
 * pour qu'il masque de lui-même ce qu'il n'a pas le droit de faire plutôt que
 * de laisser le joueur buter sur un refus.
 */
app.get('/api/context', (req, res) => {
  const local = estLocal(req);
  const lanPaired = !estEntreeInternet(req) && req.get('X-Songless-Pair') === LAN_PAIR_TOKEN;
  const paired = local || lanPaired || invitationFromRequest(req);
  res.json({
    lan: LAN,
    local,
    paired,
    canAdd: paired,
    controller: LAN && !local,
    readOnly: LAN && !local,
    url: local ? urlLan() : null,
    publicUrl: PUBLIC_URL || null,
    port: PORT,
  });
});

/** Route: QR code de l'adresse à scanner avec le téléphone. */
app.get('/api/lan/qr.svg', async (req, res) => {
  const url = urlLan(true);
  if (!url) return res.status(404).json({ error: 'Aucune adresse réseau détectée sur cette machine.' });
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    res.send(svg);
  } catch (e) {
    res.status(500).json({ error: 'QR code impossible à produire.' });
  }
});

// ==========================================
// PROFILS PARTAGÉS ET SAUVEGARDES
// ==========================================

app.get('/api/player/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(playerStore.publicState());
});

app.post('/api/player/profiles', (req, res) => {
  try {
    res.status(201).json(playerStore.upsertProfile(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/controller/profiles', (req, res) => {
  const profiles = playerStore.publicState().profiles.map(profile => ({
    id: profile.id,
    nom: profile.nom,
    emoji: profile.emoji,
    multiplayer: profile.multiplayer,
  }));
  res.set('Cache-Control', 'no-store');
  res.json({ profiles });
});

app.post('/api/controller/profiles', (req, res) => {
  try {
    const profile = playerStore.createProfile(req.body || {});
    res.status(201).json({ id: profile.id, nom: profile.nom, emoji: profile.emoji });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/player/profiles/:id', (req, res) => {
  try {
    const profile = playerStore.updateProfile(req.params.id, req.body || {});
    if (!profile) return res.status(404).json({ error: 'Profil introuvable.' });
    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/player/profiles/:id', (req, res) => {
  if (!playerStore.deleteProfile(req.params.id)) {
    return res.status(404).json({ error: 'Profil introuvable.' });
  }
  res.json({ success: true });
});

app.put('/api/player/lists', (req, res) => {
  try {
    res.json(playerStore.replaceLists(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/player/export', (req, res) => {
  const state = playerStore.publicState();
  res.set('Content-Disposition', 'attachment; filename="songless-sauvegarde.json"');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.send(`${JSON.stringify(state, null, 2)}\n`);
});

app.post('/api/player/import', (req, res) => {
  try {
    playerStore.backup();
    res.json(playerStore.replaceAll(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: `Sauvegarde invalide : ${error.message}` });
  }
});

// ==========================================
// PARTIES MULTIJOUEURS SUR LE RÉSEAU LOCAL
// ==========================================

function profileById(id) {
  return playerStore.publicState().profiles.find(p => p.id === String(id || '')) || null;
}

function partyInviteUrl(base, party) {
  if (!base) return null;
  const query = new URLSearchParams({ party: party.code, invite: party.inviteToken });
  return `${base}/controller.html?${query}`;
}

app.post('/api/party/create', (req, res) => {
  try {
    const hostProfile = req.body.profileId ? profileById(req.body.profileId) : null;
    if (req.body.profileId && !hostProfile) {
      return res.status(400).json({ error: 'Profil hôte introuvable.' });
    }
    const created = partyStore.create({
      mode: req.body.mode,
      totalRounds: req.body.totalRounds,
      seed: req.body.seed,
      settings: req.body.settings,
    });
    const hostPlayer = hostProfile ? partyStore.join(created.party.code, hostProfile).player : null;
    if (hostPlayer) hostPlayer.host = true;
    res.status(201).json({
      code: created.party.code,
      hostToken: created.hostToken,
      playerToken: hostPlayer ? hostPlayer.token : null,
      inviteUrls: {
        lan: partyInviteUrl(urlLan(), created.party),
        internet: partyInviteUrl(PUBLIC_URL, created.party),
      },
      state: partyStore.publicState(
        created.party,
        hostPlayer ? hostPlayer.token : null,
        created.hostToken
      ),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/party/:code/join', (req, res) => {
  try {
    const profile = profileById(req.body && req.body.profileId);
    if (!profile) return res.status(400).json({ error: 'Profil introuvable.' });
    const joined = partyStore.join(req.params.code, profile);
    if (!joined) return res.status(404).json({ error: 'Code de partie introuvable.' });
    res.json({
      playerToken: joined.player.token,
      state: partyStore.publicState(joined.party, joined.player.token, null),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/party/:code', (req, res) => {
  const party = partyStore.get(req.params.code);
  if (!party) return res.status(404).json({ error: 'Partie introuvable.' });
  res.set('Cache-Control', 'no-store');
  res.json(partyStore.publicState(party, req.query.playerToken, req.query.hostToken));
});

app.post('/api/party/:code/command', (req, res) => {
  try {
    const party = partyStore.get(req.params.code);
    if (!party) return res.status(404).json({ error: 'Partie introuvable.' });
    partyStore.command(party, req.body.hostToken, req.body.action, req.body.data);
    if (req.body.action === 'finish' && !party.statsCommitted) {
      const saved = playerStore.recordPartySessions(party.players);
      for (const result of saved) {
        const player = party.players.find(item => item.profileId === result.id);
        if (player) player.globalStats = result.multiplayer;
      }
      party.statsCommitted = true;
    }
    res.json(partyStore.publicState(party, req.body.playerToken, req.body.hostToken));
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});

app.post('/api/party/:code/action', (req, res) => {
  try {
    const party = partyStore.get(req.params.code);
    if (!party) return res.status(404).json({ error: 'Partie introuvable.' });
    partyStore.playerAction(party, req.body.playerToken, req.body.action, req.body.data);
    res.json(partyStore.publicState(party, req.body.playerToken, null));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Traduit l'identifiant d'un morceau en chemin de fichier, sans jamais sortir
 * de `musiques/`.
 *
 * L'identifiant est le nom de fichier encodé en base64url — donc contrôlé par
 * le client, qui peut y glisser ce qu'il veut. Sans vérification, un id valant
 * `../package.json` faisait servir n'importe quel fichier de la machine par la
 * route audio, et surtout supprimer n'importe quel fichier par la route DELETE
 * (`fs.unlink`, sans corbeille). `path.join` ne protège de rien : il résout
 * les `..` sans broncher.
 *
 * On résout donc le chemin pour de bon et on exige qu'il reste sous MUSIC_DIR.
 *
 * @param {string} id  identifiant base64url reçu du client
 * @returns {{fileName: string, filePath: string} | null}  null si hors dossier
 */
function resoudreMorceau(id) {
  let fileName;
  try {
    fileName = Buffer.from(String(id || ''), 'base64url').toString('utf-8');
  } catch (_) {
    return null;
  }
  if (!fileName || fileName.includes('\0')) return null;

  const racine = path.resolve(MUSIC_DIR);
  const filePath = path.resolve(racine, fileName);

  // Le séparateur final évite qu'un dossier voisin nommé « musiques-old »
  // passe le test par simple préfixe de chaîne.
  if (filePath !== racine && !filePath.startsWith(racine + path.sep)) return null;

  return { fileName, filePath };
}

// Helper: parse le nom de fichier en cas de métadonnées manquantes
function parseFilename(fileName) {
  const ext = path.extname(fileName);
  const nameWithoutExt = path.basename(fileName, ext);
  
  // Modèle classique: "Artiste - Titre"
  const parts = nameWithoutExt.split(' - ');
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return { artist, title };
  }
  
  return { artist: 'Artiste Inconnu', title: nameWithoutExt.trim() };
}

// Cache mémoire des tags lus sur disque, pour les fichiers pas encore enrichis.
// Clé : "nom|mtime|taille" — un fichier remplacé est donc relu automatiquement.
const tagCache = new Map();

async function readTags(fileName) {
  const filePath = path.join(MUSIC_DIR, fileName);
  let key;
  try {
    const stat = await fs.promises.stat(filePath);
    key = `${fileName}|${stat.mtimeMs}|${stat.size}`;
  } catch (_) {
    return { title: '', artist: '', duration: 0, hasCover: false };
  }
  if (tagCache.has(key)) return tagCache.get(key);

  const info = { title: '', artist: '', duration: 0, hasCover: false };
  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: true });
    info.title = meta.common.title || '';
    info.artist = meta.common.artist || '';
    info.duration = meta.format.duration || 0;
    info.hasCover = !!(meta.common.picture && meta.common.picture.length > 0);
  } catch (err) {
    console.warn(`Métadonnées illisibles pour ${fileName} : ${err.message}`);
  }
  tagCache.set(key, info);
  return info;
}

function listAudioFiles() {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus'];
  return fs.readdirSync(MUSIC_DIR)
    .filter(file => audioExtensions.includes(path.extname(file).toLowerCase()));
}

/**
 * Construit la fiche d'un morceau : metadata.json d'abord (titres lisibles,
 * genres, alias produits par tools/enrich.js), tags du fichier en secours.
 */
async function buildTrack(fileName, meta) {
  const id = Buffer.from(fileName).toString('base64url');

  if (meta && meta.title) {
    return {
      id,
      fileName,
      title: meta.title,
      originalTitle: meta.originalTitle || '',
      artist: meta.artist || '',
      genre: meta.genre || 'Autre',
      duration: meta.duration || 0,
      year: meta.year || null,
      aliases: meta.aliases || [],
      hasCover: !!meta.hasCover,
      needsReview: !!meta.needsReview,
      enriched: true,
    };
  }

  // Pas encore enrichi : on fait au mieux avec les tags et le nom de fichier.
  const tags = await readTags(fileName);
  const fromName = T.fromFilename(fileName);
  const title = T.cleanTitle(tags.title) || fromName.title || fileName;
  const artist = T.cleanTitle(tags.artist) || fromName.artist || 'Artiste inconnu';

  return {
    id,
    fileName,
    title,
    originalTitle: '',
    artist,
    genre: 'Autre',
    duration: tags.duration,
    year: null,
    aliases: T.buildAliases(title, `${artist} ${title}`),
    hasCover: tags.hasCover,
    needsReview: T.detectScript(title) !== 'latin',
    enriched: false,
  };
}

// Route: Lister les musiques
app.get('/api/tracks', async (req, res) => {
  try {
    const audioFiles = listAudioFiles();
    const metaTracks = store.load().tracks;

    const tracks = [];
    for (const file of audioFiles) {
      tracks.push(await buildTrack(file, metaTracks[file]));
    }

    res.json(tracks);
  } catch (error) {
    console.error('Erreur listing tracks:', error);
    res.status(500).json({ error: 'Impossible de lister les fichiers audio' });
  }
});

// Route: Genres présents dans la bibliothèque, avec le nombre de morceaux
app.get('/api/genres', (req, res) => {
  try {
    const audioFiles = new Set(listAudioFiles());
    const metaTracks = store.load().tracks;

    const counts = new Map();
    for (const file of audioFiles) {
      const genre = (metaTracks[file] && metaTracks[file].genre) || 'Autre';
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }

    // Ordre canonique d'abord, puis les genres personnalisés, "Autre" en dernier.
    const known = T.GENRES.filter(g => counts.has(g) && g !== 'Autre');
    const custom = [...counts.keys()]
      .filter(g => !T.GENRES.includes(g))
      .sort((a, b) => a.localeCompare(b, 'fr'));
    const ordered = [...known, ...custom, ...(counts.has('Autre') ? ['Autre'] : [])];

    res.json({
      total: audioFiles.size,
      genres: ordered.map(name => ({ name, count: counts.get(name) })),
      all: T.GENRES,          // liste canonique, pour les menus déroulants
    });
  } catch (error) {
    console.error('Erreur listing genres:', error);
    res.status(500).json({ error: 'Impossible de lister les genres' });
  }
});

// Route: Stream audio
app.get('/api/tracks/:id/audio', async (req, res) => {
  try {
    const morceau = resoudreMorceau(req.params.id);
    if (!morceau) return res.status(400).json({ error: 'Identifiant invalide' });
    const { fileName, filePath } = morceau;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }

    // Gestion du stream avec support du Range pour permettre de naviguer dans l'audio (requis par safari/ios et utile pour chrome)
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.opus': 'audio/opus'
    };
    const ext = path.extname(fileName).toLowerCase();
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error('Erreur streaming audio:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture du fichier audio' });
  }
});

// Route: Récupérer la pochette
app.get('/api/tracks/:id/cover', async (req, res) => {
  try {
    const morceau = resoudreMorceau(req.params.id);
    if (!morceau) return res.status(400).json({ error: 'Identifiant invalide' });
    const { filePath } = morceau;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }

    const metadata = await musicMetadata.parseFile(filePath);
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      res.set('Content-Type', picture.format);
      return res.send(picture.data);
    } else {
      return res.status(404).json({ error: 'Pas de pochette pour ce fichier' });
    }
  } catch (error) {
    console.error('Erreur extraction pochette:', error);
    res.status(500).json({ error: 'Impossible de lire la pochette' });
  }
});

/**
 * Route: Upload d'un fichier audio ou d'une archive .zip.
 *
 * Dans les deux cas, ce qui entre est trié comme le reste de la bibliothèque
 * (titre lisible, genre, alias) et les doublons sont supprimés au passage.
 */
app.post('/api/upload', (req, res) => {
  const selectedUpload = req.songlessRemote ? remoteUpload : upload;
  selectedUpload.single('audio')(req, res, async (err) => {
    if (err) {
      console.error('Erreur upload:', err);
      // Multer renvoie « File too large » en anglais : on explique quoi faire.
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? (req.songlessRemote
          ? 'Fichier trop volumineux depuis un téléphone (plafond 200 Mo).'
          : `Archive trop volumineuse (plafond ${Math.round(TAILLE_MAX / 1073741824)} Go). `
            + 'Importe-la sans passer par le navigateur : node tools/import.js "chemin du .zip ou du dossier"')
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu ou format incorrect' });
    }

    const nom = req.file.filename;
    const archive = estArchive(nom);

    try {
      await antivirus.scan(req.file.path);
      let rapport;
      if (archive) {
        rapport = await importer.importerArchive(req.file.path);
      } else {
        const installation = importer.installer([req.file.path], { deplacer: true });
        rapport = await importer.trier(installation.ecrits, {
          nomsOrigine: installation.nomsOrigine,
        });
      }

      // L'archive n'a plus d'utilité une fois son contenu extrait.
      if (archive) {
        try { fs.unlinkSync(req.file.path); } catch (_) { /* déjà parti */ }
      }

      res.json({
        success: true,
        antivirus: 'Microsoft Defender : fichier sain',
        archive,
        file: nom,
        ajoutes: rapport.ajoutes,
        doublons: rapport.doublons,
        erreurs: rapport.erreurs,
        aRevoir: rapport.aRevoir,
      });
    } catch (e) {
      console.error('Erreur import:', e);
      // Un fichier qu'on n'a pas su traiter ne doit pas rester dans musiques/
      try { fs.unlinkSync(req.file.path); } catch (_) { /* déjà parti */ }
      res.status(400).json({ error: e.message });
    }
  });
});

// Route: Supprimer une musique
app.delete('/api/tracks/:id', async (req, res) => {
  try {
    const morceau = resoudreMorceau(req.params.id);
    if (!morceau) return res.status(400).json({ error: 'Identifiant invalide' });
    const { fileName, filePath } = morceau;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }

    await fs.promises.unlink(filePath);
    store.remove(fileName);          // pas de métadonnées orphelines
    res.json({ success: true, message: 'Musique supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression:', error);
    res.status(500).json({ error: 'Impossible de supprimer la musique' });
  }
});

// ==========================================
// MÉTADONNÉES (titre affiché, genre, alias)
// ==========================================

// Route: Corriger la fiche d'un morceau
app.patch('/api/tracks/:id/meta', (req, res) => {
  try {
    const morceau = resoudreMorceau(req.params.id);
    if (!morceau) return res.status(400).json({ error: 'Identifiant invalide' });
    const { fileName, filePath } = morceau;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }

    const current = store.get(fileName) || {};
    const { title, artist, genre, aliases } = req.body || {};
    const patch = { reviewed: true, needsReview: false };

    if (typeof title === 'string' && title.trim()) {
      const clean = title.trim();
      // L'ancien titre devient le titre d'origine s'il n'y en avait pas.
      if (!current.originalTitle && current.title && T.norm(current.title) !== T.norm(clean)) {
        patch.originalTitle = current.title;
      }
      patch.title = clean;
    }
    if (typeof artist === 'string') patch.artist = artist.trim();
    if (typeof genre === 'string' && genre.trim()) {
      const resolved = T.resolveGenre(genre) || genre.trim();
      patch.genre = resolved;
    }

    patch.aliases = T.buildAliases(
      patch.title || current.title,
      patch.originalTitle || current.originalTitle,
      current.aliases || [],
      Array.isArray(aliases) ? aliases : [],
    );

    store.set(fileName, patch);
    res.json({ success: true, track: store.get(fileName) });
  } catch (error) {
    console.error('Erreur mise à jour métadonnées:', error);
    res.status(500).json({ error: 'Impossible de mettre à jour la fiche' });
  }
});

// ==========================================
// TÉLÉCHARGEMENT AUTOMATIQUE
// ==========================================

/**
 * Ouvre un flux d'événements (Server-Sent Events) et renvoie de quoi y écrire.
 * Les traitements longs — téléchargement, import d'une playlist, diagnostic —
 * ont tous besoin de rendre compte pendant qu'ils travaillent.
 */
function ouvrirFlux(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

// Route: État des outils externes (yt-dlp / ffmpeg)
app.get('/api/download/status', (req, res) => {
  res.json(downloader.checkTools());
});

// Une compilation proposée depuis un téléphone reste raisonnable jusqu'à
// 30 titres. Au-delà, l'ordinateur hôte choisit s'il souhaite importer le
// reste. Les demandes ne sont jamais persistées et expirent après deux
// minutes : aucun lien, titre ou choix ne finit dans les données de profil.
const PHONE_COMPILATION_FREE_LIMIT = 30;
const COMPILATION_HARD_LIMIT = 100;
const DOWNLOAD_APPROVAL_TTL = 2 * 60_000;
const downloadApprovals = new Map();

function requestDownloadApproval(media) {
  const id = crypto.randomBytes(18).toString('base64url');
  let finish;
  const promise = new Promise((resolve) => { finish = resolve; });
  const approval = {
    id,
    title: String(media.title || 'Compilation').slice(0, 180),
    count: Math.min(Number(media.chapterCount) || media.entries.length, COMPILATION_HARD_LIMIT),
    sourceCount: Number(media.chapterCount) || media.entries.length,
    createdAt: Date.now(),
    finish,
  };
  approval.timer = setTimeout(() => {
    if (!downloadApprovals.delete(id)) return;
    finish(false);
  }, DOWNLOAD_APPROVAL_TTL);
  downloadApprovals.set(id, approval);
  return { id, promise };
}

app.get('/api/download/approvals', (req, res) => {
  const now = Date.now();
  const pending = [];
  for (const approval of downloadApprovals.values()) {
    if (approval.createdAt + DOWNLOAD_APPROVAL_TTL <= now) continue;
    pending.push({
      id: approval.id,
      title: approval.title,
      count: approval.count,
      sourceCount: approval.sourceCount,
      expiresAt: approval.createdAt + DOWNLOAD_APPROVAL_TTL,
    });
  }
  res.json({ pending });
});

app.post('/api/download/approvals/:id', (req, res) => {
  const approval = downloadApprovals.get(req.params.id);
  if (!approval) {
    return res.status(404).json({ error: 'Cette demande a expiré ou a déjà été traitée.' });
  }
  const accepted = req.body && req.body.accepted === true;
  downloadApprovals.delete(req.params.id);
  clearTimeout(approval.timer);
  approval.finish(accepted);
  res.json({ ok: true, accepted });
});

/**
 * Route: Télécharger un titre et l'ajouter à la bibliothèque.
 * Réponse en flux (Server-Sent Events) pour suivre la progression en direct.
 */
app.post('/api/download', async (req, res) => {
  const { query, genre, title, artist, force } = req.body || {};

  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Indiquez un titre de musique ou une URL.' });
  }

  if (req.songlessRemote) {
    const value = String(query).trim();
    try {
      const candidate = new URL(value);
      const host = candidate.hostname.toLowerCase().replace(/^www\./, '');
      const allowed = candidate.protocol === 'https:'
        && ['youtube.com', 'youtu.be', 'music.youtube.com'].includes(host);
      if (!allowed) {
        return res.status(400).json({ error: 'À distance, seules les URL HTTPS YouTube sont acceptées.' });
      }
    } catch (_) {
      // Ce n'est pas une URL : yt-dlp effectuera une recherche par titre/artiste.
    }
  }

  const tools = downloader.checkTools();
  if (!tools.ok) {
    return res.status(503).json({ error: `Outil manquant : ${tools.missing.join(', ')}` });
  }

  const send = ouvrirFlux(res);

  try {
    const value = String(query).trim();
    const isUrl = /^https?:\/\//i.test(value);
    const chapterLimit = COMPILATION_HARD_LIMIT;
    const media = isUrl ? await downloader.inspectMediaUrl(value, {
      limite: chapterLimit,
      onLog: (message) => send('progress', { message }),
    }) : null;

    if (media && media.isCompilation) {
      if (!media.canSplit || media.entries.length < 2) {
        throw new Error('Compilation détectée, mais ses morceaux ne sont pas listés en chapitres. Songless refuse de télécharger toute la vidéo comme un seul titre.');
      }

      let approvedBeyondThirty = true;
      if (req.songlessRemote && media.chapterCount > PHONE_COMPILATION_FREE_LIMIT) {
        const approval = requestDownloadApproval(media);
        send('approval', {
          id: approval.id,
          total: media.chapterCount,
          freeLimit: PHONE_COMPILATION_FREE_LIMIT,
          hardLimit: COMPILATION_HARD_LIMIT,
        });
        approvedBeyondThirty = await approval.promise;
        send('approval-result', {
          accepted: approvedBeyondThirty,
          limit: approvedBeyondThirty ? COMPILATION_HARD_LIMIT : PHONE_COMPILATION_FREE_LIMIT,
        });
      }

      const allowedLimit = req.songlessRemote && !approvedBeyondThirty
        ? PHONE_COMPILATION_FREE_LIMIT
        : COMPILATION_HARD_LIMIT;
      const selectedEntries = media.entries.slice(0, allowedLimit);
      const wasTruncated = media.chapterCount > selectedEntries.length;

      send('list', {
        titre: media.title,
        total: selectedEntries.length,
        sourceTotal: media.chapterCount,
        tronquee: wasTruncated,
        compilation: true,
        limite: allowedLimit,
      });

      const bilan = { ajoutes: [], doublons: [], erreurs: [] };
      for (let index = 0; index < selectedEntries.length; index++) {
        const item = selectedEntries[index];
        send('item', {
          index: index + 1,
          total: selectedEntries.length,
          titre: item.title,
          etat: 'en-cours',
        });
        try {
          const entry = await downloader.downloadTrack(item.query, {
            genre: genre || null,
            onLog: (message) => send('progress', {
              message,
              index: index + 1,
              total: selectedEntries.length,
            }),
          });
          if (entry.alreadyPresent) {
            bilan.doublons.push({ titre: entry.title || item.title });
            send('item', { index: index + 1, total: selectedEntries.length,
              titre: entry.title || item.title, etat: 'doublon' });
          } else {
            bilan.ajoutes.push({ titre: entry.title, artiste: entry.artist, genre: entry.genre });
            send('item', { index: index + 1, total: selectedEntries.length,
              titre: entry.title, etat: 'ajoute', genre: entry.genre });
          }
        } catch (error) {
          bilan.erreurs.push({ titre: item.title, erreur: error.message });
          send('item', { index: index + 1, total: selectedEntries.length,
            titre: item.title, etat: 'erreur', erreur: error.message });
        }
      }

      send('done', {
        ...bilan,
        compilation: true,
        tronquee: wasTruncated,
      });
      return;
    }

    const entry = await downloader.downloadTrack(String(query).trim(), {
      genre: genre || null,
      title: title || null,
      artist: artist || null,
      force: !!force,
      prefetchedInfo: media ? media.info : null,
      onLog: (message) => send('progress', { message }),
    });
    send('done', { track: entry });
  } catch (error) {
    console.error('Erreur téléchargement:', error.message);
    send('error', { error: error.message });
  } finally {
    res.end();
  }
});

/**
 * Route: importer une playlist entière.
 *
 * yt-dlp énumère la playlist, puis chaque titre passe par exactement le même
 * chemin qu'un ajout à l'unité : titre lisible, genre, alias, écartement des
 * doublons. Un titre en échec n'interrompt pas les suivants — sur cinquante
 * morceaux, il y en a toujours un de bloqué ou supprimé.
 */
app.post('/api/download/playlist', async (req, res) => {
  const { url, genre, limite } = req.body || {};

  if (!url || !String(url).trim()) {
    return res.status(400).json({ error: 'Colle l\'adresse d\'une playlist.' });
  }

  const tools = downloader.checkTools();
  if (!tools.ok) {
    return res.status(503).json({ error: `Outil manquant : ${tools.missing.join(', ')}` });
  }

  const send = ouvrirFlux(res);

  // Le navigateur peut fermer l'onglet en cours de route : inutile de
  // continuer à télécharger dans le vide.
  let abandonne = false;
  req.on('close', () => { abandonne = true; });

  try {
    const { titre, entrees, tronquee } = await downloader.listPlaylist(String(url).trim(), {
      limite: Number(limite) || 100,
      onLog: (message) => send('progress', { message }),
    });

    send('list', { titre, total: entrees.length, tronquee });

    const bilan = { ajoutes: [], doublons: [], erreurs: [] };

    for (let i = 0; i < entrees.length; i++) {
      if (abandonne) break;
      const item = entrees[i];
      send('item', { index: i + 1, total: entrees.length, titre: item.title, etat: 'en-cours' });

      try {
        const entry = await downloader.downloadTrack(item.url, {
          genre: genre || null,
          onLog: (message) => send('progress', { message, index: i + 1 }),
        });

        if (entry.alreadyPresent) {
          bilan.doublons.push({ titre: entry.title || item.title });
          send('item', { index: i + 1, total: entrees.length, titre: entry.title || item.title, etat: 'doublon' });
        } else {
          bilan.ajoutes.push({ titre: entry.title, artiste: entry.artist, genre: entry.genre });
          send('item', { index: i + 1, total: entrees.length, titre: entry.title, etat: 'ajoute', genre: entry.genre });
        }
      } catch (e) {
        bilan.erreurs.push({ titre: item.title, erreur: e.message });
        send('item', { index: i + 1, total: entrees.length, titre: item.title, etat: 'erreur', erreur: e.message });
      }
    }

    send('done', { ...bilan, interrompu: abandonne, tronquee });
  } catch (error) {
    console.error('Erreur import playlist:', error.message);
    send('error', { error: error.message });
  } finally {
    res.end();
  }
});

// ==========================================
// DIAGNOSTIC DE LA BIBLIOTHÈQUE
// ==========================================

/**
 * Route: passer la bibliothèque en revue.
 * `?deep=1` ajoute l'analyse audio par ffmpeg — plusieurs minutes sur une
 * grosse bibliothèque, d'où le flux de progression.
 */
app.get('/api/library/health', async (req, res) => {
  const deep = req.query.deep === '1';
  const send = ouvrirFlux(res);

  // Une progression par fichier saturerait le flux : on n'écrit qu'un cran
  // sur vingt, plus le tout dernier.
  let dernierEnvoi = 0;

  try {
    const rapport = await health.analyser({
      deep,
      onProgress: (p) => {
        if (p.fait - dernierEnvoi < 20 && p.fait !== p.total) return;
        dernierEnvoi = p.fait;
        send('progress', p);
      },
    });
    send('done', rapport);
  } catch (error) {
    console.error('Erreur diagnostic:', error);
    send('error', { error: error.message });
  } finally {
    res.end();
  }
});

// Lancement
app.listen(PORT, HOTE, async () => {
  console.log(`==================================================`);
  console.log(`🐾 Serveur Songless lancé avec succès !`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`📁 Dossier musiques : ${MUSIC_DIR}`);

  if (!LAN) {
    console.log(`🔒 Écoute sur ${HOTE} — accessible depuis cette machine seulement`);
    console.log(`📱 Pour jouer depuis le téléphone : node server.js --lan`);
    console.log(`==================================================`);
    return;
  }

  const adresse = urlLan();
  const adresseAppairee = urlLan(true);
  console.log(`📱 Mode réseau local : ${adresse || 'aucune adresse IPv4 détectée'}`);
  console.log(`🔒 Les téléphones répondent et peuvent offrir un morceau ; le PC reste l'hôte`);

  if (adresse) {
    try {
      // QR code dans le terminal : le téléphone le scanne directement à l'écran.
      const qr = await QRCode.toString(adresseAppairee, { type: 'terminal', small: true });
      console.log(qr);
    } catch (_) {
      /* pas de QR : l'adresse en clair suffit */
    }
  }
  console.log(`==================================================`);
});

if (INTERNET) {
  app.listen(PUBLIC_PORT, '127.0.0.1', () => {
    console.log(`🔐 Entrée Internet isolée : http://127.0.0.1:${PUBLIC_PORT}`);
  });
}
