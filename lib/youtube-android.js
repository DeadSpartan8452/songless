'use strict';

/**
 * Moteur YouTube sans binaire externe pour l'hôte Android.
 *
 * youtubei.js interroge l'API interne publique, puis le client iOS fournit un
 * flux M4A déjà encodé. Songless n'a donc ni Python, ni yt-dlp, ni conversion
 * ffmpeg à embarquer dans l'APK. Windows continue d'utiliser ses outils
 * historiques dans downloader.js.
 */

const fs = require('fs');
const path = require('path');

const IOS_USER_AGENT =
  'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)';
// Les CDN YouTube refusent certains grands intervalles avec 403. Un mébioctet
// reste accepté de façon stable et borne aussi la mémoire du téléphone.
const CHUNK_BYTES = 1024 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
let enginePromise = null;

function available() {
  try {
    require.resolve('youtubei.js/package.json');
    return true;
  } catch (_) {
    return false;
  }
}

async function engine() {
  if (!enginePromise) {
    enginePromise = import('youtubei.js')
      .then(({Innertube}) => Innertube.create({retrieve_player: false}))
      .catch(error => {
        enginePromise = null;
        throw error;
      });
  }
  return enginePromise;
}

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function parseCount(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

function extractVideoId(value) {
  const parsed = new URL(String(value));
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  let id = '';
  if (host === 'youtu.be') id = parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    id = parsed.searchParams.get('v') || '';
    if (!id) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1] || '';
    }
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Identifiant de vidéo YouTube invalide.');
  return id;
}

function extractPlaylistId(value) {
  const parsed = new URL(String(value));
  const id = parsed.searchParams.get('list') || '';
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw new Error('Identifiant de playlist YouTube invalide.');
  return id;
}

function resultToCandidate(item) {
  const id = item && (item.id || item.video_id);
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) return null;
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: text(item.title),
    channel: text(item.author && (item.author.name || item.author)),
    uploader: text(item.author && (item.author.name || item.author)),
    duration: Number(item.duration && item.duration.seconds) || 0,
    view_count: parseCount(item.view_count && (item.view_count.text || item.view_count)),
    channel_is_verified: !!(item.author && item.author.is_verified),
  };
}

async function searchVideos(query, limit = 6) {
  const youtube = await engine();
  const search = await youtube.search(String(query), {type: 'video'});
  return [...(search.results || [])]
    .map(resultToCandidate)
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 20)));
}

function infoToMetadata(info, id) {
  const basic = info && info.basic_info || {};
  const author = basic.channel && (basic.channel.name || basic.channel.title)
    || basic.author || basic.owner_channel_name || '';
  return {
    id,
    title: text(basic.title),
    uploader: text(author),
    channel: text(author),
    duration: Number(basic.duration) || 0,
    view_count: Number(basic.view_count) || 0,
    upload_date: basic.upload_date || null,
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
    categories: [],
    tags: Array.isArray(basic.tags) ? basic.tags : [],
  };
}

async function getInfo(value) {
  const id = /^[A-Za-z0-9_-]{11}$/.test(String(value))
    ? String(value) : extractVideoId(value);
  const youtube = await engine();
  const info = await youtube.getBasicInfo(id, {client: 'IOS'});
  return infoToMetadata(info, id);
}

async function listPlaylist(value, limit = 100) {
  const id = extractPlaylistId(value);
  const youtube = await engine();
  let page = await youtube.getPlaylist(id);
  const title = text(page && page.info && page.info.title) || 'Playlist YouTube';
  const entries = [];
  const maximum = Math.max(1, Math.min(Number(limit) || 100, 5001));

  while (page && entries.length < maximum) {
    for (const item of page.items || []) {
      const candidate = resultToCandidate(item);
      if (candidate) entries.push(candidate);
      if (entries.length >= maximum) break;
    }
    if (entries.length >= maximum || !page.has_continuation) break;
    page = await page.getContinuation();
  }

  return {
    title,
    entries,
  };
}

function validateStreamUrl(value) {
  const parsed = new URL(String(value));
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.protocol !== 'https:' || (host !== 'googlevideo.com' && !host.endsWith('.googlevideo.com'))) {
    throw new Error('Adresse du flux audio YouTube refusée.');
  }
  if (parsed.username || parsed.password) throw new Error('Adresse du flux audio invalide.');
  return parsed;
}

function rangeUrl(value, start, end) {
  const parsed = validateStreamUrl(value);
  parsed.searchParams.set('range', `${start}-${end}`);
  return parsed.toString();
}

async function fetchChunk(url, fetchImpl) {
  const response = await fetchImpl(url, {headers: {
    accept: '*/*',
    origin: 'https://www.youtube.com',
    referer: 'https://www.youtube.com/',
    'user-agent': IOS_USER_AGENT,
  }});
  if (!response.ok) throw new Error(`Flux audio refusé par YouTube (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function downloadFormat(format, destination, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Téléchargement réseau indisponible sur cet appareil.');
  const total = Number(format && format.content_length);
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_AUDIO_BYTES) {
    throw new Error('Taille du flux audio absente ou excessive.');
  }
  validateStreamUrl(format.url);
  const resolved = path.resolve(destination);
  const partial = `${resolved}.partial`;
  fs.mkdirSync(path.dirname(resolved), {recursive: true});
  fs.rmSync(partial, {force: true});
  let written = 0;
  try {
    for (let start = 0; start < total; start += CHUNK_BYTES) {
      const end = Math.min(total - 1, start + CHUNK_BYTES - 1);
      const chunk = await fetchChunk(rangeUrl(format.url, start, end), fetchImpl);
      const expected = end - start + 1;
      if (chunk.length !== expected) throw new Error('YouTube a renvoyé un fragment audio incomplet.');
      fs.appendFileSync(partial, chunk);
      written += chunk.length;
      if (options.onProgress) options.onProgress(written, total);
    }
    if (written !== total) throw new Error('Le téléchargement audio est incomplet.');
    fs.renameSync(partial, resolved);
    return {bytes: written};
  } catch (error) {
    fs.rmSync(partial, {force: true});
    throw error;
  }
}

async function downloadAudio(videoId, destination, options = {}) {
  const id = String(videoId || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Identifiant de vidéo YouTube invalide.');
  const youtube = await engine();
  const info = await youtube.getBasicInfo(id, {client: 'IOS'});
  const format = info.chooseFormat({type: 'audio', quality: 'best', format: 'mp4'});
  if (!format || !format.url) throw new Error('YouTube ne fournit aucun flux audio M4A compatible.');
  return downloadFormat(format, destination, options);
}

module.exports = {
  CHUNK_BYTES,
  IOS_USER_AGENT,
  MAX_AUDIO_BYTES,
  available,
  downloadAudio,
  downloadFormat,
  extractPlaylistId,
  extractVideoId,
  getInfo,
  infoToMetadata,
  listPlaylist,
  rangeUrl,
  resultToCandidate,
  searchVideos,
  validateStreamUrl,
};
