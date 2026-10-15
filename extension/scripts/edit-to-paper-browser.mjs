const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function terminal(viewer,revision,name,timeout=240000){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{clean();reject(Error(name+' timed out'))},timeout);
 const done=event=>{if(event.revision===revision){clean();resolve(event)}};
 const error=event=>{clean();reject(Error('Core error: '+JSON.stringify(event)))};
 const clean=()=>{clearTimeout(timer);viewer.removeListener(name,done);viewer.removeListener('error',error)};
 viewer.addListener(name,done);viewer.addListener('error',error);
})}
const fullSignature=seed=>[...seed.snapshots.values()].flatMap(snapshot=>snapshot.pages.map(page=>({text:page.container.textContent,width:page.dimensions.width,height:page.dimensions.height,side:page.side,blank:page.isBlankPage})));
function signature(containers){return containers.map(container=>({text:container.textContent,width:container.offsetWidth,height:container.offsetHeight}))}
function checkTarget(handle,wire){
 for(const container of handle.containers){const walker=container.ownerDocument.createTreeWalker(container,NodeFilter.SHOW_TEXT);while(walker.nextNode()){
  const node=walker.currentNode,position=handle.resolveTextPosition(node,0),wanted=wire.source.target;
  if(position?.key===wanted.key&&position.offset<=wanted.offset&&position.offset+node.nodeValue.length>wanted.offset){
   const exact=handle.resolveTextPosition(node,wanted.offset-position.offset);
   if(exact?.revision!==wire.source.revision||exact.offset!==wanted.offset||node.nodeValue[wanted.offset-position.offset]!==wanted.text[0])throw Error('Target source correspondence mismatch');return true;
  }
 }}return false;
}
const paint=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Paint timeout')),10000);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}))});

