'use strict';

/**
 * Diagnostic de la bibliothèque.
 *
 * Une bibliothèque de 1 700 morceaux accumule en silence des fiches bancales :
 * un artiste vide, un genre « Autre » jamais corrigé, un fichier de 12 secondes
 * qui ne vaut rien en blind test, deux copies du même titre sous deux noms.
 * Rien de tout ça ne casse le jeu — ça le rend juste moins bon, sans le dire.
 *
 * Ce module passe la bibliothèque en revue et rend une liste de problèmes
 * classés par gravité. Il ne corrige rien de lui-même : ce qu'on jette ou ce
 * qu'on renomme reste une décision humaine.
 *
 * L'analyse audio (fichier muet, long silence d'intro) est facultative : elle
 * lance ffmpeg sur chaque morceau et prend plusieurs minutes.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const musicMetadata = require('music-metadata');

const T = require('./titles');
const store = require('./store');
const dupes = require('./dupes');
const downloader = require('./downloader');

const MUSIC_DIR = path.join(__dirname, '..', 'musiques');

// Un blind test a besoin d'un morceau, pas d'un jingle ni d'un podcast.
const DUREE_MINI = 45;         // secondes
const DUREE_MAXI = 12 * 60;

// Analyse audio : en dessous de ce niveau crête sur les 25 premières secondes,
// le fichier est considéré comme muet.
const SEUIL_MUET_DB = -50;
const SECONDES_ANALYSEES = 25;
const SILENCE_GENANT = 8;      // un blanc d'intro plus long que ça gâche l'extrait

const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus'];

// Un défaut partagé par un millier de morceaux se raconte par son total, pas
// par mille lignes : on n'envoie que les premiers exemples de chaque type.
const EXEMPLES_PAR_TYPE = 60;

/**
 * Gravité d'un problème :
 *   bloquant  — le morceau est injouable ou n'existe pas
 *   genant    — jouable, mais l'expérience de jeu en pâtit
 *   cosmetique— fiche incomplète, sans conséquence sur une manche
 */
const GRAVITES = { bloquant: 3, genant: 2, cosmetique: 1 };

function listerFichiers() {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(f => AUDIO_EXT.includes(path.extname(f).toLowerCase()));
  } catch (_) {
    return [];
  }
}

/**
 * Le titre affiché n'est-il qu'un nom de fichier recyclé ?
 * « 04 - piste audio », « AUDIO_1234 », « videoplayback » : le joueur ne peut
 * pas deviner ça, et l'autocomplétion ne le proposera jamais utilement.
 */
function titreDouteux(titre) {
  const t = T.norm(titre || '');
  if (!t) return true;
  if (t.length < 2) return true;
  if (/^(track|piste|audio|videoplayback|untitled|unknown|sans titre|new recording)\b/.test(t)) return true;
  // Presque que des chiffres : « 128 kbps », « 20200417 »
  return /^[\d\s]+$/.test(t);
}

/**
 * Passe la bibliothèque en revue.
 *
 * @param {object} opts
 * @param {boolean} opts.deep        lancer aussi l'analyse audio (lente)
 * @param {function} opts.onProgress ({ etape, fait, total, message })
 * @returns {Promise<{total:number, problemes:Array, resume:object, deep:boolean}>}
 */
