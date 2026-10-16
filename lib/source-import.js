'use strict';
const balance = require('../public/source-balance');
function parseSources(lines) {
  const rows = String(lines || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  if (rows.length < 2 || rows.length > 20) throw new Error('Indique entre 2 et 20 playlists, une par ligne.');
  const personKey = value => String(value || '').normalize('NFKC').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim();
  const seen = new Map();
  for (const row of rows) {
    const separator = row.lastIndexOf('|');
    const label = separator < 0 ? '' : row.slice(0, separator).trim().slice(0,100);
    const value = separator < 0 ? row : row.slice(separator + 1).trim();
    let url; try {url = new URL(value);} catch (_) {throw new Error('Adresse de playlist invalide.');}
    if (url.protocol !== 'https:' || url.username || url.password
      || !['www.youtube.com', 'youtube.com', 'music.youtube.com'].includes(url.hostname.toLowerCase())) {
      throw new Error('Utilise un lien HTTPS de playlist YouTube ou YouTube Music.');
    }
    const playlistId = url.searchParams.get('list');
    if (!playlistId || !/^[a-zA-Z0-9_-]{10,100}$/.test(playlistId)) throw new Error('Le lien doit contenir une playlist (list=…).');
    if (seen.has(playlistId)) {
      if (personKey(seen.get(playlistId).label) !== personKey(label)) throw new Error('Une même playlist ne peut pas appartenir à deux sources.');
      continue;
    }
    seen.set(playlistId, {playlistId,label,url:'https://www.youtube.com/playlist?list='+playlistId});
  }
  if (seen.size < 2) throw new Error('Il faut au moins deux playlists différentes.');
  return [...seen.values()];
}
async function prepare({lines,count,seed}, {listPlaylist, existingVideoIds = [], ownerProfiles, onLog = () => {}}) {
  const requested = Number(count);
  if (!Number.isInteger(requested) || requested < 1 || requested > 20000) throw new Error('Choisis entre 1 et 20 000 chansons.');
  const parsed = parseSources(lines), groups = new Map(), warnings = [], seen = new Set(existingVideoIds);
  const requireOwner = Array.isArray(ownerProfiles);
  const profiles = requireOwner ? ownerProfiles : [];
  if (requireOwner && profiles.length === 0) throw new Error('Crée au moins un profil Songless avant d’importer des playlists.');
  const personKey = value => String(value || '').normalize('NFKC').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim();
  for (const row of parsed) {
    if (requireOwner && !row.label) throw new Error('Indique le nom du profil Songless avant chaque lien de playlist.');
    const matches = profiles.filter(item => personKey(item.nom) === personKey(row.label));
    if (requireOwner && matches.length === 0) throw new Error(`« ${row.label} » ne correspond à aucun profil Songless.`);
    if (matches.length > 1) throw new Error(`Plusieurs profils correspondent à « ${row.label} ». Renomme les profils pour les distinguer.`);
    const profile = matches[0];
    onLog('Lecture de la playlist ' + (row.label || row.playlistId) + '…');
    try {
      const result = await listPlaylist(row.url, {limite:5000, maxItems:5000});
      const info = profile
        ? {id:`profile:${profile.id}`,label:profile.nom,kind:'profile',profileId:profile.id}
        : balance.source(row.label || result.titre || 'Playlist YouTube', row.label ? '' : row.playlistId);
      if (!groups.has(info.id)) groups.set(info.id, {...info, items:[]});
      for (const item of result.entrees) {
        const id = String(item.id || '');
        if (!/^[a-zA-Z0-9_-]{11}$/.test(id) || seen.has(id)) continue;
        groups.get(info.id).items.push({...item,id,videoId:id,
          url:'https://www.youtube.com/watch?v='+id,importSource:info});
      }
      if (result.tronquee) warnings.push('Playlist tronquée à 5 000 titres : ' + info.label);
    } catch(error) {warnings.push((row.label || row.playlistId) + ' : ' + error.message);}
  }
  const all = [...groups.values()].flatMap(g=>g.items);
  const selection = balance.select(all, requested, {seed});
  if (!selection.selected.length) throw new Error('Aucune nouveauté accessible dans ces playlists. ' + warnings.join(' '));
  return {requested,seed,groups:[...groups.values()],warnings,
    preview:selection.selected.map(t=>({title:t.title,source:t.importSource.label})),
    distribution:selection.sources,available:selection.selected.length};
}
async function run(plan, {downloadTrack,onEvent=()=>{},cancelled=()=>false}) {
  const rng = balance.random(plan.seed);
  const buckets = plan.groups.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(g=>({...g,
    items:balance.shuffle(g.items.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))),rng),added:0,duplicates:0,errors:0,trackIds:[]}));
  const seen = new Set();
  const result={added:0,duplicates:0,errors:0,requested:plan.requested,attempted:0,sources:[],cancelled:false};
  const attemptLimit = Math.min(2000, Math.max(50, plan.requested * 8));
  while(result.added < plan.requested && !cancelled() && result.attempted < attemptLimit) {
    const available=buckets.filter(g=>g.items.length);
    if(!available.length) break;
    const minimum=Math.min(...available.map(g=>g.added));
    const bucket=balance.shuffle(available.filter(g=>g.added===minimum),rng)[0];
    let item;
    while(bucket.items.length){const next=bucket.items.pop();if(!seen.has(next.videoId)){item=next;break;}}
    if(!item) continue;
    seen.add(item.videoId);result.attempted++;
    onEvent('progress',{message:bucket.label+' · '+item.title,added:result.added,total:plan.requested});
    try {
      const entry=await downloadTrack(item.url,{importSource:item.importSource,onLog:message=>onEvent('progress',{message})});
      if(entry.alreadyPresent){result.duplicates++;bucket.duplicates++;}
      else {
        result.added++;bucket.added++;
        if(entry.fileName)bucket.trackIds.push(Buffer.from(entry.fileName).toString('base64url'));
      }
      onEvent('item',{title:entry.title||item.title,source:bucket.label,status:entry.alreadyPresent?'duplicate':'added'});
    } catch(error) {result.errors++;bucket.errors++;onEvent('item',{title:item.title,source:bucket.label,status:'error',error:error.message});}
  }
  result.cancelled=cancelled();result.missing=plan.requested-result.added;
  result.sources=buckets.map(({id,label,profileId,added,duplicates,errors,trackIds})=>({id,label,profileId,added,duplicates,errors,trackIds}));
  return result;
}
module.exports={parseSources,prepare,run};
