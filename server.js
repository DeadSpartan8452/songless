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
// MODE RÃ‰SEAU LOCAL
// ==========================================
//
// Par dÃ©faut le serveur n'Ã©coute que la boucle locale : lui seul peut jouer.
// Avec `--lan` (ou SONGLESS_LAN=1), il s'ouvre au rÃ©seau de la maison pour
// qu'on joue depuis le tÃ©lÃ©phone. Les appareils distants deviennent des
// manettes : ils peuvent rÃ©pondre et offrir un morceau, mais ne peuvent ni
// consulter la bibliothÃ¨que, ni Ã©diter, supprimer ou commander la partie.
const LAN = process.argv.includes('--lan') || process.env.SONGLESS_LAN === '1';
const HOTE = LAN ? '0.0.0.0' : '127.0.0.1';
// Secret Ã©phÃ©mÃ¨re transmis uniquement dans le QR affichÃ© sur l'ordinateur.
// Un voisin sur le mÃªme Wi-Fi ne peut donc pas modifier les profils partagÃ©s.
const LAN_PAIR_TOKEN = crypto.randomBytes(18).toString('base64url');

/** Adresses IPv4 par lesquelles le tÃ©lÃ©phone peut joindre cette machine. */
function adresseRoutable(adresse) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(adresse);
}

function estLoopbackOuLli(adresse) {
  return adresse === '127.0.0.1'
    || adresse.startsWith('169.254.')
    || /^0\.0\.0\.0$/.test(adresse);
}

function interfaceVirtuelle(nom) {
  const nomLower = String(nom || '').toLowerCase();
  return /(vbox|vmware|virtual|hyper-?v|wsl|docker|podman|veth|utun|tun|tap|vpn|hamachi|wireguard|nordvpn|zerotier)/i.test(nomLower);
}

function estLocale(adresse) {
  return /^192\.168\./.test(adresse)
    || /^10\./.test(adresse)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(adresse);
}

function scoreInterface(nom, adresse) {
  let score = 100;
  if (interfaceVirtuelle(nom)) score += 800;
  if (estLocale(adresse)) score -= 400;
  if (/^(wifi|wireless|wlan|ethernet|lan|wi-?fi)/i.test(nom)) score -= 30;
  return score;
}

function adressesLocales() {
  const out = [];
  const cartes = os.networkInterfaces();
  for (const [nom, liste] of Object.entries(cartes)) {
    for (const carte of liste || []) {
      if (carte.family !== 'IPv4' && carte.family !== 4) continue;
      if (carte.internal) continue;
      const adresse = String(carte.address || '');
      if (!adresseRoutable(adresse) || estLoopbackOuLli(adresse)) continue;
      out.push({
        nom,
        adresse,
        score: scoreInterface(nom, adresse),
      });
    }
  }

  const triees = out
    .sort((a, b) => a.score - b.score || a.adresse.localeCompare(b.adresse))
    .map(item => ({ nom: item.nom, adresse: item.adresse }));

  const vues = new Set();
  return triees.filter(item => {
    if (vues.has(item.adresse)) return false;
    vues.add(item.adresse);
    return true;
  });
}

function urlsLan(paired = false) {
  return adressesLocales().map(item => {
    const base = `http://${item.adresse}:${PORT}`;
    return paired
      ? `${base}/controller.html?pair=${encodeURIComponent(LAN_PAIR_TOKEN)}`
      : base;
  });
}

function urlLan(paired = false) {
  return urlsLan(paired)[0] || null;
}

/**
 * La requÃªte vient-elle de la machine qui hÃ©berge le jeu ?
 *
 * La boucle locale ne suffit pas : ouvrir soi-mÃªme http://192.168.1.x:3000 sur
 * le PC hÃ´te arrive par l'adresse rÃ©seau de la machine, et on se retrouverait
 * en lecture seule chez soi. Ses propres adresses comptent donc comme locales.
 */
