(function () {
  'use strict';
  const B=window.SonglessSourceBalance;
  const $=id=>document.getElementById(id);
  let candidateTracks=[],importToken='',assignToken='',lastResult=null;
  let config={enabled:false,count:30,excludedIds:[]};
  try{const old=JSON.parse(localStorage.getItem('songless-source-balance')||'null');
    if(old)config={enabled:old.enabled===true,count:Math.max(1,Math.min(500,Number(old.count)||30)),
      excludedIds:Array.isArray(old.excludedIds)?old.excludedIds.map(String).slice(0,500):[]};
  }catch(_){}
  function persist(){try{localStorage.setItem('songless-source-balance',JSON.stringify(config));}catch(_){}}
  function textLine(parent,text,tag='p'){const item=document.createElement(tag);item.textContent=text;parent.appendChild(item);return item;}
  function allowed(){return !window.songlessExpansions || window.songlessExpansions.sourceBalanceAllowed();}
  function settings(){return {...config,enabled:config.enabled && allowed(),excludedIds:[...config.excludedIds]};}
  function render(){
    const zone=$('source-library-list');if(!zone)return;
    zone.replaceChildren();
    const groups=B.group(tracks);
    for(const group of groups){
      const label=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.checked=!config.excludedIds.includes(group.id);
      input.addEventListener('change',()=>{
        config.excludedIds=config.excludedIds.filter(id=>id!==group.id);
        if(!input.checked)config.excludedIds.push(group.id);
        persist();rebuildPlaylist({keepCurrent:true});
      });
      label.append(input,document.createTextNode(group.label+' · '+group.items.length));zone.appendChild(label);
    }
    const summary=$('source-library-summary');summary.replaceChildren();
    if(!config.enabled){textLine(summary,'Tirage habituel actif. Coche « Équilibrer les sources » pour appliquer ce réglage au solo et aux parties multijoueurs.');return;}
    const result=lastResult||B.select(candidateTracks,config.count,{seed:currentSeed,excludedIds:config.excludedIds});
    textLine(summary,result.selected.length+' / '+result.requested+' chansons disponibles après les filtres et la blacklist.','strong');
    for(const source of result.sources)textLine(summary,source.label+' : '+source.count);
    if(result.missing)textLine(summary,result.missing+' chanson(s) manquante(s) : ajoute des morceaux ou élargis les sources et les filtres.');
    if(result.sources.some(s=>s.id==='legacy'&&s.count))textLine(summary,'Les anciennes musiques sans origine sont regroupées ensemble. Attribue-leur une source pour mieux répartir le tirage.');
    if(result.sources.filter(s=>s.count>0).length<2)textLine(summary,'Une seule source disponible : la diversité entre sources n’est pas possible dans cette sélection.');
  }
  function apply(items){
    candidateTracks=[...items];
    lastResult=config.enabled?B.select(items,config.count,{seed:currentSeed,excludedIds:config.excludedIds}):null;
    render();return lastResult?lastResult.selected:items;
  }
  async function request(url,body){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Opération impossible.');return data;}
  function invalidateImport(){importToken='';$('source-import-start').disabled=true;$('source-import-preview').replaceChildren();}
  function log(text){const zone=$('source-import-log');textLine(zone,text);while(zone.children.length>150)zone.firstChild.remove();zone.scrollTop=zone.scrollHeight;}
  function showImportPreview(data){
    const zone=$('source-import-preview');zone.replaceChildren();
    textLine(zone,data.available+' nouveautés prévues sur '+data.requested+' demandées.','strong');
    for(const source of data.sources)textLine(zone,source.label+' : '+source.count+' chanson(s)');
    for(const warning of data.warnings)textLine(zone,warning);
    if(data.sources.filter(s=>s.count>0).length<2)textLine(zone,'Attention : une seule source disponible dans ce tirage.');
    textLine(zone,'Un morceau inaccessible ou déjà présent sera remplacé si un autre candidat est disponible.');
    const details=document.createElement('details');textLine(details,'Voir les chansons proposées','summary');
    const list=document.createElement('ol');list.tabIndex=0;list.setAttribute('aria-label','Chansons proposées');for(const item of data.preview)textLine(list,item.source+' — '+item.title,'li');details.appendChild(list);zone.appendChild(details);
  }
  function init(){
    if(!$('source-library-card'))return;
    $('source-balance-enabled').checked=config.enabled;$('source-library-count').value=config.count;
    for(const id of ['source-balance-enabled','source-library-count'])$(id).addEventListener('change',()=>{
      config.enabled=$('source-balance-enabled').checked;config.count=Math.max(1,Math.min(500,Math.floor(Number($('source-library-count').value)||30)));
      $('source-library-count').value=config.count;persist();rebuildPlaylist({keepCurrent:true});
    });
    $('source-library-reroll').addEventListener('click',()=>{
      if(!config.enabled)return showToast('Active d’abord le tirage équilibré.','warn');
      applySeed(Date.now().toString(36)+Math.random().toString(36).slice(2,8));
    });
    const importInput=()=>({lines:$('source-import-lines').value,count:Number($('source-import-count').value)});
    for(const id of ['source-import-lines','source-import-count'])$(id).addEventListener('input',invalidateImport);
    $('source-import-preview-btn').addEventListener('click',async()=>{
      const button=$('source-import-preview-btn'),input=importInput(),fingerprint=JSON.stringify(input);
      invalidateImport();button.disabled=true;button.textContent='Lecture des playlists…';
      try{const data=await request('/api/download/balanced/preview',input);
        if(fingerprint!==JSON.stringify(importInput()))return;
        importToken=data.token;showImportPreview(data);$('source-import-start').disabled=false;
      }catch(e){showToast(e.message,'error');log(e.message);}finally{button.disabled=false;button.textContent='Prévisualiser le tirage';}
    });
    $('source-import-start').addEventListener('click',async()=>{
      if(!importToken)return;const token=importToken;importToken='';
      const buttons=['source-import-start','source-import-preview-btn'];buttons.forEach(id=>$(id).disabled=true);
      $('source-import-stop').disabled=false;$('source-import-log').replaceChildren();
      const controller=new AbortController();$('source-import-stop').onclick=()=>controller.abort();
      try{
        const response=await fetch('/api/download/balanced',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:controller.signal});
        if(!response.ok){const error=await response.json();throw new Error(error.error);}
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
          let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
            const event=/^event: (.+)$/m.exec(block),payload=/^data: (.+)$/m.exec(block);if(!event||!payload)continue;
            const data=JSON.parse(payload[1]);
            if(event[1]==='progress')log(data.message);
            if(event[1]==='item')log(data.source+' — '+data.title+' : '+({added:'ajouté',duplicate:'déjà présent',error:data.error}[data.status]||data.status));
            if(event[1]==='error')throw new Error(data.error);
            if(event[1]==='done'){
              log('Terminé : '+data.added+' / '+data.requested+' ajoutés, '+data.duplicates+' doublons, '+data.errors+' échecs.');
              for(const source of data.sources)log(source.label+' : '+source.added+' ajouté(s).');
              if(data.missing)log('Il manque '+data.missing+' chanson(s) : les candidats disponibles ont été épuisés ou la limite de tentatives atteinte.');
              showToast(data.added+' chanson(s) ajoutée(s).','ok');
            }
          }
        }
      }catch(e){log(e.name==='AbortError'?'Arrêt demandé. Le morceau en cours peut encore se terminer ; les suivants ne seront pas lancés.':e.message);}
      finally{buttons.forEach(id=>$(id).disabled=id==='source-import-start');$('source-import-stop').disabled=true;loadLibrary();}
    });
    const resetAssign=()=>{assignToken='';$('source-assign-apply').disabled=true;$('source-assign-summary').textContent='';};
    $('source-assign-label').addEventListener('input',resetAssign);
    document.addEventListener('change',event=>{if(event.target.matches('.track-select-checkbox, #select-all-tracks'))resetAssign();});
    $('source-assign-preview').addEventListener('click',async()=>{
      try{const ids=selectedTrackIds(),label=$('source-assign-label').value.trim();
        const fingerprint=JSON.stringify({ids,label});const data=await request('/api/sources/assign/preview',{trackIds:ids,label});
        if(fingerprint!==JSON.stringify({ids:selectedTrackIds(),label:$('source-assign-label').value.trim()}))return;
        assignToken=data.token;$('source-assign-summary').textContent=data.count+' morceau(s) seront rattachés à « '+data.source.label+' ». Leur ancienne source sera remplacée ; les titres et fichiers seront conservés.';
        $('source-assign-apply').disabled=false;
      }catch(e){resetAssign();showToast(e.message,'error');}
    });
    $('source-assign-apply').addEventListener('click',async()=>{
      if(!assignToken)return;const token=assignToken;resetAssign();
      try{const data=await request('/api/sources/assign',{token});showToast(data.count+' origine(s) enregistrée(s).','ok');loadLibrary();}catch(e){showToast(e.message,'error');}
    });
    render();
  }
  window.songlessSources={apply,settings,candidates:()=>config.enabled && allowed()?[...candidateTracks]:[...playlist],render,
    label:()=>($('import-source-label')?.value||'').trim()};
  document.addEventListener('DOMContentLoaded',init);
})();