async function analyser(opts = {}) {
  const { deep = false } = opts;
  const progres = opts.onProgress || (() => {});

  const fichiers = listerFichiers();
  const metaTracks = store.load(true).tracks;
  const problemes = [];

  const ajouter = (p) => problemes.push(p);

  // --- 1. Entrées de metadata.json dont le fichier a disparu -----------------
  const presents = new Set(fichiers);
  for (const nom of Object.keys(metaTracks)) {
    if (!presents.has(nom)) {
      ajouter({
        type: 'orphelin',
        gravite: 'cosmetique',
        fichier: nom,
        titre: metaTracks[nom].title || nom,
        detail: 'Fiche sans fichier audio : le MP3 a été supprimé ou renommé hors du jeu.',
        action: 'node tools/enrich.js nettoie ces entrées, ou supprime-la à la main.',
      });
    }
  }

  // --- 2. Fichier par fichier ------------------------------------------------
  const fiches = [];   // pour la détection de doublons, après la boucle

  for (let i = 0; i < fichiers.length; i++) {
    const nom = fichiers[i];
    const chemin = path.join(MUSIC_DIR, nom);
    const meta = metaTracks[nom] || null;

    progres({ etape: 'fiches', fait: i + 1, total: fichiers.length, message: nom });

    let duree = meta && meta.duration ? meta.duration : 0;
    let taille = 0;
    let illisible = false;

    try {
      taille = fs.statSync(chemin).size;
    } catch (_) {
      taille = 0;
    }

    // On ne relit les tags que si la fiche ne donne pas la durée : sur 1 700
    // fichiers, relire tout le monde coûterait plusieurs minutes pour rien.
    if (!duree) {
      try {
        const tags = await musicMetadata.parseFile(chemin, { duration: true });
        duree = tags.format.duration || 0;
      } catch (_) {
        illisible = true;
      }
    }

    const titre = (meta && meta.title) || T.fromFilename(nom).title || nom;

    if (illisible || taille === 0) {
      ajouter({
        type: 'illisible',
        gravite: 'bloquant',
        fichier: nom,
        titre,
        detail: taille === 0
          ? 'Fichier vide (0 octet).'
          : 'Métadonnées illisibles : fichier probablement corrompu ou tronqué.',
        action: 'Retélécharge ce morceau, puis supprime le fichier fautif.',
      });
    } else if (!duree) {
      ajouter({
        type: 'duree-inconnue',
        gravite: 'genant',
        fichier: nom,
        titre,
        detail: 'Durée inconnue : le point de départ de l\'extrait sera toujours 0:00.',
        action: 'node tools/enrich.js pour recalculer la durée.',
      });
    } else if (duree < DUREE_MINI) {
      ajouter({
        type: 'trop-court',
        gravite: 'genant',
        fichier: nom,
        titre,
        detail: `${Math.round(duree)} s seulement : trop court pour un extrait honnête.`,
        action: 'Jingle ou fichier tronqué : à supprimer, sauf si c\'est voulu.',
      });
    } else if (duree > DUREE_MAXI) {
      ajouter({
        type: 'trop-long',
        gravite: 'genant',
        fichier: nom,
        titre,
        detail: `${Math.round(duree / 60)} min : ressemble à un mix ou à une compilation.`,
        action: 'Un mix d\'une heure n\'est pas devinable : à retirer du jeu.',
      });
    }

    if (!meta) {
      ajouter({
        type: 'sans-fiche',
        gravite: 'cosmetique',
        fichier: nom,
        titre,
        detail: 'Aucune fiche : titre et artiste sont devinés depuis le nom de fichier.',
        action: 'node tools/enrich.js',
      });
    } else {
      if (titreDouteux(meta.title)) {
        ajouter({
          type: 'titre-douteux',
          gravite: 'genant',
          fichier: nom,
          titre,
          detail: 'Le titre affiché ne ressemble pas à un nom de morceau : indevinable.',
          action: 'Renomme-le avec le crayon de la bibliothèque.',
        });
      }
      if (!meta.artist) {
        ajouter({
          type: 'sans-artiste',
          gravite: 'cosmetique',
          fichier: nom,
          titre,
          detail: 'Artiste inconnu : ce morceau ne sortira jamais en mode « Deviner l\'artiste ».',
          action: 'node tools/enrich.js, ou le crayon de la bibliothèque.',
        });
      }
      if (!meta.genre || meta.genre === 'Autre') {
        ajouter({
          type: 'sans-genre',
          gravite: 'cosmetique',
          fichier: nom,
          titre,
          detail: 'Genre « Autre » : le morceau échappe au filtre par genre.',
          action: 'node tools/enrich.js',
        });
      }
      if (!meta.year) {
        ajouter({
          type: 'sans-annee',
          gravite: 'cosmetique',
          fichier: nom,
          titre,
          detail: 'Année inconnue : exclu du filtre par décennie et du mode « Deviner l\'année ».',
          action: 'node tools/years.js',
        });
      }
      if (meta.needsReview) {
        ajouter({
          type: 'a-renommer',
          gravite: 'genant',
          fichier: nom,
          titre,
          detail: 'Titre en alphabet non latin, jamais relu : à remplacer par son nom connu.',
          action: 'Filtre « À renommer » dans la bibliothèque.',
        });
      }
    }

    fiches.push({
      fileName: nom,
      sig: dupes.signature(meta || { title: titre, artist: '', duration: duree }, nom),
      titre,
    });
  }

  // --- 3. Doublons ------------------------------------------------------------
  //
  // On compare les signatures deux à deux, une seule fois chacune : appeler
  // dupes.chercherDoublon() pour chaque fichier relirait metadata.json 1 700
  // fois et recalculerait les mêmes signatures autant.
  progres({ etape: 'doublons', fait: 0, total: fiches.length, message: 'comparaison des fiches' });

  const dejaSignale = new Set();
  for (let i = 0; i < fiches.length; i++) {
    if (i % 100 === 0) {
      progres({ etape: 'doublons', fait: i, total: fiches.length, message: 'comparaison des fiches' });
    }
    if (dejaSignale.has(fiches[i].fileName)) continue;

    for (let j = i + 1; j < fiches.length; j++) {
      if (dejaSignale.has(fiches[j].fileName)) continue;
      if (!dupes.memeMorceau(fiches[i].sig, fiches[j].sig)) continue;

      dejaSignale.add(fiches[j].fileName);
      ajouter({
        type: 'doublon',
        gravite: 'genant',
        fichier: fiches[j].fileName,
        titre: fiches[j].titre,
        detail: `Semble être le même morceau que « ${fiches[i].titre} » (${fiches[i].fileName}).`,
        action: 'node tools/dedupe.js met les doublons en corbeille, sans les détruire.',
      });
    }
  }

  // --- 4. Analyse audio (facultative) ----------------------------------------
  if (deep) {
    const jouables = fiches.filter(f =>
      !problemes.some(p => p.fichier === f.fileName && p.gravite === 'bloquant'));
    await analyserAudio(jouables, ajouter, progres);
  }

  problemes.sort((a, b) => (GRAVITES[b.gravite] - GRAVITES[a.gravite])
    || a.type.localeCompare(b.type)
    || a.titre.localeCompare(b.titre, 'fr'));

  const parType = {};
  for (const p of problemes) parType[p.type] = (parType[p.type] || 0) + 1;

  const touches = new Set(problemes.map(p => p.fichier));

  // « 1 562 morceaux sans année » n'a pas besoin de 1 562 lignes détaillées :
  // le compte reste juste dans parType, seuls les premiers exemples voyagent.
  const vus = {};
  const detail = problemes.filter((p) => {
    vus[p.type] = (vus[p.type] || 0) + 1;
    return vus[p.type] <= EXEMPLES_PAR_TYPE;
  });

  return {
    total: fichiers.length,
    deep,
    problemes: detail,
    exemplesParType: EXEMPLES_PAR_TYPE,
    resume: {
      fichiers: fichiers.length,
      fichesMeta: Object.keys(metaTracks).length,
      problemes: problemes.length,
      morceauxTouches: touches.size,
      bloquants: problemes.filter(p => p.gravite === 'bloquant').length,
      genants: problemes.filter(p => p.gravite === 'genant').length,
      cosmetiques: problemes.filter(p => p.gravite === 'cosmetique').length,
      parType,
    },
  };
}