export function startCW(origin,coreHash){
 let viewer=null,latest=null,busy=false,started=-1,currentCase=null,completed=null,seedCredit=true,sentRevision=-1;
 const emit=(type,wire,data={})=>parent.postMessage({type:'cw-event',row:{type,case:wire?.case??currentCase,inputRevision:wire?.inputRevision,phase:wire?.phase,at:Date.now(),...data}},'*');
 const make=()=>{const value=new VivliostyleCore.CoreViewer({window,viewportElement:document.getElementById('viewport'),userAgentRootURL:origin+'/resources/'},{autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});value.addListener('warn',event=>emit('core-warning',null,{message:String(event.content?.messages),stack:event.content?.error?.stack}));return value};
 function sendSeed(){
  if(busy||!seedCredit||!completed||completed.inputRevision<=sentRevision)return;
  const wire=completed,start=Date.now();seedCredit=false;sentRevision=wire.inputRevision;
  const payload=viewer.exportCommittedSeed(wire.source.compatibilityKey),paper=viewer.exportCompletedPaper(wire.source.compatibilityKey),unit=viewer.getCurrentPreviewDisplayUnit(),full=fullSignature(viewer.getCommittedPreviewSnapshotSeed());
  parent.postMessage({type:'seed',case:wire.case,wire,payload,paper,targetIndex:unit.epage,full,sentAt:Date.now()},'*');
  emit('seed-export',wire,{durationMs:Date.now()-start,pages:paper.pages.length});
 }
 async function drive(){
  if(busy||!latest||latest.inputRevision<=started)return;busy=true;const wire=latest;started=wire.inputRevision;
  const start=Date.now();emit('cw-start',wire);
  try{
   // renderAllPages:true explicitly disables incremental page reuse in Core.
   // A revision-bearing complete preview still waits for every page before
   // loaded with renderAllPages:false. Keep the fresh oracle in full-render mode.
   const reusePages=!!viewer.getCommittedPreviewSnapshotSeed();
   viewer.setOptions({renderAllPages:!reusePages,paginationMode:'complete'});
   emit('cw-policy',wire,{reusePages,renderAllPages:!reusePages,paginationMode:'complete'});
   const finished=terminal(viewer,wire.source.revision,'loaded');if(reusePages)viewer.refreshMemoryDocument(wire.source,{fragment:'#benchmark-target',reusePages:true});else viewer.loadMemoryDocument(wire.source,{fragment:'#benchmark-target'});await finished;
   const layoutEnd=Date.now();emit('cw-layout-end',wire,{durationMs:layoutEnd-start});
   await viewer.waitForPreviewResources({complete:true});
   const handle=await viewer.retainPreviewDisplayUnitAsync();if(!handle||!checkTarget(handle,wire))throw Error('CW displayed target missing');handle.release();
   completed=wire;
   emit('cw-end',wire,{durationMs:layoutEnd-start,pages:fullSignature(viewer.getCommittedPreviewSnapshotSeed()).length});
  }catch(error){emit('failure',wire,{message:error.message,stack:error.stack})}
  finally{busy=false;sendSeed();if(latest.inputRevision>started)queueMicrotask(()=>drive());}
 }
 window.addEventListener('message',event=>{
  if(event.source!==parent)return;const message=event.data;
  if(message.type==='ping-cw')emit('cw-ready');
  if(message.type==='reset-cw'){
   if(busy){emit('failure',null,{message:'CW reset while busy'});return;}
   viewer?.disposeMemoryResources();document.getElementById('viewport').replaceChildren();viewer=make();latest=null;completed=null;seedCredit=true;sentRevision=-1;started=-1;currentCase=message.case;emit('cw-reset-ready');
  }
  if(message.type==='input-cw'){latest=message.wire;drive()}
  if(message.type==='seed-credit'&&message.case===currentCase){seedCredit=true;sendSeed()}
  if(message.type==='oracle-cw'){
   (async()=>{
    if(busy)throw Error('Oracle started before CW settled');
    const viewport=document.createElement('div');viewport.style.cssText='width:1100px;height:850px';document.body.append(viewport);
    const oracle=new VivliostyleCore.CoreViewer({window,viewportElement:viewport,userAgentRootURL:origin+'/resources/'},{autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});
    const done=terminal(oracle,latest.source.revision,'loaded');oracle.loadMemoryDocument(latest.source,{fragment:'#benchmark-target'});await done;
    const unit=oracle.getCurrentPreviewDisplayUnit();parent.postMessage({type:'oracle-packet',case:currentCase,full:fullSignature(oracle.getCommittedPreviewSnapshotSeed()),unit:signature(unit.containers)},'*');oracle.disposeMemoryResources();viewport.remove();
   })().catch(error=>emit('failure',null,{message:error.message,stack:error.stack}));
  }
 });emit('cw-ready');
}

