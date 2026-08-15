'use strict';

/**
 * Normalisation des titres pour Songless.
 *
 * Objectif : transformer un nom de fichier brut ("Дискотека - Пыяла (Official Video).mp3")
 * en quelque chose qu'un joueur francophone peut lire ET taper.
 *  - anglais / français : on garde, on nettoie juste le bruit YouTube
 *  - alphabets non latins : on translittère, et on privilégie le nom sous lequel
 *    le morceau est réellement connu (table overrides.json)
 */

const fs = require('fs');
const path = require('path');

const GENRES = [
  'Rap / Hip-Hop',
  'Pop',
  'Rock',
  'Metal',
  'Électro / EDM',
  'Jeu vidéo',
  'Anime / J-Music',
  'Film / Série',
  'Meme / Internet',
  'Variété française',
  'Latino',
  'Jazz / Soul / Funk',
  'Classique',
  'Reggae',
  'Country',
  'Traditionnel',
  'Autre',
];

// Indices pour deviner un genre depuis des tags (MusicBrainz) ou un nom de fichier.
const GENRE_HINTS = {
  'Rap / Hip-Hop': ['hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'grime', 'freestyle', 'boom bap'],
  'Pop': ['pop', 'k-pop', 'kpop', 'synthpop', 'dance-pop', 'europop', 'teen pop'],
  'Rock': ['rock', 'punk', 'indie', 'grunge', 'alternative', 'emo', 'post-rock'],
  'Metal': ['metal', 'metalcore', 'deathcore', 'hardcore', 'thrash', 'djent'],
  'Électro / EDM': ['electro', 'électro', 'edm', 'house', 'techno', 'trance', 'dubstep',
    'drum and bass', 'drum n bass', 'dnb', 'hardstyle', 'synthwave', 'phonk', 'eurodance'],
  'Jeu vidéo': ['video game', 'videogame', 'vgm', 'game soundtrack', 'jeu video', 'jeu vidéo',
    'nintendo', 'undertale', 'minecraft', 'zelda', 'pokemon', 'pokémon', 'sonic', 'mario',
    'five nights at freddy', 'fnaf', 'among us', 'terraria', 'omori', 'deltarune', 'portal',
    'skyrim', 'doom', 'halo', 'kirby', 'splatoon', 'solatorobo', 'hollow knight', 'celeste',
    'persona', 'final fantasy', 'genshin', 'friday night funkin', 'fnf', 'geometry dash'],
  'Anime / J-Music': ['anime', 'j-pop', 'jpop', 'j-rock', 'vocaloid', 'touhou', 'utaite',
    'opening', 'ending', 'hatsune miku', 'nightcore', 'weeb'],
  'Film / Série': ['soundtrack', 'film score', 'movie', 'bande originale', 'score', 'ost',
    'musical', 'disney', 'hazbin hotel', 'helluva boss', 'steven universe'],
  'Meme / Internet': ['meme', 'parody', 'parodie', 'tiktok', 'youtube poop', 'shitpost', 'remix meme'],
  'Variété française': ['chanson francaise', 'chanson française', 'variete', 'variété',
    'french pop', 'nouvelle chanson'],
  'Latino': ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'brazilian', 'funk carioca'],
  'Jazz / Soul / Funk': ['jazz', 'soul', 'funk', 'blues', 'r&b', 'rnb', 'motown', 'swing', 'bossa'],
  'Classique': ['classical', 'classique', 'orchestra', 'orchestral', 'opera', 'baroque',
    'romantic', 'symphony', 'piano solo'],
  'Reggae': ['reggae', 'ska', 'dancehall', 'dub'],
  'Country': ['country', 'bluegrass', 'americana', 'honky tonk'],
  'Traditionnel': ['folk', 'traditional', 'traditionnel', 'hymne', 'anthem', 'celtic', 'medieval'],
};

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

