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

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'musicbrainz-artists.json');
const USER_AGENT = 'SonglessLocal/1.0 ( https://localhost/songless )';
const DELAI = 1100;

let cache = null;
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

/** Respecte la cadence imposée, sans attendre si le dernier appel est ancien. */
async function attendreCadence() {
  const ecoule = Date.now() - dernierAppel;
  if (ecoule < DELAI) await dormir(DELAI - ecoule);
  dernierAppel = Date.now();
}

/**
 * Renvoie { name, tags, genre } pour un artiste, ou null.
 * Le résultat est mis en cache, y compris les échecs.
 */
async function genreArtiste(artiste, { silencieux = true } = {}) {
  const cle = T.norm(artiste);
  if (!cle || cle.length < 2) return null;

  const c = charger();
  if (Object.prototype.hasOwnProperty.call(c, cle)) return c[cle];

  const url = 'https://musicbrainz.org/ws/2/artist?fmt=json&limit=1&query='
    + encodeURIComponent(`artist:"${String(artiste).replace(/["\\]/g, ' ')}"`);

  let resultat = null;
  try {
    await attendreCadence();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
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

  c[cle] = resultat;
  sauver();
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
  return Object.prototype.hasOwnProperty.call(charger(), cle);
}

module.exports = { genreArtiste, dansLeCache, charger, sauver, CACHE_FILE };
