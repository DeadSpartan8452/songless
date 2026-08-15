#!/usr/bin/env node
'use strict';

/**
 * Remplit l'année de sortie des morceaux de la bibliothèque.
 *
 * Pourquoi un outil à part : `year` n'était renseigné que par le téléchargeur,
 * et le plus souvent avec l'année de mise en ligne de la vidéo YouTube — pas
 * celle du morceau. Sur 1 687 fiches, 125 avaient une année, presque toutes
 * dans les années 2020. Le filtre par décennie et le mode « Deviner l'année »
 * n'avaient donc rien à se mettre sous la dent.
 *
 * On demande ici à MusicBrainz la date de première parution de l'enregistrement
 * (`first-release-date`), qui est la bonne définition : l'année du morceau, pas
 * celle de la vidéo.
 *
 * MusicBrainz impose une requête par seconde. Comptez environ une demi-heure
 * pour 1 500 morceaux — le cache disque rend le script reprenable à tout
 * moment : coupez-le, relancez-le, il repart où il en était.
 *
 * Usage :
 *   node tools/years.js                  # tous les morceaux sans année
 *   node tools/years.js --limit 100      # s'arrêter après 100 recherches réseau
 *   node tools/years.js --force          # réinterroger ceux qui ont déjà une année
 *   node tools/years.js --cache-only     # hors ligne : n'utilise que le cache
 */

const fs = require('fs');
const path = require('path');

const T = require('../lib/titles');
const store = require('../lib/store');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = path.join(ROOT, 'musiques');
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'musicbrainz-years.json');

const USER_AGENT = 'SonglessLocal/1.0 ( https://localhost/songless )';
const MB_DELAY = 1100;

// Avant l'enregistrement sonore, et après-demain : dans les deux cas, ce n'est
// pas une année de morceau.
const ANNEE_MINI = 1900;
const ANNEE_MAXI = new Date().getFullYear() + 1;

