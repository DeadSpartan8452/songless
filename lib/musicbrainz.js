'use strict';

/**
 * Interrogation de MusicBrainz pour deviner le genre d'un artiste.
 *
 * Partagé entre l'enrichissement en masse (tools/enrich.js) et l'ajout d'un
 * morceau (lib/downloader.js), pour qu'une musique téléchargée reçoive
 * exactement le même traitement que le reste de la bibliothèque.
 *
 * MusicBrainz impose une requête par seconde. Le cache disque évite de
 * réinterroger un artiste déjà connu : ajouter un morceau d'un artiste déjà
 * présent ne coûte donc rien.
 */

const fs = require('fs');
const path = require('path');
const T = require('./titles');

const CACHE_DIR = process.env.SONGLESS_CACHE_DIR
  ? path.resolve(process.env.SONGLESS_CACHE_DIR)
  : path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'musicbrainz-artists.json');
// v3 corrige la reconstruction des crédits à plusieurs artistes. Les anciens
// résultats ne sont pas repris afin de ne jamais appliquer un artiste tronqué.
const RECORDING_CACHE_FILE = path.join(CACHE_DIR, 'musicbrainz-recordings-v3.json');
const USER_AGENT = 'SonglessLocal/1.0 ( https://localhost/songless )';
const DELAI = 1100;

let cache = null;
let recordingCache = null;
let dernierAppel = 0;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function charger() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (_) {
    cache = {};
  }
  return cache;
}

function sauver() {
  if (!cache) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.warn('Cache MusicBrainz non enregistré :', e.message);
  }
}

function chargerEnregistrements() {
  if (recordingCache) return recordingCache;
  try {
    recordingCache = JSON.parse(fs.readFileSync(RECORDING_CACHE_FILE, 'utf8'));
  } catch (_) {
    recordingCache = {};
  }
  return recordingCache;
}

function sauverEnregistrements() {
  if (!recordingCache) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      RECORDING_CACHE_FILE,
      JSON.stringify(recordingCache, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn('Cache des morceaux MusicBrainz non enregistré :', e.message);
  }
}

