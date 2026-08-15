#!/usr/bin/env node
'use strict';

/**
 * Enrichissement de la bibliothèque Songless.
 *
 * Passe sur tous les fichiers du dossier musiques/ et remplit metadata.json :
 *   - titre affiché lisible (nettoyé du bruit YouTube, translittéré si besoin)
 *   - titre d'origine conservé à part (пыяла, 一剪梅, ...)
 *   - artiste
 *   - genre
 *   - alias acceptés à la saisie
 *
 * Sources, dans l'ordre de confiance :
 *   1. lib/overrides.json  (noms sous lesquels un morceau est vraiment connu)
 *   2. tags ID3 du fichier
 *   3. MusicBrainz (un appel par artiste unique, pas par morceau)
 *   4. heuristiques sur le nom de fichier
 *
 * Usage :
 *   node tools/enrich.js                 # tout, avec MusicBrainz
 *   node tools/enrich.js --no-network    # hors ligne, heuristiques seules
 *   node tools/enrich.js --force         # réécrit même les entrées déjà validées
 *   node tools/enrich.js --limit 50      # test sur un échantillon
 */

const fs = require('fs');
const path = require('path');
const musicMetadata = require('music-metadata');

const T = require('../lib/titles');
const store = require('../lib/store');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = path.join(ROOT, 'musiques');
const CACHE_DIR = path.join(ROOT, '.cache');
const MB_CACHE = path.join(CACHE_DIR, 'musicbrainz-artists.json');

const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus'];
const USER_AGENT = 'SonglessLocal/1.0 ( https://localhost/songless )';
const MB_DELAY = 1100;              // MusicBrainz : 1 requête/seconde maximum