const args = process.argv.slice(2);
const OPT = {
  force: args.includes('--force'),
  cacheOnly: args.includes('--cache-only'),
  limit: (() => {
    const i = args.indexOf('--limit');
    return i !== -1 ? parseInt(args[i + 1], 10) : Infinity;
  })(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chargerCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function sauverCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

// Habillages qui n'existent que sur YouTube : MusicBrainz catalogue « Rush »,
// pas « Rush (sped up) [Official Video] ».
const BRUIT = /\b(sped ?up|slowed|reverb|nightcore|8 ?bit|remix|cover|lyrics?|official|video|audio|hd|hq|amv|amv edit|edit)\b/gi;

/** Réduit un titre à ce qu'un catalogue musical peut reconnaître. */
function nettoyerPourRecherche(titre) {
  return String(titre || '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')   // (sped up), [Official Video], {AMV}
    .replace(BRUIT, ' ')
    .replace(/["\\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Cherche l'année de première parution d'un morceau.
 *
 * On exige un score élevé et une correspondance de titre : MusicBrainz répond
 * toujours quelque chose, et une reprise homonyme de 1962 collée sur un titre
 * de 2023 serait pire que pas d'année du tout.
 *
 * @returns {Promise<number|null>}
 */
async function chercherAnnee(titre, artiste) {
  const clean = nettoyerPourRecherche(titre);
  if (clean.length < 3) return null;

  const q = artiste
    ? `recording:"${clean}" AND artist:"${String(artiste).replace(/["\\]/g, ' ')}"`
    : `recording:"${clean}"`;
  const url = `https://musicbrainz.org/ws/2/recording?fmt=json&limit=5&query=${encodeURIComponent(q)}`;

  // MusicBrainz renvoie régulièrement un 503 même en respectant sa cadence :
  // c'est une saturation passagère, pas un refus. Une seconde chance suffit
  // presque toujours, et évite de marquer le morceau « sans année » à tort.
  let res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 503) {
    await sleep(3000);
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const cible = T.norm(clean);
  const candidats = (data.recordings || []).filter((r) => {
    if ((r.score || 0) < 90) return false;
    const t = T.norm(r.title || '');
    // Le titre doit correspondre, à un « (remix) » ou un « feat. » près.
    return t === cible || t.startsWith(cible) || cible.startsWith(t);
  });

  // La plus ancienne parution des correspondances : une chanson de 1985
  // rééditée en 2011 en compilation reste une chanson de 1985.
  let meilleure = null;
  for (const r of candidats) {
    const brut = r['first-release-date'] || '';
    const an = parseInt(String(brut).slice(0, 4), 10);
    if (!an || an < ANNEE_MINI || an > ANNEE_MAXI) continue;
    if (meilleure === null || an < meilleure) meilleure = an;
  }
  return meilleure;
}

async function main() {
  const tracks = store.load(true).tracks;

  // On ne travaille que sur ce qui existe encore sur le disque.
  const presents = new Set(fs.existsSync(MUSIC_DIR) ? fs.readdirSync(MUSIC_DIR) : []);

  const candidats = Object.entries(tracks)
    .filter(([fichier, e]) => presents.has(fichier))
    .filter(([, e]) => (OPT.force || !e.year))
    .filter(([, e]) => e.title && !e.needsReview);

  console.log(`${Object.keys(tracks).length} fiches, ${candidats.length} sans année à chercher.`);
  if (candidats.length === 0) return;

  const cache = chargerCache();
  const maj = {};
  let reseau = 0;
  let trouves = 0;
  let i = 0;

  for (const [fichier, e] of candidats) {
    i++;
    const cle = T.norm(`${e.title} ${e.artist || ''}`);
    if (!cle) continue;

    let annee;
    if (Object.prototype.hasOwnProperty.call(cache, cle)) {
      annee = cache[cle];
    } else if (OPT.cacheOnly || reseau >= OPT.limit) {
      continue;
    } else {
      try {
        annee = await chercherAnnee(e.title, e.artist);
      } catch (err) {
        // Une coupure réseau ne doit pas empiler des « pas d'année » dans le
        // cache : on laisse la clé absente pour réessayer à la prochaine passe.
        console.warn(`\n   (MusicBrainz indisponible : ${err.message})`);
        await sleep(MB_DELAY);
        continue;
      }
      cache[cle] = annee || null;
      reseau++;
      await sleep(MB_DELAY);
      if (reseau % 20 === 0) sauverCache(cache);
    }

    if (annee) {
      maj[fichier] = { year: annee, yearSource: 'musicbrainz' };
      trouves++;
    }

    if (i % 10 === 0 || i === candidats.length) {
      process.stdout.write(`\r  ${i}/${candidats.length} — ${trouves} années trouvées (${reseau} requêtes)`);
    }
  }

  sauverCache(cache);
  console.log('');

  if (Object.keys(maj).length === 0) {
    console.log('Aucune année à écrire.');
    return;
  }

  store.setMany(maj);
  console.log(`\n${Object.keys(maj).length} années écrites dans metadata.json.`);

  // Ce que ça donne : c'est cette répartition qui alimente le filtre décennies.
  const parDecennie = {};
  for (const e of Object.values(store.load(true).tracks)) {
    if (!e.year) continue;
    const d = Math.floor(e.year / 10) * 10;
    parDecennie[d] = (parDecennie[d] || 0) + 1;
  }
  console.log('\nRépartition par décennie :');
  for (const [d, n] of Object.entries(parDecennie).sort()) {
    console.log(`   ${d}s  ${String(n).padStart(5)}`);
  }

  const restants = Object.values(store.load(true).tracks).filter((e) => !e.year).length;
  if (restants) {
    console.log(`\n${restants} morceaux restent sans année (introuvables sur MusicBrainz, ou pas encore cherchés).`);
    console.log('Relance la commande pour continuer : le cache reprend où tu en étais.');
  }
}

main().catch((e) => {
  console.error('\nÉchec :', e);
  process.exit(1);
});