function estLocal(req) {
  // Un tunnel arrive depuis la boucle locale. Sans ce test, cette connexion
  // serait prise Ã  tort pour l'hÃ´te du jeu et recevrait les droits du PC.
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

// CrÃ©ation des dossiers s'ils n'existent pas
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
    // MÃªme un MP3 reste en quarantaine jusqu'au verdict antivirus.
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
    cb(new Error('Format non supportÃ©. Audio : MP3, WAV, OGG, M4A, FLAC, AAC, OPUS. Ou une archive .zip.'), false);
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
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Payload JSON invalide.' });
  }
  next(err);
});

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
    return res.status(429).json({ error: 'Trop de requÃªtes. RÃ©essaie dans une minute.' });
  }
  next();
});

function invitationFromRequest(req) {
  const pathMatch = req.path.match(/^\/api\/party\/([^/]+)/);
  const codeValue = req.get('X-Songless-Party') || (pathMatch && decodeURIComponent(pathMatch[1])) || '';
  return partyStore.isInvited(codeValue, req.get('X-Songless-Invite'));
}

// Garde-fou du mode rÃ©seau : le tÃ©lÃ©phone ne reÃ§oit que les routes nÃ©cessaires
// Ã  une tÃ©lÃ©commande Kahoot. Il peut crÃ©er son profil, rejoindre, rÃ©pondre et
// offrir un morceau ; bibliothÃ¨que, rÃ©glages et commandes d'hÃ´te restent cachÃ©s.
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

  // Renommer un profil partagé modifie durablement les données du PC hôte.
  // Une simple invitation Internet ne doit donc jamais suffire : il faut le
  // jeton d'appairage remis par le QR code affiché sur le réseau local.
  if (req.path.startsWith('/api/controller/profiles/')) {
    if (!paired) return res.status(403).json({ error: 'Modification réservée aux appareils appairés en réseau local.' });
    if (req.method === 'PUT') return next();
  }

  // Le son d'une manche n'est accessible qu'avec le jeton alÃ©atoire remis au
  // joueur aprÃ¨s son entrÃ©e dans cette partie. Une balise <audio> ne sait pas
  // envoyer nos en-tÃªtes personnalisÃ©s, le jeton passe donc dans l'URL du flux.
  const partyAudio = req.path.match(/^\/api\/party\/([^/]+)\/audio$/);
  if (req.method === 'GET' && partyAudio) {
    const party = partyStore.get(decodeURIComponent(partyAudio[1]));
    if (party && partyStore.findPlayer(party, req.query.playerToken)) return next();
    return res.status(403).json({ error: 'AccÃ¨s audio rÃ©servÃ© aux joueurs de cette partie.' });
  }

  // Seule exception d'Ã©criture accordÃ©e aux tÃ©lÃ©phones : offrir un morceau
  // Ã  la bibliothÃ¨que, par fichier ou par recherche/URL.
  if (req.path === '/api/upload' || req.path === '/api/download') {
    if (!paired && !invited) return res.status(403).json({ error: 'Invitation Songless invalide ou expirÃ©e.' });
    if (!rateAllowed(req, 'music', 10, 60 * 60_000)) {
      return res.status(429).json({ error: 'Limite de 10 propositions de musique par heure atteinte.' });
    }
    if (req.method === 'POST') return next();
  }

  if (req.path.startsWith('/api/party/')) {
    if (!paired && !invited) return res.status(403).json({ error: 'Invitation Songless invalide ou expirÃ©e.' });
    if (req.path === '/api/party/create' || req.path.endsWith('/command')) {
      return res.status(403).json({ error: 'Commande rÃ©servÃ©e Ã  lâ€™ordinateur hÃ´te.' });
    }
    return next();
  }

  if (req.path === '/api/context') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Cette fonction est rÃ©servÃ©e Ã  lâ€™ordinateur hÃ´te.' });
  }

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.status(403).json({
    error: 'Le tÃ©lÃ©phone est une tÃ©lÃ©commande de jeu : aucune modification nâ€™est autorisÃ©e.',
  });
});

app.get(['/', '/index.html'], (req, res, next) => {
  if (LAN && !estLocal(req)) return res.sendFile(path.join(PUBLIC_DIR, 'controller.html'));
  next();
});

app.use(express.static(PUBLIC_DIR));