function cleEnregistrement(titre, artiste = '') {
  const titreNet = String(titre || '').replace(/["\\]/g, ' ').trim();
  const artisteNet = String(artiste || '').replace(/["\\]/g, ' ').trim();
  const brut = `${titreNet}\u0000${artisteNet}`;
  return T.norm(brut) || brut.normalize('NFKC').toLocaleLowerCase();
}

function enregistrementDansCache(titre, artiste = '') {
  const cle = cleEnregistrement(titre, artiste);
  return Boolean(cle && Object.prototype.hasOwnProperty.call(chargerEnregistrements(), cle));
}

/** Respecte la cadence imposée, sans attendre si le dernier appel est ancien. */
async function attendreCadence() {
  const ecoule = Date.now() - dernierAppel;
  if (ecoule < DELAI) await dormir(DELAI - ecoule);
  dernierAppel = Date.now();
}

async function fetchAvecReprises(url) {
  let derniereErreur = null;
  for (let tentative = 0; tentative < 3; tentative++) {
    await attendreCadence();
    let res = null;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (error) {
      derniereErreur = error;
    }
    if (res && res.ok) return res;
    if (res) {
      derniereErreur = new Error(`HTTP ${res.status}`);
      if (![429, 502, 503, 504].includes(res.status)) throw derniereErreur;
    }
    if (tentative < 2) {
      const retryAfter = Number(res && res.headers && res.headers.get
        ? res.headers.get('retry-after') : 0);
      const attente = retryAfter > 0
        ? Math.min(retryAfter * 1000, 15000)
        : 2000 * (2 ** tentative);
      await dormir(attente);
    }
  }
  throw derniereErreur || new Error('Service indisponible');
}

/**
 * Renvoie { name, tags, genre } pour un artiste, ou null.
 * Le résultat est mis en cache, y compris une recherche terminée sans résultat.
 * Les pannes temporaires restent volontairement à retenter.
 */
async function genreArtiste(artiste, { silencieux = true } = {}) {
  const cle = T.norm(artiste);
  if (!cle || cle.length < 2) return null;

  const c = charger();
  if (Object.prototype.hasOwnProperty.call(c, cle)) {
    const cached = c[cle];
    if (cached && cached.notFound === true) return null;
    // Les anciens `null` pouvaient aussi provenir d'une panne réseau. Ils sont
    // donc retraités une fois, puis remplacés par un négatif explicite.
    if (cached !== null && cached !== undefined) return cached;
  }

  const url = 'https://musicbrainz.org/ws/2/artist?fmt=json&limit=1&query='
    + encodeURIComponent(`artist:"${String(artiste).replace(/["\\]/g, ' ')}"`);

  let resultat = null;
  let rechercheTerminee = false;
  try {
    const res = await fetchAvecReprises(url);

    const data = await res.json();
    rechercheTerminee = true;
    const hit = (data.artists || [])[0];
    if (hit && (hit.score === undefined || hit.score >= 80)) {
      const tags = (hit.tags || [])
        .filter((t) => (t.count || 0) > 0)
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .map((t) => t.name);
      const genre = tags.length ? T.guessGenre(tags) : null;
      resultat = {
        name: hit.name || artiste,
        tags,
        genre: genre === 'Autre' ? null : genre,
      };
    }
  } catch (e) {
    if (!silencieux) console.warn(`MusicBrainz indisponible pour « ${artiste} » : ${e.message}`);
  }

  // Un vrai résultat vide peut être mémorisé. Une panne temporaire, elle, doit
  // rester à retenter lors de la prochaine passe.
  if (rechercheTerminee) {
    c[cle] = resultat || { notFound: true };
    sauver();
  }
  return resultat;
}

/**
 * L'artiste est-il déjà connu du cache ?
 * Permet à l'appelant de ne pas décompter un budget réseau pour une réponse
 * qui ne coûtera aucune requête.
 */
function dansLeCache(artiste) {
  const cle = T.norm(artiste);
  if (!cle || cle.length < 2) return false;
  const c = charger();
  return Object.prototype.hasOwnProperty.call(c, cle) && c[cle] !== null;
}

function anneeDepuisEnregistrement(hit) {
  const valeurs = [hit['first-release-date']]
    .concat((hit.releases || []).map((release) => release.date))
    .map((value) => Number(String(value || '').slice(0, 4)))
    .filter((year) => year >= 1900 && year <= new Date().getFullYear() + 1);
  return valeurs.length ? Math.min(...valeurs) : null;
}

function artisteDepuisEnregistrement(hit) {
  return (hit['artist-credit'] || [])
    .map((credit) => {
      if (!credit) return '';
      const name = credit.name || (credit.artist && credit.artist.name) || '';
      return name ? `${name}${credit.joinphrase || ''}` : '';
    })
    .filter(Boolean)
    .join('')
    .trim();
}

function albumDepuisEnregistrement(hit) {
  const releases = (hit.releases || []).filter((release) => release && release.title);
  releases.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
  return releases.length ? releases[0].title : null;
}

/**
 * Identifie un morceau et récupère son artiste et sa première année de sortie.
 * Seules les correspondances fortes sont acceptées automatiquement. Les
 * résultats ambigus restent dans la file de validation manuelle.
 */
async function enregistrement(titre, artiste = '', { silencieux = true } = {}) {
  const titreNet = String(titre || '').replace(/["\\]/g, ' ').trim();
  const artisteNet = String(artiste || '').replace(/["\\]/g, ' ').trim();
  const cle = cleEnregistrement(titreNet, artisteNet);
  if (!cle) return null;

  const c = chargerEnregistrements();
  if (Object.prototype.hasOwnProperty.call(c, cle)) return c[cle];
  if (titreNet.length < 2) {
    c[cle] = null;
    sauverEnregistrements();
    return null;
  }

  const query = artisteNet
    ? `recording:"${titreNet}" AND artist:"${artisteNet}"`
    : `recording:"${titreNet}"`;
  const url = 'https://musicbrainz.org/ws/2/recording?fmt=json&limit=5&query='
    + encodeURIComponent(query);

  let resultat = null;
  try {
    const res = await fetchAvecReprises(url);
    const data = await res.json();
    const candidats = (data.recordings || []).map((hit) => {
      const hitArtist = artisteDepuisEnregistrement(hit);
      const titreExact = T.norm(hit.title) === T.norm(titreNet);
      const artisteExact = !artisteNet || T.norm(hitArtist) === T.norm(artisteNet);
      return { hit, hitArtist, titreExact, artisteExact, score: Number(hit.score || 0) };
    });
    const forts = candidats.filter((item) => item.score >= 95
      && item.titreExact && item.artisteExact);
    // Sans artiste connu, un titre courant peut désigner plusieurs morceaux.
    // On refuse alors de choisir arbitrairement le premier résultat.
    const choix = artisteNet ? forts[0] : (forts.length === 1 ? forts[0] : null);

    if (choix) {
      const tags = (choix.hit.tags || [])
        .filter((tag) => (tag.count || 0) > 0)
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .map((tag) => tag.name);
      const genre = T.guessGenre(tags);
      resultat = {
        id: choix.hit.id || null,
        title: choix.hit.title || titreNet,
        artist: choix.hitArtist || artisteNet || null,
        year: anneeDepuisEnregistrement(choix.hit),
        album: albumDepuisEnregistrement(choix.hit),
        tags,
        genre: genre === 'Autre' ? null : genre,
        score: choix.score,
        confidence: 'medium',
      };
    }
    c[cle] = resultat;
    sauverEnregistrements();
  } catch (e) {
    // Une panne réseau ne doit pas être mémorisée comme un résultat négatif :
    // la prochaine relance reprendra automatiquement ce morceau.
    if (!silencieux) {
      console.warn(`MusicBrainz indisponible pour « ${titreNet} » : ${e.message}`);
    }
  }
  return resultat;
}

module.exports = {
  genreArtiste,
  enregistrement,
  dansLeCache,
  charger,
  sauver,
  chargerEnregistrements,
  sauverEnregistrements,
  enregistrementDansCache,
  CACHE_FILE,
  RECORDING_CACHE_FILE,
};