export async function startS(origin,coreHash){
 // Keep the exact Core bytes available when new generation frames are created.
 // A parser-blocking HTTP script request can stall in a native Webview srcdoc.
 const response=await fetch(origin+'/core.js');if(!response.ok)throw Error('Core bundle capture failed');
 const coreScriptURL=URL.createObjectURL(new Blob([await response.arrayBuffer()],{type:'text/javascript'}));
 const api=acquireVsCodeApi(),cw=document.getElementById('cw');
 const emit=(type,data={})=>api.postMessage({type,case:currentCase,at:Date.now(),...data});
 let currentCase=null,latest=null,front=null,committed=null,pending=null,importing=false,seedRequested=false,lastEditAt=0,lastStarted=-1,quietTimer=null,jobSerial=0,frontSignature=null;
 let lanes=[],caches=[],frames=[],publishQueue=Promise.resolve(),tasks=new Set();
 function track(promise){tasks.add(promise);promise.catch(error=>emit('failure',{message:error.message,stack:error.stack})).finally(()=>tasks.delete(promise));return promise;}
 async function frame(name){
  const began=Date.now();emit('frame-start',{name});
  const iframe=document.createElement('iframe');iframe.dataset.lane=name;iframe.style.cssText='position:absolute;inset:0;width:1100px;height:850px;border:0;visibility:hidden;z-index:1';
  const loaded=new Promise((resolve,reject)=>{
   const check=()=>{if(iframe.contentWindow?.VivliostyleCore){clearTimeout(timer);clearInterval(poll);resolve()}};
   const timer=setTimeout(()=>{clearInterval(poll);emit('frame-timeout',{name,connected:iframe.isConnected,readyState:iframe.contentDocument?.readyState,html:iframe.contentDocument?.documentElement?.outerHTML.slice(0,1500)});reject(Error('Frame load timeout: '+name))},30000),poll=setInterval(check,50);iframe.onload=check;
  });
  iframe.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}#viewport{width:1100px;height:850px}</style></head><body><div id="viewport"></div><script nonce="probe">window.addEventListener('error',event=>parent.postMessage({type:'frame-script',name:${JSON.stringify(name)},error:event.message},'*'));parent.postMessage({type:'frame-script',name:${JSON.stringify(name)},stage:'before'},'*');</script><script nonce="probe" src="${coreScriptURL}"></script><script nonce="probe">parent.postMessage({type:'frame-script',name:${JSON.stringify(name)},stage:'after',core:!!window.VivliostyleCore},'*');</script></body></html>`;document.body.append(iframe);await loaded;
  const win=iframe.contentWindow,viewport=iframe.contentDocument.getElementById('viewport'),viewer=new win.VivliostyleCore.CoreViewer({window:win,viewportElement:viewport,userAgentRootURL:origin+'/resources/'},{autoResize:false,allowScripts:false,renderAllPages:false,paginationMode:'target-display-unit',pageViewMode:'singlePage'});
  const record={name,iframe,viewer,owner:null};frames.push(record);emit('frame-ready',{name,durationMs:Date.now()-began});return record;
 }
 async function dispose(record){
  record.viewer?.cancelPreviewUpdate();const end=Date.now()+5000;while(record.viewer?.adaptViewer_?.renderTask?.isRunning()&&Date.now()<end)await pause(2);
  record.viewer?.disposeMemoryResources();record.iframe.onload=null;record.iframe.remove();record.viewer=null;record.iframe=null;if(record.owner){record.owner.users--;record.owner=null;}frames=frames.filter(f=>f!==record);
 }
 function reclaim(){for(const cache of [...caches])if(cache!==committed&&!cache.users&&front?.cache!==cache){cache.host.release();cache.host=null;track(dispose(cache.record));caches=caches.filter(c=>c!==cache)}}
 async function publish(record,handle,wire,lane,cache=null){
  const work=async()=>{
   if(front&&front.wire.inputRevision>=wire.inputRevision){handle.release();return false;}
   if(!checkTarget(handle,wire))throw Error('Displayed target missing in '+lane);
   const old=front;front={record,handle,wire,lane,cache};record.iframe.style.visibility='visible';if(old?.record!==record&&old?.record.iframe)old.record.iframe.style.visibility='hidden';old?.handle.release();
   const switchAt=Date.now();await paint();const paintedAt=Date.now();
   const unit=lane==='Committed'?handle.containers:record.viewer.getCurrentPreviewDisplayUnit().containers;frontSignature=signature(unit);
   emit('display',{inputRevision:wire.inputRevision,coreRevision:wire.source.revision,phase:wire.phase,lane,receivedAt:wire.receivedAt,inputReadyAt:wire.readyAt,switchAt,paintedAt,jobId:wire.jobId??null,targetPresent:true,documentHidden:document.hidden});
   for(const oldLane of lanes)if(oldLane.name!==lane&&oldLane.state==='FRONT')oldLane.state='DONE';
   reclaim();return true;
  };publishQueue=publishQueue.then(work);return publishQueue;
 }
 function maybeImport(){
  clearTimeout(quietTimer);quietTimer=null;if(importing)return;
  if(!pending){
   if(seedRequested||!committed||!latest||committed.wire.inputRevision>=latest.inputRevision||lanes.some(l=>l.state==='RUNNING'))return;
   if(latest.inputRevision>lastStarted&&(!front||latest.inputRevision>front.wire.inputRevision)){kick();return;}
   const remaining=300-(Date.now()-lastEditAt);if(remaining>0){quietTimer=setTimeout(maybeImport,remaining);return;}
   seedRequested=true;emit('seed-request',{committedRevision:committed.wire.inputRevision,latestRevision:latest.inputRevision});cw.contentWindow.postMessage({type:'seed-credit',case:currentCase},origin);return;
  }
  if(committed){
   if(lanes.some(l=>l.state==='RUNNING'))return;
   if(latest&&latest.inputRevision>lastStarted&&(!front||latest.inputRevision>front.wire.inputRevision)){
    emit('seed-import-deferred',{inputRevision:pending.wire.inputRevision,latestRevision:latest.inputRevision,reason:'pending-input'});kick();return;
   }
   const remaining=300-(Date.now()-lastEditAt);if(remaining>0){quietTimer=setTimeout(maybeImport,remaining);return;}
  }
  const packet=pending;pending=null;importing=true;
  track((async()=>{
   const start=Date.now();emit('seed-import-start',{inputRevision:packet.wire.inputRevision,latestRevision:latest?.inputRevision??null,lastStartedRevision:lastStarted,frontRevision:front?.wire.inputRevision??null});const record=await frame('Committed-'+packet.wire.inputRevision);
   const imported=await record.viewer.importCommittedSeed(packet.payload,{compatibilityKey:packet.wire.source.compatibilityKey,skipInitialPage:true,documentOptions:{fragment:'#benchmark-target'},timeoutMs:120000});
   if(imported.initialPagesTypeset!==0)throw Error('Seed import typeset pages');
   const holder=record.iframe.contentDocument.createElement('div');holder.style.cssText='position:absolute;inset:0;width:1100px;height:850px';record.iframe.contentDocument.body.append(holder);
   const host=new record.iframe.contentWindow.VivliostyleCore.CompletedPaperHost(packet.paper,holder,packet.wire.source.compatibilityKey);await host.awaitReady();
   const cache={record,host,seed:imported.seed,wire:packet.wire,users:0,full:packet.full};caches.push(cache);committed=cache;
   emit('seed-import-end',{inputRevision:packet.wire.inputRevision,durationMs:Date.now()-start,initialPagesTypeset:imported.initialPagesTypeset});
   if(!front||front.wire.inputRevision<packet.wire.inputRevision){const handle=host.retainPages([packet.targetIndex]);await host.awaitReady();await publish(record,handle,packet.wire,'Committed',cache);}
   reclaim();
  })().finally(()=>{importing=false;maybeImport();kick()}));
 }
 function kick(){
  if(importing||!committed||!latest||latest.inputRevision<=lastStarted||front?.wire.inputRevision>=latest.inputRevision)return;
  const lane=lanes.find(l=>l.state==='DONE');if(!lane)return;const wire=latest,baseline=committed;lastStarted=wire.inputRevision;lane.state='RUNNING';baseline.users++;
  track((async()=>{
   const record=lane.record,jobId=++jobSerial,startAt=Date.now();emit('s-start',{jobId,lane:lane.name,inputRevision:wire.inputRevision,phase:wire.phase,seedRevision:baseline.wire.inputRevision});
   try{
    const seed=record.viewer.preparePreviewSnapshotSeed(baseline.seed),finished=terminal(record.viewer,wire.source.revision,'focusedterminal');
    record.viewer.loadMemoryDocument(wire.source,{fragment:'#benchmark-target',reusePages:true,previewSnapshotSeed:seed});const metrics=await finished;
    const endAt=Date.now();emit('s-end',{jobId,lane:lane.name,inputRevision:wire.inputRevision,phase:wire.phase,seedRevision:baseline.wire.inputRevision,durationMs:endAt-startAt,targetResolved:metrics.targetResolved,reusedPages:metrics.reusedPages,reusedPrefixPages:metrics.reusedPrefixPages});
    if(record.owner)record.owner.users--;record.owner=baseline;baseline.users++;
    const handle=await record.viewer.retainPreviewDisplayUnitAsync();if(!handle)throw Error('S paper missing');
    const published=await publish(record,handle,{...wire,jobId},lane.name);lane.state=published?'FRONT':'DONE';
   }finally{baseline.users--;if(lane.state==='RUNNING')lane.state='DONE';reclaim();maybeImport();kick()}
  })());
 }
 async function release(){clearTimeout(quietTimer);pending=null;latest=null;while(tasks.size)await Promise.allSettled([...tasks]);await publishQueue;front?.handle.release();front=null;committed=null;for(const cache of caches){cache.host?.release();cache.host=null}caches=[];for(const record of [...frames])await dispose(record);lanes=[];emit('released')}
 window.addEventListener('message',event=>{
  const message=event.data;
  if(message.type==='frame-script'){emit('frame-script',{name:message.name,stage:message.stage,core:message.core,error:message.error});return;}
  if(event.source===cw.contentWindow&&event.origin===origin){
   if(message.type==='cw-event'){api.postMessage(message.row);if(message.row.type==='cw-reset-ready'&&message.row.case===currentCase)emit('reset-ready')}
   if(message.type==='seed'&&message.case===currentCase){seedRequested=false;pending=message;emit('seed-received',{inputRevision:message.wire.inputRevision,transferMs:Date.now()-message.sentAt});maybeImport()}
   if(message.type==='oracle-packet'&&message.case===currentCase){
    const equal=JSON.stringify(message.full)===JSON.stringify(committed.full),unitEqual=JSON.stringify(message.unit)===JSON.stringify(frontSignature);
    const mismatch=message.full.findIndex((page,index)=>JSON.stringify(page)!==JSON.stringify(committed.full[index]));
    emit('oracle-result',{fullMatches:equal,targetMatches:unitEqual,pages:message.full.length,committedPages:committed.full.length,firstMismatch:mismatch<0?null:{index:mismatch,expected:message.full[mismatch],actual:committed.full[mismatch]},sourceCorrespondence:true,committedRevision:committed.wire.inputRevision,expectedRevision:latest.inputRevision});
   }return;
  }
  if(message.type==='reset')(async()=>{await release();currentCase=message.case;seedRequested=false;lastStarted=-1;lastEditAt=0;frontSignature=null;lanes=[{name:'S1',state:'DONE',record:await frame('S1')},{name:'S2',state:'DONE',record:await frame('S2')}];cw.contentWindow.postMessage({type:'reset-cw',case:currentCase},origin)})().catch(error=>emit('failure',{message:error.message,stack:error.stack}));
  if(message.type==='raw-edit'&&message.case===currentCase){lastEditAt=message.at;emit('display-age',{inputRevision:message.inputRevision,frontRevision:front?.wire.inputRevision??null,ageMs:front?Date.now()-front.wire.receivedAt:null});maybeImport()}
  if(message.type==='input'&&message.case===currentCase){latest=message;emit('input-accepted',{inputRevision:message.inputRevision,phase:message.phase,transportMs:Date.now()-message.readyAt});cw.contentWindow.postMessage({type:'input-cw',wire:message},origin);kick()}
  if(message.type==='oracle'&&message.case===currentCase)(async()=>{const deadline=Date.now()+120000;while(importing||pending||tasks.size||committed?.wire.inputRevision!==latest.inputRevision){maybeImport();if(Date.now()>deadline)throw Error('Latest committed seed timed out before oracle');await pause(5)}await publishQueue;cw.contentWindow.postMessage({type:'oracle-cw'},origin)})().catch(error=>emit('failure',{message:error.message,stack:error.stack}));
  if(message.type==='release'&&message.case===currentCase)release().catch(error=>emit('failure',{message:error.message}));
 });
 const ping=setInterval(()=>cw.contentWindow.postMessage({type:'ping-cw'},origin),100);
 window.addEventListener('message',event=>{if(event.source===cw.contentWindow&&event.data.type==='cw-event'&&event.data.row.type==='cw-ready')clearInterval(ping)});
 emit('browser-ready',{origin:location.origin});
}