// Court silence utilisÃ© par le bouton du tutoriel mobile pour autoriser le
// son. iOS et Android exigent une premiÃ¨re lecture dÃ©clenchÃ©e par un geste.
app.get('/silence.wav', (req, res) => {
  const samples = 800;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  res.type('audio/wav').set('Cache-Control', 'public, max-age=86400').send(wav);
});

/**
 * Route: contexte de la page.
 * Dit au navigateur s'il est sur la machine hÃ´te ou sur un appareil du rÃ©seau,
 * pour qu'il masque de lui-mÃªme ce qu'il n'a pas le droit de faire plutÃ´t que
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
    canEditProfiles: local || lanPaired,
    canAdd: paired,
    controller: LAN && !local,
    readOnly: LAN && !local,
    url: LAN ? urlLan() : null,
    urls: LAN ? urlsLan() : [],
    publicUrl: PUBLIC_URL || null,
    port: PORT,
  });
});

/** Route: QR code de l'adresse Ã  scanner avec le tÃ©lÃ©phone. */
app.get('/api/lan/qr.svg', async (req, res) => {
  const url = urlLan(true);
  if (!url) return res.status(404).json({ error: 'Aucune adresse rÃ©seau dÃ©tectÃ©e sur cette machine.' });
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    res.send(svg);
  } catch (e) {
    res.status(500).json({ error: 'QR code impossible Ã  produire.' });
  }
});

// ==========================================
// PROFILS PARTAGÃ‰S ET SAUVEGARDES
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

