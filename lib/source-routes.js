'use strict';
const crypto=require('crypto');
const balance=require('../public/source-balance');
const importer=require('./source-import');
module.exports=function register(app,{store,downloader,allBuiltTracks,validPartyTrackIds,resoudreMorceau,ouvrirFlux}){
  const previews=new Map();let busy=false;
  function remember(kind,value){
    for(const [id,item] of previews)if(item.expires<Date.now())previews.delete(id);
    while(previews.size>=5)previews.delete(previews.keys().next().value);
    const token=crypto.randomBytes(24).toString('base64url');
    previews.set(token,{kind,value,expires:Date.now()+10*60000});return token;
  }
  function take(token,kind){const item=previews.get(token);if(!item||item.kind!==kind||item.expires<Date.now())throw new Error('Aperçu expiré : prévisualise à nouveau.');previews.delete(token);return item.value;}
  app.get('/api/sources',async(_req,res)=>{
    try{const tracks=await allBuiltTracks();res.json({sources:balance.group(tracks).map(({id,label,items})=>({id,label,count:items.length}))});}
    catch(e){res.status(500).json({error:e.message});}
  });
  app.post('/api/sources/assign/preview',async(req,res)=>{
    try{
      const label=String(req.body.label||'').trim();
      if(!label||label.length>100)throw new Error('Indique une source de 1 à 100 caractères.');
      const ids=validPartyTrackIds(req.body.trackIds);
      if(!ids.length||ids.length!==(req.body.trackIds||[]).length)throw new Error('Sélection de morceaux invalide.');
      const source=balance.source(label);
      res.json({count:ids.length,source,token:remember('assign',{ids,source})});
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/sources/assign', (req,res)=>{
    try{
      const {ids,source}=take(String(req.body.token||''),'assign');
      const valid=validPartyTrackIds(ids);
      if(valid.length!==ids.length)throw new Error('La bibliothèque a changé : refais l’aperçu.');
      const patches=Object.fromEntries(valid.map(id=>[resoudreMorceau(id).fileName,{importSource:source}]));
      store.setMany(patches);res.json({count:valid.length,source});
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/download/balanced/preview',async(req,res)=>{
    if(busy)return res.status(409).json({error:'Un import équilibré est déjà en cours.'});
    busy=true;
    try{
      const tools=downloader.checkTools();if(!tools.ok)throw new Error('Outils de téléchargement indisponibles.');
      const plan=await importer.prepare({...req.body,seed:crypto.randomBytes(12).toString('hex')},{
        listPlaylist:downloader.listPlaylist,
        existingVideoIds:(await allBuiltTracks()).map(t=>t.videoId).filter(Boolean),
      });
      res.json({token:remember('import',plan),requested:plan.requested,available:plan.available,
        sources:plan.distribution,warnings:plan.warnings,preview:plan.preview});
    }catch(e){res.status(400).json({error:e.message});}finally{busy=false;}
  });
  app.post('/api/download/balanced',async(req,res)=>{
    if(busy)return res.status(409).json({error:'Un import équilibré est déjà en cours.'});
    let plan;try{plan=take(String(req.body.token||''),'import');}catch(e){return res.status(400).json({error:e.message});}
    busy=true;const send=ouvrirFlux(res);let closed=false;
    res.on('close',()=>{closed=true;});
    try{const result=await importer.run(plan,{downloadTrack:downloader.downloadTrack,
      onEvent:(event,data)=>{if(!closed)send(event,data);},cancelled:()=>closed});
      if(!closed)send('done',result);
    }catch(e){if(!closed)send('error',{error:e.message});}finally{busy=false;res.end();}
  });
};