const args = process.argv.slice(2);
const OPT = {
  network: !args.includes('--no-network'),
  force: args.includes('--force'),
  deep: args.includes('--deep'),   // identification titre par titre : long, peu rentable
  limit: (() => {
    const i = args.indexOf('--limit');
    return i !== -1 ? parseInt(args[i + 1], 10) : Infinity;
  })(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- cache MB

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(MB_CACHE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(MB_CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

// ---------------------------------------------------------------- MusicBrainz

/**
 * Cherche les tags de genre d'un artiste. Un seul appel par artiste unique,
 * mis en cache sur disque : relancer le script ne recoûte rien.
 */
async function fetchArtistGenre(artist, cache) {
  const key = T.norm(artist);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];

  const url = 'https://musicbrainz.org/ws/2/artist?fmt=json&limit=1&query='
    + encodeURIComponent(`artist:"${artist}"`);

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.artists || [])[0];

    let result = null;
    if (hit && (hit.score === undefined || hit.score >= 80)) {
      const tags = (hit.tags || [])
        .filter((t) => (t.count || 0) > 0)
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .map((t) => t.name);
      result = {
        name: hit.name || artist,
        tags,
        country: hit.country || null,
        genre: tags.length ? T.guessGenre(tags) : null,
      };
      if (result.genre === 'Autre') result.genre = null;
    }
    cache[key] = result;
    await sleep(MB_DELAY);   // MusicBrainz impose 1 requête/seconde
    return result;
  } catch (e) {
    console.warn(`   (MusicBrainz indisponible pour "${artist}" : ${e.message})`);
    cache[key] = null;      // on ne réessaie pas en boucle sur la même session
    await sleep(MB_DELAY);
    return null;
  }
}

const REC_CACHE = path.join(CACHE_DIR, 'musicbrainz-recordings.json');

function loadRecordingCache() {
  try {
    return JSON.parse(fs.readFileSync(REC_CACHE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveRecordingCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(REC_CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Identifie un enregistrement à partir de son titre, pour retrouver l'artiste
 * quand le nom de fichier ne le donne pas ("alien blues.mp3").
 */
async function fetchRecording(title, artist, cache) {
  const key = T.norm(`${title} ${artist || ''}`);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];

  const clean = String(title).replace(/["\\]/g, ' ').trim();
  if (clean.length < 3) {
    cache[key] = null;
    return null;
  }
  const q = artist
    ? `recording:"${clean}" AND artist:"${String(artist).replace(/["\\]/g, ' ')}"`
    : `recording:"${clean}"`;
  const url = `https://musicbrainz.org/ws/2/recording?fmt=json&limit=3&query=${encodeURIComponent(q)}`;

  let result = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.recordings || []).find((r) => (r.score || 0) >= 90);
    if (hit) {
      const credit = (hit['artist-credit'] || [])[0];
      result = {
        title: hit.title || clean,
        artist: credit && credit.name ? credit.name : null,
        tags: (hit.tags || []).map((t) => t.name),
      };
    }
  } catch (e) {
    console.warn(`   (MusicBrainz : ${e.message})`);
  }

  cache[key] = result;
  await sleep(MB_DELAY);
  return result;
}

// ---------------------------------------------------------------- résolution

/** Construit l'entrée de métadonnées d'un fichier, hors réseau. */
async function baseEntry(fileName, overrides, swapSet) {
  const filePath = path.join(MUSIC_DIR, fileName);

  let tagTitle = '';
  let tagArtist = '';
  let tagGenre = '';
  let duration = 0;
  let hasCover = false;
  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: true });
    tagTitle = (meta.common.title || '').trim();
    tagArtist = (meta.common.artist || '').trim();
    tagGenre = ((meta.common.genre || [])[0] || '').trim();
    duration = meta.format.duration || 0;
    hasCover = !!(meta.common.picture && meta.common.picture.length > 0);
  } catch (_) {
    /* fichier sans tags lisibles : on se rabat sur le nom */
  }

  const fromName = T.fromFilename(fileName);

  // Un tag ID3 générique ("Track 01", "Audio Track") ne vaut pas mieux que le nom.
  const badTag = /^(track|piste|audio track|untitled|unknown)\b/i;
  const useTagTitle = tagTitle && !badTag.test(tagTitle);

  let title = T.cleanTitle(useTagTitle ? tagTitle : fromName.title) || fromName.cleaned || fileName;
  let artist = T.cleanTitle(tagArtist || fromName.artist);

  // "Titre - Artiste" au lieu de "Artiste - Titre" (rips d'OST) : on remet à l'endroit.
  if (swapSet && swapSet.has(fileName) && fromName.artist) {
    title = T.cleanTitle(fromName.title);
    artist = T.cleanTitle(fromName.artist);
    [title, artist] = [artist, title];
  } else if (title.includes(' - ')) {
    // Le titre porte encore "Artiste - Titre" : on le sépare, et on préfère
    // ce nom-là si le tag ID3 vient d'un ripper ("YTD", "Vibe Music"...).
    const inner = T.splitArtistTitle(title);
    if (inner.artist) {
      const tagIsInFileName = artist && T.tightKey(fileName).includes(T.tightKey(artist));
      if (!artist || !tagIsInFileName) artist = inner.artist;
      title = inner.title;
    }
  }
  let originalTitle = '';
  let genre = null;
  let source = useTagTitle ? 'tags' : 'nom de fichier';
  let needsReview = false;

  // 1. Nom réellement connu du public (Polish Cow, Coffin Dance, ...)
  const ov = T.matchOverride(overrides, title, fromName.cleaned, fileName);
  if (ov) {
    originalTitle = ov.originalTitle || (T.norm(title) !== T.norm(ov.title) ? title : '');
    title = ov.title;
    if (ov.artist) artist = ov.artist;
    if (ov.genre) genre = ov.genre;
    source = 'table de correspondance';
  } else {
    // 2. Alphabet non latin : on translittère et on signale pour relecture.
    const script = T.detectScript(title);
    if (script !== 'latin') {
      const translated = T.cleanTitle(T.translit(title));
      originalTitle = title;
      if (T.isReadableLatin(translated) && T.norm(translated)) {
        title = translated;                       // cyrillique/grec : translittération lisible
        needsReview = true;
      } else {
        needsReview = true;                       // CJK : il faut un vrai nom connu
      }
      source = `translittéré (${script})`;
    }
  }

  if (T.detectScript(artist) !== 'latin') artist = T.translit(artist) || artist;

  // 3. Genre : tag ID3, puis indices du nom de fichier.
  if (!genre && tagGenre) genre = T.resolveGenre(tagGenre);
  if (!genre) {
    const guess = T.guessGenre([fileName, title, originalTitle, artist]);
    if (guess !== 'Autre') genre = guess;
  }

  return {
    fileName,
    title: title.trim(),
    originalTitle: originalTitle.trim(),
    artist: artist.trim(),
    genre,
    duration: Math.round(duration),
    hasCover,
    aliases: [],
    needsReview,
    // L'écriture dans metadata.json fusionne avec l'existant : on remet ce
    // drapeau à plat, sinon une ancienne validation resterait collée à la fiche.
    reviewed: false,
    source,
  };
}

// ---------------------------------------------------------------- programme

async function main() {
  if (!fs.existsSync(MUSIC_DIR)) {
    console.error(`Dossier introuvable : ${MUSIC_DIR}`);
    process.exit(1);
  }

  const overrides = T.loadOverrides();
  const existing = store.load(true).tracks;

  const files = fs.readdirSync(MUSIC_DIR)
    .filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()))
    .slice(0, OPT.limit);

  console.log(`${files.length} fichiers audio détectés.`);
  console.log(`Table de correspondance : ${overrides.length} titres connus.`);
  console.log(OPT.network ? 'MusicBrainz : activé (genres par artiste).' : 'MusicBrainz : désactivé.');
  console.log('');

  // ---- Passe 0 : repérer les noms écrits "Titre - Artiste" plutôt que l'inverse
  const splits = files.map((f) => ({ fileName: f, ...T.fromFilename(f) }));
  const swapSet = T.detectSwappedSides(splits);
  if (swapSet.size) {
    console.log(`${swapSet.size} fichiers écrits « Titre - Artiste » : ordre rétabli.\n`);
  }

  // ---- Passe 1 : lecture des tags + nettoyage des titres
  const entries = {};
  let done = 0;
  for (const file of files) {
    // On respecte une correction manuelle déjà faite, sauf --force.
    const prev = existing[file];
    if (prev && prev.reviewed && !OPT.force) {
      entries[file] = prev;
      done++;
      continue;
    }

    entries[file] = await baseEntry(file, overrides, swapSet);
    done++;
    if (done % 100 === 0 || done === files.length) {
      process.stdout.write(`\r  Lecture des fichiers : ${done}/${files.length}`);
    }
  }
  console.log('\n');

  // ---- Passe 2 : genre via MusicBrainz, un appel par artiste unique
  if (OPT.network) {
    const cache = loadCache();
    const needGenre = Object.values(entries).filter((e) => !e.genre && e.artist);
    const artists = [...new Set(needGenre.map((e) => e.artist))]
      .filter((a) => a.length > 1 && T.norm(a));

    const uncached = artists.filter((a) => !Object.prototype.hasOwnProperty.call(cache, T.norm(a)));
    const eta = Math.ceil((uncached.length * MB_DELAY) / 60000);
    console.log(`${artists.length} artistes sans genre, dont ${uncached.length} à interroger `
      + `(~${eta} min, 1 requête/s imposée par MusicBrainz).`);

    let i = 0;
    for (const artist of artists) {
      const info = await fetchArtistGenre(artist, cache);   // gère lui-même la cadence
      i++;

      if (info && info.genre) {
        for (const e of Object.values(entries)) {
          if (!e.genre && T.norm(e.artist) === T.norm(artist)) e.genre = info.genre;
        }
      }
      if (i % 10 === 0 || i === artists.length) {
        process.stdout.write(`\r  MusicBrainz : ${i}/${artists.length}`);
        saveCache(cache);
      }
    }
    saveCache(cache);
    console.log('\n');
  }

  // ---- Passe 3 : morceaux encore sans genre, souvent parce que le nom de
  // fichier ne contient pas d'artiste. On identifie l'enregistrement, puis on
  // réutilise le cache d'artistes de la passe 2.
  // Passe lente et peu rentable (MusicBrainz connaît mal les titres YouTube) :
  // réservée à --deep.
  if (OPT.network && OPT.deep) {
    const cache = loadCache();
    const recCache = loadRecordingCache();
    const orphans = Object.values(entries).filter((e) => !e.genre && e.title);

    console.log(`${orphans.length} morceaux encore sans genre : identification par titre.`);
    let i = 0;
    let found = 0;

    for (const e of orphans) {
      i++;
      const rec = await fetchRecording(e.title, e.artist, recCache);

      if (rec && rec.artist) {
        if (!e.artist) e.artist = rec.artist;
        const info = await fetchArtistGenre(rec.artist, cache);
        if (info && info.genre) {
          e.genre = info.genre;
          found++;
        }
      }
      if (i % 10 === 0 || i === orphans.length) {
        process.stdout.write(`\r  Identification : ${i}/${orphans.length} — ${found} genres trouvés`);
        saveCache(cache);
        saveRecordingCache(recCache);
      }
    }
    saveCache(cache);
    saveRecordingCache(recCache);
    console.log('\n');
  }

  // ---- Passe 4 : beaucoup de fichiers n'ont pas de séparateur ("Aaron Smith
  // Dancin KRONO Remix") : l'artiste est collé au début du titre. On teste les
  // premiers mots contre MusicBrainz pour retrouver artiste puis genre.
  if (OPT.network) {
    const cache = loadCache();
    const orphans = Object.values(entries).filter((e) => !e.genre && !e.artist && e.title);
    console.log(`${orphans.length} morceaux sans artiste : recherche du nom en tête de titre.`);

    let i = 0;
    let found = 0;
    for (const e of orphans) {
      i++;
      const words = e.title.split(/\s+/).filter(Boolean);
      // Les noms d'artiste font le plus souvent 1 à 3 mots.
      for (const n of [3, 2, 1]) {
        if (words.length < n) continue;
        const candidate = words.slice(0, n).join(' ');
        if (candidate.length < 3) continue;

        const info = await fetchArtistGenre(candidate, cache);
        // On exige que MusicBrainz renvoie exactement ce nom : sinon on
        // rattacherait « A little bit » à un groupe qui n'a rien à voir.
        if (info && T.norm(info.name) === T.norm(candidate)) {
          e.artist = info.name;
          if (info.genre) {
            e.genre = info.genre;
            found++;
          }
          break;
        }
      }
      if (i % 10 === 0 || i === orphans.length) {
        process.stdout.write(`\r  Artistes : ${i}/${orphans.length} — ${found} genres trouvés`);
        saveCache(cache);
      }
    }
    saveCache(cache);
    console.log('\n');
  }

  // ---- Finalisation : genre par défaut + alias
  for (const e of Object.values(entries)) {
    if (!e.genre) e.genre = 'Autre';
    const ov = T.matchOverride(overrides, e.title, e.originalTitle, e.fileName);
    e.aliases = T.buildAliases(
      e.title,
      e.originalTitle,
      ov ? ov.aliases : [],
      e.artist && e.title ? `${e.artist} ${e.title}` : '',
    );
  }

  store.setMany(entries);

  // ---- Rapport
  const all = Object.values(entries);
  const byGenre = {};
  for (const e of all) byGenre[e.genre] = (byGenre[e.genre] || 0) + 1;

  console.log('Répartition par genre :');
  for (const [g, n] of Object.entries(byGenre).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(5)}  ${g}`);
  }

  const review = all.filter((e) => e.needsReview);
  console.log(`\n${all.length} morceaux écrits dans metadata.json.`);
  if (review.length) {
    console.log(`\n${review.length} titres à revoir (alphabet non latin) :`);
    for (const e of review.slice(0, 40)) {
      console.log(`   ${e.title}   ←  ${e.originalTitle || e.fileName}`);
    }
    if (review.length > 40) console.log(`   ... et ${review.length - 40} autres`);
    console.log('\nCorrige-les depuis l\'onglet Bibliothèque du site, ou avec :');
    console.log('   node tools/retitle.js "<nom de fichier>" --title "Nom connu" --genre "Meme / Internet"');
  }
}

main().catch((e) => {
  console.error('\nÉchec :', e);
  process.exit(1);
});