// ---------------------------------------------------------------- analyse audio

/**
 * Écoute les premières secondes de chaque fichier avec ffmpeg pour repérer
 * ce qu'aucune métadonnée ne dit : un fichier muet, ou une longue intro
 * silencieuse qui rendrait l'extrait de 0,2 s parfaitement vide.
 */
async function analyserAudio(fiches, ajouter, progres) {
  const dossierFfmpeg = downloader.findFfmpeg();
  if (dossierFfmpeg === null) {
    ajouter({
      type: 'ffmpeg-absent',
      gravite: 'cosmetique',
      fichier: '',
      titre: 'Analyse audio impossible',
      detail: 'ffmpeg est introuvable : les fichiers muets n\'ont pas été cherchés.',
      action: 'winget install Gyan.FFmpeg',
    });
    return;
  }

  const exe = dossierFfmpeg
    ? path.join(dossierFfmpeg, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    : 'ffmpeg';

  // Trois fichiers à la fois : ffmpeg est court mais son démarrage coûte cher,
  // et saturer le disque ne va pas plus vite.
  const PARALLELE = 3;
  let index = 0;
  let faits = 0;

  const travailleur = async () => {
    while (index < fiches.length) {
      const fiche = fiches[index++];
      try {
        const verdict = await inspecterAudio(exe, path.join(MUSIC_DIR, fiche.fileName));
        if (verdict.muet) {
          ajouter({
            type: 'muet',
            gravite: 'bloquant',
            fichier: fiche.fileName,
            titre: fiche.titre,
            detail: `Aucun son audible sur les ${SECONDES_ANALYSEES} premières secondes.`,
            action: 'Fichier à retélécharger.',
          });
        } else if (verdict.silenceDebut >= SILENCE_GENANT) {
          ajouter({
            type: 'intro-silencieuse',
            gravite: 'genant',
            fichier: fiche.fileName,
            titre: fiche.titre,
            detail: `${Math.round(verdict.silenceDebut)} s de silence au début : un extrait tiré là-dedans est vide.`,
            action: 'Recoupe le fichier, ou supprime-le.',
          });
        }
      } catch (_) {
        /* ffmpeg a échoué sur ce fichier : la boucle continue, ce n'est pas
           un diagnostic fiable pour autant. */
      }
      faits++;
      progres({ etape: 'audio', fait: faits, total: fiches.length, message: fiche.titre });
    }
  };

  await Promise.all(Array.from({ length: PARALLELE }, travailleur));
}

/**
 * Lance ffmpeg sur le début d'un fichier et lit son rapport.
 * @returns {Promise<{muet:boolean, silenceDebut:number}>}
 */
function inspecterAudio(exe, chemin) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostats',
      '-t', String(SECONDES_ANALYSEES),
      '-i', chemin,
      '-af', `volumedetect,silencedetect=noise=${SEUIL_MUET_DB}dB:d=1`,
      '-f', 'null', '-',
    ];
    const child = spawn(exe, args, { windowsHide: true });

    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);

    // Un fichier bloqué ne doit pas figer toute l'analyse.
    const minuteur = setTimeout(() => { try { child.kill(); } catch (_) {} }, 30000);

    child.on('close', () => {
      clearTimeout(minuteur);

      const crete = err.match(/max_volume:\s*(-?[\d.]+) dB/);
      const muet = crete ? parseFloat(crete[1]) <= SEUIL_MUET_DB : false;

      // silencedetect annonce un silence commençant à 0 : c'est une intro vide.
      let silenceDebut = 0;
      const debut = err.match(/silence_start:\s*(-?[\d.]+)/);
      if (debut && parseFloat(debut[1]) <= 0.05) {
        const fin = err.match(/silence_end:\s*([\d.]+)/);
        silenceDebut = fin ? parseFloat(fin[1]) : SECONDES_ANALYSEES;
      }

      resolve({ muet, silenceDebut });
    });
  });
}

module.exports = { analyser, MUSIC_DIR };
