'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus']);

function result(id, label, status, detail, action = '') {
  return { id, label, status, detail, action };
}

function portAvailable(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

function findTailscale() {
  const candidates = process.platform === 'win32'
    ? ['tailscale.exe', 'C:\\Program Files\\Tailscale\\tailscale.exe']
    : ['tailscale'];
  for (const command of candidates) {
    const check = spawnSync(command, ['version'], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    if (check.status === 0) return command;
  }
  return null;
}

function checkTailscale(root, internetMode, publicUrl) {
  if (!internetMode) {
    return result('tailscale', 'Connexion Internet', 'green',
      'Non requise pour le mode local actuel.', 'Relance Songless en mode Internet pour tester Funnel.');
  }
  const command = findTailscale();
  if (!command) return result('tailscale', 'Tailscale et Funnel', 'blocking',
    'Tailscale est introuvable.', 'Installe Tailscale puis reconnecte le compte Songless.');
  const accountFile = path.join(root, '.songless-tailscale-account');
  if (!fs.existsSync(accountFile) || !fs.readFileSync(accountFile, 'utf8').trim()) {
    return result('tailscale', 'Tailscale et Funnel', 'blocking',
      'Le compte Songless dédié n’est pas configuré.', 'Configure le compte Songless dans le lanceur Internet.');
  }
  const status = spawnSync(command, ['status', '--json'], {
    encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  if (status.status !== 0) return result('tailscale', 'Tailscale et Funnel', 'blocking',
    'Tailscale ne répond pas ou n’est pas connecté.', 'Ouvre Tailscale et connecte le compte Songless.');
  try {
    const parsed = JSON.parse(status.stdout);
    const expected = fs.readFileSync(accountFile, 'utf8').trim();
    const users = Object.values(parsed.User || {});
    const current = users.find(user => String(user.ID) === String(parsed.Self && parsed.Self.UserID));
    if (!current || String(current.LoginName || '') !== expected) {
      return result('tailscale', 'Tailscale et Funnel', 'blocking',
        'Le compte Tailscale actif n’est pas le compte Songless.', 'Bascule manuellement vers le compte Songless.');
    }
    if (!publicUrl) return result('tailscale', 'Tailscale et Funnel', 'blocking',
      'Aucune adresse HTTPS Funnel n’est active.', 'Relance Songless avec le choix Internet.');
    const funnel = spawnSync(command, ['funnel', 'status', '--json'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    });
    if (funnel.status !== 0 || !/127\.0\.0\.1:3001/.test(funnel.stdout || '')) {
      return result('tailscale', 'Tailscale et Funnel', 'blocking',
        'Le compte est correct, mais Funnel ne pointe pas vers Songless.',
        'Ferme cette instance puis relance Songless en mode Internet.');
    }
    return result('tailscale', 'Tailscale et Funnel', 'green',
      'Compte dédié et adresse HTTPS détectés.');
  } catch (_) {
    return result('tailscale', 'Tailscale et Funnel', 'blocking',
      'L’état Tailscale est illisible.', 'Redémarre Tailscale puis Songless.');
  }
}

function listAudioFiles(musicDir) {
  try {
    return fs.readdirSync(musicDir).filter(file => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()));
  } catch (_) {
    return [];
  }
}

function checkReadableAudio(musicDir, files) {
  if (!files.length) return result('audio', 'Lecture audio', 'blocking',
    'Aucun morceau jouable n’a été trouvé.', 'Ajoute au moins un fichier audio avant la soirée.');
  for (const file of files.slice(0, 20)) {
    try {
      const descriptor = fs.openSync(path.join(musicDir, file), 'r');
      const buffer = Buffer.alloc(16);
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      fs.closeSync(descriptor);
      if (bytes > 0) return result('audio', 'Lecture audio', 'green',
        'Un morceau réel a été ouvert et lu depuis le disque.');
    } catch (_) { /* essayer un autre fichier */ }
  }
  return result('audio', 'Lecture audio', 'blocking',
    'Les premiers morceaux sont inaccessibles ou vides.', 'Lance l’état détaillé de la bibliothèque.');
}

async function checkParty(partyStore, qrCode) {
  let code = '';
  try {
    const created = partyStore.create({ mode: 'classic', totalRounds: 1, trackIds: [] });
    code = created.party.code;
    const tv = partyStore.issueAccessToken(created.party, created.hostToken, 'tv');
    const remote = partyStore.issueAccessToken(created.party, created.hostToken, 'remote_admin');
    const hostState = partyStore.publicState(created.party, null, created.hostToken);
    const tvState = partyStore.publicState(created.party, null, null, tv.accessToken);
    const remoteState = partyStore.publicState(created.party, null, null, remote.accessToken);
    const permissionsOk = hostState.isHost === true && tvState.viewerRole === 'tv'
      && remoteState.viewerRole === 'remote_admin' && tvState.isHost === false;
    const svg = await qrCode.toString('http://127.0.0.1/songless-test', { type: 'svg' });
    return permissionsOk && /<svg/i.test(svg)
      ? result('party', 'Salon, QR et permissions', 'green',
        'Un salon temporaire, ses accès TV/admin et son QR ont été créés.')
      : result('party', 'Salon, QR et permissions', 'blocking',
        'Le salon temporaire a révélé une permission incohérente.', 'Ne lance pas la soirée avant correction.');
  } catch (error) {
    return result('party', 'Salon, QR et permissions', 'blocking',
      `Le test temporaire a échoué : ${error.message}`, 'Ne lance pas la soirée avant correction.');
  } finally {
    if (code) partyStore.remove(code);
  }
}

async function run(options) {
  const root = options.root;
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(result('node', 'Node.js et dépendances', major >= 18 && options.dependenciesOk ? 'green' : 'blocking',
    `Node.js ${process.versions.node} · ${options.dependenciesOk ? 'dépendances présentes' : 'dépendances incomplètes'}`,
    options.dependenciesOk ? '' : 'Répare Songless depuis son lanceur.'));
  checks.push(result('port3000', 'Port local 3000', 'green',
    `Cette instance Songless répond sur le port ${options.port}.`));
  const publicFree = options.internetMode ? false : await portAvailable(options.publicPort);
  checks.push(result('port3001', 'Port Internet 3001',
    options.internetMode || publicFree ? 'green' : 'blocking',
    options.internetMode ? 'L’entrée Internet de cette instance est active.'
      : publicFree ? 'Le port est libre pour une future partie Internet.' : 'Le port est occupé par un autre programme.',
    options.internetMode || publicFree ? '' : 'Ferme le programme qui utilise le port 3001.'));
  checks.push(result('instance', 'Instance unique', 'green',
    `Une seule instance peut posséder le port local · processus ${process.pid}.`));

  const files = listAudioFiles(options.musicDir);
  checks.push(checkReadableAudio(options.musicDir, files));
  checks.push(result('speakers', 'Haut-parleurs', 'check',
    'Le navigateur exige un geste pour jouer le son de contrôle.',
    'Utilise « Tester les haut-parleurs », puis confirme ce que tu entends.'));
  const tracks = options.tracks || {};
  const usableMetadata = Object.values(tracks).filter(track => track && track.title).length;
  checks.push(result('library', 'Bibliothèque et métadonnées',
    files.length && usableMetadata ? (usableMetadata < files.length ? 'check' : 'green') : 'blocking',
    `${files.length} fichiers audio · ${usableMetadata} fiches avec un titre.`,
    usableMetadata < files.length ? 'Lance l’état détaillé de la bibliothèque.' : ''));

  checks.push(options.defender
    ? result('defender', 'Microsoft Defender', 'green', 'Le moteur requis pour sécuriser les imports est présent.')
    : result('defender', 'Microsoft Defender', 'blocking', 'Microsoft Defender est introuvable.',
      'Réactive Defender avant tout import.'));
  const tools = options.tools;
  checks.push(result('tools', 'Téléchargements', tools.ok ? 'green' : 'check',
    tools.ok ? 'ffmpeg et yt-dlp sont disponibles.' : `Outils facultatifs absents : ${tools.missing.join(', ')}.`,
    tools.ok ? '' : 'À réparer seulement si tu veux télécharger depuis Songless.'));
  checks.push(checkTailscale(root, options.internetMode, options.publicUrl));
  checks.push(await checkParty(options.partyStore, options.qrCode));

  const rank = { green: 0, check: 1, blocking: 2 };
  const status = checks.reduce((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, 'green');
  return {
    status,
    generatedAt: new Date().toISOString(),
    checks,
    summary: {
      green: checks.filter(item => item.status === 'green').length,
      check: checks.filter(item => item.status === 'check').length,
      blocking: checks.filter(item => item.status === 'blocking').length,
    },
  };
}

module.exports = { checkParty, checkReadableAudio, listAudioFiles, portAvailable, result, run };