// Lettres latines que la décomposition Unicode (NFD) ne sait pas ramener à
// leur base : sans ça « biały » devient « biay » et ne matche plus « bialy ».
const LATIN_EXTRA = {
  ł: 'l', đ: 'd', ð: 'd', ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss',
  þ: 'th', ı: 'i', ŧ: 't', ħ: 'h', ŋ: 'n', ĸ: 'k', ə: 'e',
};

const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k',
  λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't',
  υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

// Bruit typique des titres YouTube / téléchargements.
const NOISE_PATTERNS = [
  /\b(official\s+)?(music\s+)?video\s*(clip)?\b/gi,
  /\bofficial\s+(audio|visualizer|lyric\s*video|version|hd\s*video)\b/gi,
  /\bofficial\b/gi,
  /\bclip\s+officiel\b/gi,
  /\b(audio|vid[ée]o)\s+officiel(le)?\b/gi,
  /\bwith\s+lyrics\b/gi,
  /\blyrics?\s*(video)?\b/gi,
  /\bparoles?\s*(compl[ée]t[ée]e?s?)?\b/gi,
  /\bsous[- ]titres?\b/gi,
  /\bvostfr\b/gi,
  /\b(hd|hq|4k|8k|1080p|720p|60fps)\b/gi,
  /\bremaster(ed)?(\s*\d{4})?\b/gi,
  /\bfull\s+(song|version|album|ep)\b/gi,
  /\bradio\s+edit\b/gi,
  /\bcolor\s+coded\b/gi,
  /\bfree\s+download\b/gi,
  /\bout\s+now\b/gi,
  /\bexplicit\b/gi,
  /\bclean\s+version\b/gi,
  /\bvisualizer\b/gi,
  /\baudio\s+only\b/gi,
  /\bbass\s*boosted\b/gi,
  /\b\d{2,3}\s*kbps\b/gi,
  // "_CBR_256k" : le souligné est un caractère de mot, \b ne suffit pas ici.
  /[_\s-]+(cbr|vbr|abr)[_\s-]*\d{0,3}\s*k?(?![a-z])/gi,
  /[_\s-]+\d{2,3}\s*k(?![a-z])/gi,
  /\byoutube\s*(to\s*mp3|converter|dl)\b/gi,
  /\bytd\b/gi,
  /\bprod\.?\s+by\s+[^\-\(\)\[\]]*/gi,
  /\s*-\s*topic\b/gi,
  /\bm\/?v\b/g,
  /\bpv\b/gi,
];