app.put('/api/controller/profiles/:id', (req, res) => {
  try {
    const profile = playerStore.updateProfile(req.params.id, {
      nom: req.body && req.body.nom,
      emoji: req.body && req.body.emoji,
    });
    if (!profile) return res.status(404).json({ error: 'Profil introuvable.' });
    res.json({ id: profile.id, nom: profile.nom, emoji: profile.emoji, multiplayer: profile.multiplayer });
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
// PARTIES MULTIJOUEURS SUR LE RÃ‰SEAU LOCAL
// ==========================================

function profileById(id) {
  return playerStore.publicState().profiles.find(p => p.id === String(id || '')) || null;
}

function partyInviteUrl(base, party) {
  if (!base) return null;
  const query = new URLSearchParams({ party: party.code, invite: party.inviteToken });
  return `${base}/controller.html?${query}`;
}

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

function partySuggestionScore(query, primary, value, artist, originalTitle, aliases) {
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

app.post('/api/party/create', (req, res) => {
  try {
    const hostProfile = req.body.profileId ? profileById(req.body.profileId) : {
      id: 'host_player',
      nom: 'ManaÃ«l',
      emoji: 'ðŸŽ§',
      multiplayer: {},
    };
    const rawSettings = req.body && req.body.settings && typeof req.body.settings === 'object'
      ? req.body.settings
      : {};
    const mergedSettings = {
      ...rawSettings,
      audioFx: rawSettings.audioFx || rawSettings.audiofx || rawSettings.audio_fx
        || rawSettings['audio-fx'] || (req.body && (req.body.audioFx || req.body.audiofx || req.body.audio_fx))
        || 'none',
    };
    const created = partyStore.create({
      mode: req.body.mode,
      totalRounds: req.body.totalRounds,
      seed: req.body.seed,
      settings: mergedSettings,
    });
    const hostPlayer = partyStore.join(created.party.code, hostProfile).player;
    if (hostPlayer) hostPlayer.host = true;

    const demoBots = [];
    if (req.body.demo) {
      const botProfiles = [
        { id: 'bot_sarah', nom: 'Sarah', emoji: 'âš¡', persona: 'fast' },
        { id: 'bot_lucas', nom: 'Lucas', emoji: 'ðŸš€', persona: 'quick' },
        { id: 'bot_chloe', nom: 'ChloÃ©', emoji: 'ðŸŒ¸', persona: 'balanced' },
        { id: 'bot_thomas', nom: 'Thomas', emoji: 'ðŸ›¡ï¸', persona: 'clutch' },
        { id: 'bot_alexandre', nom: 'Alexandre', emoji: 'ðŸŽ°', persona: 'guesser' },
      ];
      for (const bot of botProfiles) {
        const joined = partyStore.join(created.party.code, bot);
        if (joined) {
          demoBots.push({
            nom: bot.nom,
            emoji: bot.emoji,
            persona: bot.persona,
            playerToken: joined.player.token,
          });
        }
      }
    }

    res.status(201).json({
      code: created.party.code,
      hostToken: created.hostToken,
      playerToken: hostPlayer ? hostPlayer.token : null,
      demoBots,
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
    let profile = profileById(req.body && req.body.profileId);
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

app.get('/api/party/:code/audio', (req, res) => {
  try {
    const party = partyStore.get(req.params.code);
    const player = party && partyStore.findPlayer(party, req.query.playerToken);
    if (!party || !player) {
      return res.status(403).json({ error: 'AccÃ¨s audio rÃ©servÃ© aux joueurs de cette partie.' });
    }
    if (Number(req.query.round) !== party.round || !party.currentTrackId) {
      return res.status(409).json({ error: 'Cette manche nâ€™est plus active.' });
    }
    const morceau = resoudreMorceau(party.currentTrackId);
    if (!morceau) return res.status(404).json({ error: 'Morceau introuvable.' });
    res.set('Cache-Control', 'private, no-store');
    streamAudio(req, res, morceau);
  } catch (error) {
    console.error('Erreur audio multijoueur:', error.message);
    res.status(500).json({ error: 'Impossible de transmettre le son de la manche.' });
  }
});

app.get('/api/party/:code/suggestions', (req, res) => {
  const party = partyStore.get(req.params.code);
  const player = party && partyStore.findPlayer(party, req.query.playerToken);
  if (!party || !player) {
    return res.status(403).json({ error: 'Suggestions rÃ©servÃ©es aux joueurs de cette partie.' });
  }
  if (party.status !== 'round') return res.json({ suggestions: [] });

  const query = String(req.query.q || '').trim().slice(0, 80);
  if (!T.norm(query)) return res.json({ suggestions: [] });

  const answerMode = party.settings.answer;
  const metadata = store.load().tracks;
  const results = [];
  const seen = new Set();
  for (const fileName of listAudioFiles()) {
    const meta = metadata[fileName] || {};
    const fallback = T.fromFilename(fileName);
    const title = String(meta.title || fallback.title || '').trim();
    const artist = String(meta.artist || fallback.artist || '').trim();
    const year = Number(meta.year) || null;
    let value = '';
    let primary = '';
    let secondary = '';

    const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
    const originalTitle = String(meta.originalTitle || '').trim();
    if (answerMode === 'artiste') {
      value = artist;
      primary = artist;
      secondary = 'Artiste';
    } else if (answerMode === 'annee') {
      if (!year) continue;
      value = String(year);
      primary = value;
      secondary = 'AnnÃ©e';
    } else {
      value = artist ? `${artist} - ${title}` : title;
      primary = title;
      secondary = [artist,
        originalTitle && T.norm(originalTitle) !== T.norm(title)
          ? `titre original : ${originalTitle}` : '']
        .filter(Boolean).join(' Â· ');
    }

    const priority = partySuggestionScore(
      query, primary, value, artist, originalTitle, aliases);
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

  results.sort((a, b) => a.priority - b.priority
    || a.primary.length - b.primary.length
    || a.primary.localeCompare(b.primary, 'fr'));
  res.set('Cache-Control', 'no-store');
  res.json({ suggestions: results.slice(0, 8).map(({ priority, ...item }) => item) });
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
      const sortedPlayers = [...party.players].sort((a, b) => b.score - a.score);
      const topWinner = sortedPlayers[0];
      const teams = (party.teams || []).map(t => {
        const mems = party.players.filter(p => p.teamId === t.id);
        const score = mems.reduce((s, p) => s + (p.score || 0), 0);
        return { name: t.name, color: t.color, emoji: t.emoji, score };
      }).sort((a, b) => b.score - a.score);

      playerStore.recordPartyHistory({
        code: party.code,
        mode: party.mode,
        totalRounds: party.round,
        winner: topWinner ? { nom: topWinner.nom, emoji: topWinner.emoji, score: topWinner.score } : null,
        winningTeam: teams.length ? teams[0] : null,
        playersCount: party.players.length,
        players: sortedPlayers.map((p, idx) => ({
          nom: p.nom,
          emoji: p.emoji,
          score: p.score,
          rank: idx + 1,
          teamId: p.teamId,
        })),
      });
      party.statsCommitted = true;
    }
    res.json(partyStore.publicState(party, req.body.playerToken, req.body.hostToken));
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});

app.get('/api/party-history', (req, res) => {
  if (!estLocal(req)) {
    return res.status(403).json({ error: 'Historique rÃ©servÃ© au poste hÃ´te.' });
  }
  res.set('Cache-Control', 'no-store');
  res.json({ history: playerStore.partyHistory() });
});

app.post('/api/party/:code/action', (req, res) => {
  try {
    const party = partyStore.get(req.params.code);
    if (!party) return res.status(404).json({ error: 'Partie introuvable.' });
    partyStore.playerAction(party, req.body.playerToken, req.body.action, req.body.data);
    res.json(partyStore.publicState(party, req.body.playerToken, req.body.hostToken));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Traduit l'identifiant d'un morceau en chemin de fichier, sans jamais sortir
 * de `musiques/`.
 *
 * L'identifiant est le nom de fichier encodÃ© en base64url â€” donc contrÃ´lÃ© par
 * le client, qui peut y glisser ce qu'il veut. Sans vÃ©rification, un id valant
 * `../package.json` faisait servir n'importe quel fichier de la machine par la
 * route audio, et surtout supprimer n'importe quel fichier par la route DELETE
 * (`fs.unlink`, sans corbeille). `path.join` ne protÃ¨ge de rien : il rÃ©sout
 * les `..` sans broncher.
 *
 * On rÃ©sout donc le chemin pour de bon et on exige qu'il reste sous MUSIC_DIR.
 *
 * @param {string} id  identifiant base64url reÃ§u du client
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

  // Le sÃ©parateur final Ã©vite qu'un dossier voisin nommÃ© Â« musiques-old Â»
  // passe le test par simple prÃ©fixe de chaÃ®ne.
  if (filePath !== racine && !filePath.startsWith(racine + path.sep)) return null;

  return { fileName, filePath };
}

// Helper: parse le nom de fichier en cas de mÃ©tadonnÃ©es manquantes
function parseFilename(fileName) {
  const ext = path.extname(fileName);
  const nameWithoutExt = path.basename(fileName, ext);
  
  // ModÃ¨le classique: "Artiste - Titre"
  const parts = nameWithoutExt.split(' - ');
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return { artist, title };
  }
  
  return { artist: 'Artiste Inconnu', title: nameWithoutExt.trim() };
}

// Cache mÃ©moire des tags lus sur disque, pour les fichiers pas encore enrichis.
// ClÃ© : "nom|mtime|taille" â€” un fichier remplacÃ© est donc relu automatiquement.
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
    console.warn(`MÃ©tadonnÃ©es illisibles pour ${fileName} : ${err.message}`);
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

// Route: Genres prÃ©sents dans la bibliothÃ¨que, avec le nombre de morceaux
app.get('/api/genres', (req, res) => {
  try {
    const audioFiles = new Set(listAudioFiles());
    const metaTracks = store.load().tracks;

    const counts = new Map();
    for (const file of audioFiles) {
      const genre = (metaTracks[file] && metaTracks[file].genre) || 'Autre';
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }

    // Ordre canonique d'abord, puis les genres personnalisÃ©s, "Autre" en dernier.
    const known = T.GENRES.filter(g => counts.has(g) && g !== 'Autre');
    const custom = [...counts.keys()]
      .filter(g => !T.GENRES.includes(g))
      .sort((a, b) => a.localeCompare(b, 'fr'));
    const ordered = [...known, ...custom, ...(counts.has('Autre') ? ['Autre'] : [])];

    res.json({
      total: audioFiles.size,
      genres: ordered.map(name => ({ name, count: counts.get(name) })),
      all: T.GENRES,          // liste canonique, pour les menus dÃ©roulants
    });
  } catch (error) {
    console.error('Erreur listing genres:', error);
    res.status(500).json({ error: 'Impossible de lister les genres' });
  }
});

function streamAudio(req, res, morceau) {
  const { fileName, filePath } = morceau;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
  };
  const contentType = mimeTypes[path.extname(fileName).toLowerCase()] || 'audio/mpeg';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (!Number.isFinite(start) || start < 0 || end < start || end >= fileSize) {
      res.set('Content-Range', `bytes */${fileSize}`);
      return res.sendStatus(416);
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start) + 1,
      'Content-Type': contentType,
    });
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': fileSize,
    'Content-Type': contentType,
  });
  fs.createReadStream(filePath).pipe(res);
}

// Route: Stream audio local du PC
app.get('/api/tracks/:id/audio', (req, res) => {
  try {
    const morceau = resoudreMorceau(req.params.id);
    if (!morceau) return res.status(400).json({ error: 'Identifiant invalide' });
    streamAudio(req, res, morceau);
  } catch (error) {
    console.error('Erreur streaming audio:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture du fichier audio' });
  }
});

// Route: RÃ©cupÃ©rer la pochette
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
 * Dans les deux cas, ce qui entre est triÃ© comme le reste de la bibliothÃ¨que
 * (titre lisible, genre, alias) et les doublons sont supprimÃ©s au passage.
 */
app.post('/api/upload', (req, res) => {
  const selectedUpload = req.songlessRemote ? remoteUpload : upload;
  selectedUpload.single('audio')(req, res, async (err) => {
    if (err) {
      console.error('Erreur upload:', err);
      // Multer renvoie Â« File too large Â» en anglais : on explique quoi faire.
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? (req.songlessRemote
          ? 'Fichier trop volumineux depuis un tÃ©lÃ©phone (plafond 200 Mo).'
          : `Archive trop volumineuse (plafond ${Math.round(TAILLE_MAX / 1073741824)} Go). `
            + 'Importe-la sans passer par le navigateur : node tools/import.js "chemin du .zip ou du dossier"')
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reÃ§u ou format incorrect' });
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

      // L'archive n'a plus d'utilitÃ© une fois son contenu extrait.
      if (archive) {
        try { fs.unlinkSync(req.file.path); } catch (_) { /* dÃ©jÃ  parti */ }
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
      try { fs.unlinkSync(req.file.path); } catch (_) { /* dÃ©jÃ  parti */ }
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
    store.remove(fileName);          // pas de mÃ©tadonnÃ©es orphelines
    res.json({ success: true, message: 'Musique supprimÃ©e avec succÃ¨s' });
  } catch (error) {
    console.error('Erreur suppression:', error);
    res.status(500).json({ error: 'Impossible de supprimer la musique' });
  }
});

// ==========================================
// MÃ‰TADONNÃ‰ES (titre affichÃ©, genre, alias)
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
    console.error('Erreur mise Ã  jour mÃ©tadonnÃ©es:', error);
    res.status(500).json({ error: 'Impossible de mettre Ã  jour la fiche' });
  }
});

// ==========================================
// TÃ‰LÃ‰CHARGEMENT AUTOMATIQUE
// ==========================================

/**
 * Ouvre un flux d'Ã©vÃ©nements (Server-Sent Events) et renvoie de quoi y Ã©crire.
 * Les traitements longs â€” tÃ©lÃ©chargement, import d'une playlist, diagnostic â€”
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

// Route: Ã‰tat des outils externes (yt-dlp / ffmpeg)
app.get('/api/download/status', (req, res) => {
  res.json(downloader.checkTools());
});

// Une compilation proposÃ©e depuis un tÃ©lÃ©phone reste raisonnable jusqu'Ã 
// 30 titres. Au-delÃ , l'ordinateur hÃ´te choisit s'il souhaite importer le
// reste. Les demandes ne sont jamais persistÃ©es et expirent aprÃ¨s deux
// minutes : aucun lien, titre ou choix ne finit dans les donnÃ©es de profil.
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
    return res.status(404).json({ error: 'Cette demande a expirÃ© ou a dÃ©jÃ  Ã©tÃ© traitÃ©e.' });
  }
  const accepted = req.body && req.body.accepted === true;
  downloadApprovals.delete(req.params.id);
  clearTimeout(approval.timer);
  approval.finish(accepted);
  res.json({ ok: true, accepted });
});

/**
 * Route: TÃ©lÃ©charger un titre et l'ajouter Ã  la bibliothÃ¨que.
 * RÃ©ponse en flux (Server-Sent Events) pour suivre la progression en direct.
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
        return res.status(400).json({ error: 'Ã€ distance, seules les URL HTTPS YouTube sont acceptÃ©es.' });
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
        throw new Error('Compilation dÃ©tectÃ©e, mais ses morceaux ne sont pas listÃ©s en chapitres. Songless refuse de tÃ©lÃ©charger toute la vidÃ©o comme un seul titre.');
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
    console.error('Erreur tÃ©lÃ©chargement:', error.message);
    send('error', { error: error.message });
  } finally {
    res.end();
  }
});

/**
 * Route: importer une playlist entiÃ¨re.
 *
 * yt-dlp Ã©numÃ¨re la playlist, puis chaque titre passe par exactement le mÃªme
 * chemin qu'un ajout Ã  l'unitÃ© : titre lisible, genre, alias, Ã©cartement des
 * doublons. Un titre en Ã©chec n'interrompt pas les suivants â€” sur cinquante
 * morceaux, il y en a toujours un de bloquÃ© ou supprimÃ©.
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
  // continuer Ã  tÃ©lÃ©charger dans le vide.
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
// DIAGNOSTIC DE LA BIBLIOTHÃˆQUE
// ==========================================

/**
 * Route: passer la bibliothÃ¨que en revue.
 * `?deep=1` ajoute l'analyse audio par ffmpeg â€” plusieurs minutes sur une
 * grosse bibliothÃ¨que, d'oÃ¹ le flux de progression.
 */
app.get('/api/library/health', async (req, res) => {
  const deep = req.query.deep === '1';
  const send = ouvrirFlux(res);

  // Une progression par fichier saturerait le flux : on n'Ã©crit qu'un cran
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

// Gestionnaire d'erreur Express (protège contre les requêtes JSON invalides ou corrompues)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Format JSON invalide.' });
  }
  console.error('Erreur Express non interceptée:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

process.on('uncaughtException', (err) => {
  console.error('Erreur critique non interceptée (uncaughtException):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Promesse rejetée non interceptée (unhandledRejection):', reason);
});

// Lancement
app.listen(PORT, HOTE, async () => {
  console.log(`==================================================`);
  console.log(`ðŸ¾ Serveur Songless lancÃ© avec succÃ¨s !`);
  console.log(`ðŸ‘‰ http://localhost:${PORT}`);
  console.log(`ðŸ“ Dossier musiques : ${MUSIC_DIR}`);

  if (!LAN) {
    console.log(`ðŸ”’ Ã‰coute sur ${HOTE} â€” accessible depuis cette machine seulement`);
    console.log(`ðŸ“± Pour jouer depuis le tÃ©lÃ©phone : node server.js --lan`);
    console.log(`==================================================`);
    return;
  }

  const adresse = urlLan();
  const adresseAppairee = urlLan(true);
  console.log(`ðŸ“± Mode rÃ©seau local : ${adresse || 'aucune adresse IPv4 dÃ©tectÃ©e'}`);
  console.log(`ðŸ”’ Les tÃ©lÃ©phones rÃ©pondent et peuvent offrir un morceau ; le PC reste l'hÃ´te`);

  if (adresse) {
    try {
      // QR code dans le terminal : le tÃ©lÃ©phone le scanne directement Ã  l'Ã©cran.
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
    console.log(`ðŸ” EntrÃ©e Internet isolÃ©e : http://127.0.0.1:${PUBLIC_PORT}`);
  });
}