// Identifiants YouTube en fin de nom : [dQw4w9WgXcQ]
const YT_ID = /\s*[\[\(][A-Za-z0-9_-]{11}[\]\)]\s*/g;
// Extensions parasites laissées dans le nom : ".wmv.mp3", ".webm"
const STRAY_EXT = /\.(wmv|webm|mp4|mkv|avi|flv|m4v|mov)\b/gi;
// Numéro de piste en début : "01 ", "05. ", "12 - "
const TRACK_NUM = /^\s*\d{1,3}\s*[-.)]?\s+/;
const FEAT = /\s*[\(\[]?\s*\b(feat\.?|ft\.?|featuring|avec)\b\s+/i;

// ---------------------------------------------------------------- helpers

function translit(str) {
  if (!str) return '';
  let out = '';
  for (const ch of str) {
    const low = ch.toLowerCase();
    const map = CYRILLIC[low] !== undefined ? CYRILLIC[low]
      : GREEK[low] !== undefined ? GREEK[low]
        : LATIN_EXTRA[low] !== undefined ? LATIN_EXTRA[low]
          : null;
    if (map === null) {
      out += ch;
    } else if (ch !== low && map) {
      out += map.charAt(0).toUpperCase() + map.slice(1);
    } else {
      out += map;
    }
  }
  return out;
}

/** Clé de comparaison : minuscules, sans accents, sans ponctuation. */
function norm(str) {
  if (!str) return '';
  return translit(String(str))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Clé ultra-tolérante : uniquement lettres et chiffres. */
function tightKey(str) {
  return norm(str).replace(/ /g, '');
}

/** Le texte est-il lisible/tapable avec un clavier latin ? */
function isReadableLatin(str) {
  const letters = String(str || '').match(/\p{L}/gu);
  if (!letters || letters.length === 0) return true;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin / letters.length > 0.85;
}

/** Détecte l'écriture dominante, pour signaler ce qui a besoin d'un vrai nom connu. */
function detectScript(str) {
  const s = String(str || '');
  if (/[Ѐ-ӿ]/.test(s)) return 'cyrillique';
  if (/[぀-ヿ]/.test(s)) return 'japonais';
  if (/[一-鿿]/.test(s)) return 'chinois';
  if (/[가-힯]/.test(s)) return 'coréen';
  if (/[؀-ۿ]/.test(s)) return 'arabe';
  if (/[֐-׿]/.test(s)) return 'hébreu';
  if (/[฀-๿]/.test(s)) return 'thaï';
  if (/[Ͱ-Ͽ]/.test(s)) return 'grec';
  return 'latin';
}

/** Retire le bruit (mentions YouTube, ids, extensions parasites). */
function cleanTitle(raw) {
  let t = String(raw || '');
  // NFKC ramène les fantaisies typographiques (𝚖𝚊𝚝𝚞𝚜𝚑𝚔𝚊, ｆｕｌｌｗｉｄｔｈ) en texte normal.
  try { t = t.normalize('NFKC'); } catch (_) { /* chaîne exotique : tant pis */ }
  t = t.replace(YT_ID, ' ');
  t = t.replace(STRAY_EXT, ' ');
  for (const re of NOISE_PATTERNS) t = t.replace(re, ' ');
  // Parenthèses/crochets devenus vides après nettoyage
  t = t.replace(/[\(\[\{]\s*[\)\]\}]/g, ' ');
  // Parenthèse ouverte jamais refermée
  t = t.replace(/\s*[\(\[]\s*$/g, ' ');
  t = t.replace(/\s{2,}/g, ' ');
  return t.replace(/^[\s\-–—_·•.,|]+|[\s\-–—_·•.,|]+$/g, '').trim();
}

/** Sépare "Artiste - Titre" quand un séparateur crédible existe. */
function splitArtistTitle(raw) {
  const s = String(raw || '').trim();
  for (const sep of [' - ', ' – ', ' — ', ' _ ', ' ~ ']) {
    const i = s.indexOf(sep);
    if (i > 0) {
      const artist = s.slice(0, i).trim();
      const title = s.slice(i + sep.length).trim();
      if (artist && title) return { artist, title };
    }
  }
  return { artist: '', title: s };
}

/**
 * "A - B" est ambigu : parfois "Artiste - Titre", parfois "Titre - Artiste"
 * (typique des rips d'OST : "01 Verdant Vizsla - LieN (Solatorobo OST)").
 *
 * Le signal fiable est la répétition : sur un lot de fichiers, le côté qui
 * revient à l'identique est l'artiste/l'album, l'autre est le titre.
 * Renvoie l'ensemble des noms de fichiers dont les deux côtés sont à inverser.
 */
function detectSwappedSides(splits) {
  const leftCount = new Map();
  const rightCount = new Map();

  for (const s of splits) {
    if (!s.artist) continue;
    const l = norm(s.artist);
    const r = norm(s.title);
    if (l) leftCount.set(l, (leftCount.get(l) || 0) + 1);
    if (r) rightCount.set(r, (rightCount.get(r) || 0) + 1);
  }

  const swap = new Set();
  for (const s of splits) {
    if (!s.artist) continue;
    const lc = leftCount.get(norm(s.artist)) || 0;
    const rc = rightCount.get(norm(s.title)) || 0;
    if (rc >= 3 && rc > lc) swap.add(s.fileName);
  }
  return swap;
}

/** Prépare un nom de fichier pour la recherche / l'affichage. */
function fromFilename(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '');
  let t = base.replace(TRACK_NUM, '');
  t = cleanTitle(t);
  const { artist, title } = splitArtistTitle(t);
  return { artist, title: title || t, cleaned: t };
}

/** Enlève le "feat. X" de fin pour l'affichage compact. */
function stripFeat(str) {
  const s = String(str || '');
  const m = s.match(FEAT);
  if (!m) return s.trim();
  return s.slice(0, m.index).replace(/[\s\-–—(,\[]+$/, '').trim() || s.trim();
}

// ---------------------------------------------------------------- overrides

let _overrides = null;

function loadOverrides(file) {
  if (_overrides && !file) return _overrides;
  const p = file || path.join(__dirname, 'overrides.json');
  let data = { overrides: [] };
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('overrides.json illisible :', e.message);
  }
  const table = (data.overrides || []).map((entry) => ({
    keys: (entry.match || []).map(tightKey).filter(Boolean),
    title: entry.title,
    originalTitle: entry.originalTitle || '',
    artist: entry.artist || '',
    aliases: entry.aliases || [],
    genre: entry.genre || '',
  }));
  if (!file) _overrides = table;
  return table;
}

/**
 * Cherche une correspondance dans la table des titres connus.
 * On teste chaque clé en "contient" sur la version compactée : ça attrape
 * "Gdzie jest bialy wegorz (Polish Cow) [officiel]" comme "gdzie jest biały węgorz".
 */
function matchOverride(table, ...candidates) {
  const keys = candidates.filter(Boolean).map(tightKey).filter((k) => k.length > 2);
  if (keys.length === 0) return null;
  let best = null;
  for (const entry of table) {
    for (const key of entry.keys) {
      if (key.length < 3) continue;
      for (const cand of keys) {
        if (cand === key || cand.includes(key)) {
          // On préfère la correspondance la plus longue (la plus spécifique).
          if (!best || key.length > best.keyLength) best = { entry, keyLength: key.length };
        }
      }
    }
  }
  return best ? best.entry : null;
}

// ---------------------------------------------------------------- genres

/** Fait correspondre une saisie libre à la liste canonique. */
function resolveGenre(value) {
  if (!value) return null;
  const n = norm(value);
  if (!n) return null;
  for (const g of GENRES) if (norm(g) === n) return g;
  for (const g of GENRES) if (norm(g).includes(n) || n.includes(norm(g))) return g;
  return guessGenre([value]) !== 'Autre' ? guessGenre([value]) : null;
}

/**
 * Devine un genre à partir de morceaux de texte (tags MusicBrainz, nom de fichier, artiste).
 * Les indices courts ("rap", "pop", "ost") doivent être des mots isolés, sinon
 * "rapide" deviendrait du rap et "Popeye" de la pop.
 */
function guessGenre(parts) {
  const hay = ' ' + norm(parts.filter(Boolean).join(' ')) + ' ';
  let best = null;
  for (const [genre, hints] of Object.entries(GENRE_HINTS)) {
    for (const hint of hints) {
      const h = norm(hint);
      if (!h) continue;
      const found = h.length <= 5
        ? new RegExp(`(^| )${h}( |$)`).test(hay)
        : hay.includes(h);
      // Un indice long est plus spécifique qu'un indice court : il gagne.
      if (found && (!best || h.length > best.len)) best = { genre, len: h.length };
    }
  }
  return best ? best.genre : 'Autre';
}

/** Construit la liste des réponses acceptées pour un morceau. */
function buildAliases(...values) {
  const set = new Set();
  for (const v of values.flat()) {
    if (!v) continue;
    const s = String(v);
    for (const variant of [s, translit(s), stripFeat(s), s.replace(/\s*\([^)]*\)/g, '')]) {
      const k = norm(variant);
      if (k && k.length > 1) set.add(k);
    }
  }
  return [...set].sort();
}

module.exports = {
  GENRES,
  GENRE_HINTS,
  translit,
  norm,
  tightKey,
  isReadableLatin,
  detectScript,
  cleanTitle,
  splitArtistTitle,
  detectSwappedSides,
  fromFilename,
  stripFeat,
  loadOverrides,
  matchOverride,
  resolveGenre,
  guessGenre,
  buildAliases,
};
