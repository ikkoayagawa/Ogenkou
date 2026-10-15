import {settingsUI} from './ui.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function terminal(viewer,revision,name){return new Promise((resolve,reject)=>{
 const clean=()=>{clearTimeout(timer);viewer.removeListener(name,done);viewer.removeListener('error',error)};
 const done=e=>{if(e.revision===revision){clean();resolve(e)}};
 const error=()=>{clean();reject(Error('組版に失敗しました。'))};
 const timer=setTimeout(()=>{clean();viewer.cancelPreviewUpdate();reject(Error('組版が時間内に完了しませんでした。'))},120000);
 viewer.addListener(name,done);viewer.addListener('error',error);
})}
const decode=source=>({...source,resources:source.resources.map(r=>({...r,content:r.base64===undefined?r.content:Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)).buffer}))});

export function startCW(base){
 let viewer=null,latest=null,busy=false,completed=null,credit=true,sent=-1,key=null,started=-1;
 const emit=value=>parent.postMessage(value,'*');
 const make=()=>new VivliostyleCore.CoreViewer({window,viewportElement:document.getElementById('viewport'),userAgentRootURL:base+'resources/'},{autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});
 async function sendSeed(){
  if(busy||!credit||!completed||completed.request<=sent)return;
  const job=completed;credit=false;sent=job.request;busy=true;
  try{
   await viewer.waitForPreviewResources({complete:true});
   let payload=null,packet;
   if(job.source.portable){try{payload=viewer.exportCommittedSeed(job.source.compatibilityKey)}catch(error){emit({type:'reuse-unavailable',revision:job.source.revision,message:error.message})}}
   packet=payload?viewer.exportCompletedPaper(job.source.compatibilityKey):await viewer.exportCompletedPaperWithResources(job.source.compatibilityKey);
   emit({type:'completed',epoch:job.epoch,wire:job,payload,packet,targetIndex:viewer.getCurrentPreviewDisplayUnit()?.epage??0});
  }catch(error){emit({type:'failure',revision:job.source.revision,message:error.message})}
  finally{busy=false;if(latest?.request>job.request)drive()}
 }
 async function drive(){
  if(busy||!latest||latest.request<=started)return;
  busy=true;const job=latest;started=job.request;const start=performance.now();emit({type:'layout-start',revision:job.source.revision,at:Date.now()});
  let progressListener;
  try{
   if(!viewer||key!==job.source.compatibilityKey){viewer?.disposeMemoryResources();document.getElementById('viewport').replaceChildren();viewer=make();key=job.source.compatibilityKey}
   if(!completed){let lastPercent=-1;progressListener=event=>{if(event.revision!==job.source.revision||!Number.isFinite(event.fraction))return;const percent=Math.floor(Math.max(0,Math.min(1,event.fraction))*100);if(percent<=lastPercent)return;lastPercent=percent;emit({type:'layout-progress',revision:event.revision,fraction:percent/100});};viewer.addListener('paginationprogress',progressListener);}
   const reuse=job.source.portable&&!!viewer.getCommittedPreviewSnapshotSeed();viewer.setOptions({renderAllPages:!reuse,paginationMode:'complete'});
   const done=terminal(viewer,job.source.revision,'loaded'),options={fragment:job.source.fragment,reusePages:reuse};
   if(reuse)viewer.refreshMemoryDocument(decode(job.source),options);else viewer.loadMemoryDocument(decode(job.source),options);await done;
   completed=job;emit({type:'layout-end',revision:job.source.revision,durationMs:performance.now()-start,at:Date.now()});
  }catch(error){emit({type:'failure',revision:job.source.revision,message:error.message})}
  finally{if(progressListener)viewer.removeListener('paginationprogress',progressListener);busy=false;if(credit&&completed===job)await sendSeed();if(latest.request>job.request)drive()}
 }
 window.addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data;
  if(m.type==='ping')emit({type:'cw-ready'});
  if(m.type==='input'){latest=m;drive()}
  if(m.type==='seed-credit'){credit=true;sendSeed()}
  if(m.type==='oracle'){
   (async()=>{const deadline=Date.now()+120000;while(busy){if(Date.now()>deadline)throw Error('検証用組版の待機が終了しませんでした。');await pause(20)}
    const viewport=document.createElement('div');viewport.style.cssText='width:1100px;height:850px';document.body.append(viewport);
    const oracle=new VivliostyleCore.CoreViewer({window,viewportElement:viewport,userAgentRootURL:base+'resources/'},{autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});
    try{const done=terminal(oracle,m.wire.source.revision,'loaded');oracle.loadMemoryDocument(decode(m.wire.source),{fragment:m.wire.source.fragment});await done;
     await oracle.waitForPreviewResources({complete:true});
     const packet=oracle.exportCompletedPaper(m.wire.source.compatibilityKey),unit=oracle.getCurrentPreviewDisplayUnit();
     let containers=unit.containers;if(Number.isInteger(m.page)){const index=Math.max(0,Math.min(packet.pages.length-1,m.page)),desired=m.wire.source.direction==='ltr'?'right':'left',before=packet.pages[index].side===desired?index-1:index,after=packet.pages[index].side===desired?index:index+1;containers=(m.spread?[before,after].filter(i=>i>=0&&i<packet.pages.length):[index]).map(i=>oracle.getPageContainerForEpage(i));for(const container of containers)container.style.display='block';}
     emit({type:'oracle-result',revision:m.wire.source.revision,texts:packet.pages.map(p=>new DOMParser().parseFromString(p.html,'text/html').body.textContent),unit:[...containers].sort((a,b)=>Number(a.getAttribute('data-vivliostyle-page-side')==='right')-Number(b.getAttribute('data-vivliostyle-page-side')==='right')).map(c=>({text:c.textContent,width:c.offsetWidth,height:c.offsetHeight}))});
    }finally{oracle.disposeMemoryResources();viewport.remove()}
   })().catch(error=>emit({type:'failure',message:error.message}));
  }
 });emit({type:'cw-ready'});
}

export async function startDisplay(base,nonce,api=acquireVsCodeApi()){
 const cw=document.getElementById('cw'),origin=new URL(base).origin;
 const status=document.getElementById('status'),number=document.getElementById('page'),total=document.getElementById('total'),papers=document.getElementById('papers');
 const state=api.getState?.()??{};let mode=state.mode??'single',zoom=state.zoom??1,fit=state.fit??false;
 const saveState=()=>{api.setState({...state,page,mode,zoom,fit});api.postMessage({type:"view-preferences",settingsTab:state.settingsTab});};
 const receiveSettings=settingsUI(api,state,saveState);
 const spread=()=>mode==='spread'||mode==='auto'&&papers.clientWidth>=850;
 let latest=null,front=null,committed=null,pending=null,importing=false,requested=false,lastEditAt=0,lastStarted=-1,page=state.page??0,intent=0,navigated=!!state.page,ready=false,closed=false,quietTimer=null;
 let lanes=[],caches=[],frames=[],tasks=new Set(),publishQueue=Promise.resolve(),navAnchor=null,targetSerial=0,targetWaiters=new Map();
 let layoutDiagnostics=false,panX=0,panY=0,drag=null,suppressClickUntil=0;
 const notify=(type,data={})=>api.postMessage({type,at:Date.now(),...data});
 let initializing=true,progressRevision=null,progressPercent=0;
 const progress=document.getElementById('layout-progress'),progressValue=document.getElementById('layout-progress-value');
 function initialBusy(value){initializing=value;document.getElementById('refresh').disabled=value;document.getElementById('pdf').disabled=value;receiveSettings({type:'initial-layout',busy:value});progress.hidden=!value;}
 function initialProgress(fraction){progressPercent=Math.max(progressPercent,Math.min(99,Math.floor(Math.max(0,Math.min(1,fraction))*100)));progress.style.setProperty('--progress',String(progressPercent/100));progress.setAttribute('aria-valuenow',String(progressPercent));progressValue.textContent=progressPercent+'%';progress.title='初期組版 '+progressPercent+'%';status.textContent='初期組版中';}
 initialBusy(true);initialProgress(0);
 const fail=error=>{initialBusy(false);status.textContent=error.message;notify('failure',{message:error.message})};
 const track=promise=>{tasks.add(promise);promise.catch(fail).finally(()=>tasks.delete(promise));return promise};
 const response=await fetch(base+'core.js');if(!response.ok)throw Error('Coreの読込みに失敗しました。');
 const scriptURL=URL.createObjectURL(new Blob([await response.arrayBuffer()],{type:'text/javascript'}));
 async function frame(name){
  const iframe=document.createElement('iframe');iframe.title=name;iframe.className='paper';iframe.style.cssText='position:absolute;inset:0;width:1100px;height:850px;border:0;visibility:hidden;background:white';
  const loaded=new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(iframe.contentWindow?.VivliostyleCore){clearInterval(poll);clearTimeout(timer);resolve()}},30),timer=setTimeout(()=>{clearInterval(poll);iframe.remove();reject(Error('紙面の初期化が完了しませんでした。'))},30000)});
  iframe.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;scrollbar-width:none}::-webkit-scrollbar{display:none}#viewport{width:1100px;height:850px}</style></head><body><div id="viewport"></div><script nonce="${nonce}" src="${scriptURL}"></script></body></html>`;
  papers.append(iframe);await loaded;
  const win=iframe.contentWindow,viewport=iframe.contentDocument.getElementById('viewport');viewport.style.opacity='0';viewport.style.pointerEvents='none';
  const viewer=new win.VivliostyleCore.CoreViewer({window:win,viewportElement:viewport,userAgentRootURL:base+'resources/'},{autoResize:false,allowScripts:false,renderAllPages:false,paginationMode:'target-display-unit',pageViewMode:'singlePage'});
  const record={iframe,viewer,owner:null,presentation:null};frames.push(record);return record;
 }
 function dispose(record){record.viewer.cancelPreviewUpdate();record.viewer.disposeMemoryResources();record.iframe.remove();if(record.owner)record.owner.users--;frames=frames.filter(r=>r!==record)}
 function reclaim(){for(const cache of [...caches])if(cache!==committed&&!cache.users&&front?.cache!==cache){cache.host.release();dispose(cache.record);caches=caches.filter(c=>c!==cache)}}
 function controls(index){for(const id of ['first','previous'])document.getElementById(id).disabled=index<=0;for(const id of ['next','last'])document.getElementById(id).disabled=index>=(committed?.packet.pages.length??1)-1;page=index;number.value=String(page+1);total.textContent='/ '+(committed?.packet.pages.length??'—');document.getElementById('seek').max=committed?.packet.pages.length??1;document.getElementById('seek').value=page+1;saveState();}
 function indices(index,cache){
  if(!spread())return [index];const pages=cache.packet.pages,rtl=cache.wire.source.direction!=='ltr';
  const desired=rtl?'left':'right',before=pages[index]?.side===desired?index-1:index,after=pages[index]?.side===desired?index:index+1;
  return [before,after].filter(i=>i>=0&&i<pages.length);
 }
 function arrange(){
  if(!front)return;const containers=front.handle.containers,doc=containers[0]?.ownerDocument;if(!doc)return;
  if(!doc.getElementById('ogenkou-display-style')){const style=doc.createElement('style');style.id='ogenkou-display-style';style.textContent='*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}html,body{margin:0!important;overflow:hidden!important}[data-ogenkou-paper]{position:absolute!important;margin:0!important;transform:none!important;zoom:1!important;display:block!important;visibility:visible!important}';doc.head.append(style);}
  let width=0,height=0;const order=[...containers].sort((a,b)=>Number(a.getAttribute('data-vivliostyle-page-side')==='right')-Number(b.getAttribute('data-vivliostyle-page-side')==='right'));
  for(const c of order){c.style.left=width+'px';c.style.top='0px';width+=c.offsetWidth+12;height=Math.max(height,c.offsetHeight);}width=Math.max(1,width-12);
  const scale=fit?Math.min((papers.clientWidth-24)/width,(papers.clientHeight-24)/Math.max(1,height)):zoom;
  front.record.iframe.style.width=width+'px';front.record.iframe.style.height=height+'px';front.record.iframe.style.transform=`scale(${scale})`;front.record.iframe.style.left=(Math.max(12,(papers.clientWidth-width*scale)/2)+panX)+'px';front.record.iframe.style.top=(12+panY)+'px';
  document.getElementById('zoom').textContent=scale===1?'1:1':Math.round(scale*100)+'%';notify('view-state',{mode,zoom:scale,zoomSetting:zoom,fit,page,pages:containers.length,revision:front.wire.source.revision});
  papers.scrollTo(0,0);doc.defaultView.scrollTo(0,0);
 }
 function describeLayout(){
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const doc=front?.handle.containers[0]?.ownerDocument,visible=[];
  for(const document of new Set([doc,front?.record.iframe.contentDocument].filter(Boolean)))for(const node of document.querySelectorAll('[data-vivliostyle-page-container]')){let shown=true;for(let parent=node;parent;parent=parent.parentElement){const style=parent.ownerDocument.defaultView.getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0){shown=false;break;}}const r=node.getBoundingClientRect();if(shown&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<document.defaultView.innerWidth&&r.top<document.defaultView.innerHeight)visible.push({side:node.getAttribute('data-vivliostyle-page-side'),index:node.getAttribute('data-vivliostyle-page-index'),selected:front.handle.containers.includes(node),...rect(node)});}
  return {page,lane:front?.lane,revision:front?.wire.source.revision,pan:{x:panX,y:panY},frame:front?rect(front.record.iframe):null,visible,selected:front?.handle.containers.map(node=>({side:node.getAttribute('data-vivliostyle-page-side'),...rect(node)}))??[],scroll:{top:papers.scrollTop,left:papers.scrollLeft,innerX:doc?.defaultView.scrollX,innerY:doc?.defaultView.scrollY},toolbar:Object.fromEntries(['next','zoom','pdf','settings-toggle'].map(id=>[id,rect(document.getElementById(id))]))};
 }
 function hitSource(doc,x,y){
  const exact=front.handle.hitTestSource(x,y);if(exact)return exact;
  const caret=doc.caretRangeFromPoint?.(x,y),node=caret?.startContainer;if(node?.nodeType!==3)return null;
  for(const offset of [caret.startOffset,caret.startOffset-1]){if(offset<0||offset>=node.nodeValue.length)continue;const range=doc.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);if([...range.getClientRects()].some(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)){const mapped=front.handle.resolveTextPosition(node,offset);if(mapped)return mapped;}}
  return null;
 }
 function bindPaper(){
  const doc=front?.handle.containers[0]?.ownerDocument;if(!doc)return;
  if(!wheelDocuments.has(doc)){doc.addEventListener('wheel',wheel,{capture:true,passive:false});bindDrag(doc);wheelDocuments.add(doc);}doc.onkeydown=navigationKey;
  doc.onclick=event=>{if(!front||front.handle.containers[0]?.ownerDocument!==doc)return;const link=event.target.closest?.('a[href]');if(link){event.preventDefault();const href=link.getAttribute('href'),id=href?.includes('#')?decodeURIComponent(href.slice(href.indexOf('#')+1)):null;if(id){const p=pageWithId(id);if(p>=0)track(show(p));return;}}
   const hit=hitSource(doc,event.clientX,event.clientY);if(hit)notify('source-click',{position:hit});};
 }
 function pageWithId(id){return committed.packet.pages.findIndex(page=>{const doc=new DOMParser().parseFromString(page.html,'text/html');return [...doc.querySelectorAll('[id]')].some(el=>el.id===id||el.id.startsWith('viv-id-')&&el.id.slice(7).replace(/:([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).endsWith('#'+id));});}
 function outline(){const root=document.getElementById('outline');root.replaceChildren();for(const heading of committed?.wire.source.headings??[]){const button=document.createElement('button');button.textContent=heading.title;button.style.paddingLeft=8+(heading.level-1)*12+'px';button.onclick=()=>{const index=pageWithId(heading.id);if(index>=0)track(show(index));};root.append(button);}if(!root.childNodes.length)root.textContent='見出しはありません。';}
 function mountPaper(record,handle,originals=handle.containers){
  record.presentation?.remove();const doc=handle.containers[0].ownerDocument,root=doc.createElement('div');root.dataset.ogenkouPresentation='true';root.style.cssText='position:absolute;inset:0;pointer-events:auto';doc.body.append(root);record.presentation=root;
  const parents=new Map([[doc.body,root]]);
  function parentFor(node){if(parents.has(node))return parents.get(node);const parent=parentFor(node.parentElement),clone=node.cloneNode(false);clone.style.setProperty('position','static','important');clone.style.setProperty('transform','none','important');clone.style.setProperty('zoom','1','important');clone.style.opacity='1';clone.style.visibility='visible';clone.style.pointerEvents='auto';clone.style.margin='0';clone.style.padding='0';parent.append(clone);parents.set(node,clone);return clone;}
  const staging=new Set();if(originals===handle.containers)for(const paper of originals){let parent=paper;while(parent.parentElement!==doc.body)parent=parent.parentElement;staging.add(parent);}
  handle.containers.forEach((paper,i)=>{const parent=parentFor(originals[i].parentElement);paper.dataset.ogenkouPaper='true';parent.append(paper);});
  for(const parent of staging)if(!parent.querySelector('[data-vivliostyle-page-container]'))parent.remove();
 }
 function stagePaper(handle){for(const paper of handle.containers)paper.style.visibility='hidden';return handle;}
 async function publish(record,handle,wire,lane,cache,jobIntent,index,navigation=false,originals=handle.containers){
  const work=async()=>{
   if(closed||jobIntent!==intent||(!navigation&&front&&front.wire.source.revision>wire.source.revision)){handle.release();return false;}
   stopDrag();if(index!==page){panX=0;panY=0;}
   mountPaper(record,handle,originals);
   const old=front;front={record,handle,wire,lane,cache,intent:jobIntent};record.iframe.style.visibility='visible';if(old?.record!==record)old?.record.iframe.style.setProperty('visibility','hidden');old?.handle.release();
   for(const other of lanes)if(other.name!==lane&&other.state==='FRONT')other.state='DONE';
   controls(index);arrange();bindPaper();if(lane!=='Committed'){total.textContent='/ '+committed.packet.pages.length;total.title='総ページ数は前回の全文確定版です。表示紙面は更新中の版です。';}else total.title='全文確定版の総ページ数';initialBusy(false);status.textContent='';await paint();
   notify('display',{revision:wire.source.revision,lane,pages:committed?.packet.pages.length,page:index+1,request:wire.request,intent,receivedAt:wire.receivedAt});if(layoutDiagnostics)notify('paper-layout',describeLayout());reclaim();return true;
  };publishQueue=publishQueue.then(work,work);return publishQueue;
 }
 function maybeImport(){
  clearTimeout(quietTimer);if(importing||closed)return;
  if(committed&&lanes.some(l=>l.state==='RUNNING'))return;
  if(committed?.seed&&!navigated&&latest?.request>lastStarted&&front?.wire.request<latest.request&&latest.source.compatibilityKey===committed.wire.source.compatibilityKey){kick();return;}
  if(committed&&Date.now()-lastEditAt<300){quietTimer=setTimeout(maybeImport,300-(Date.now()-lastEditAt));return;}
  if(!pending){if(!requested&&latest&&committed&&committed.wire.request<latest.request){requested=true;cw.contentWindow.postMessage({type:'seed-credit'},origin)}return;}
  const packet=pending;pending=null;importing=true;
  track((async()=>{
   const start=performance.now(),record=await frame('Committed'),wire=packet.wire;
   try{
    let seed=null;if(packet.payload){const imported=await record.viewer.importCommittedSeed(packet.payload,{compatibilityKey:wire.source.compatibilityKey,skipInitialPage:true,documentOptions:{fragment:wire.source.fragment},timeoutMs:120000});seed=imported.seed;}
    const holder=record.iframe.contentDocument.createElement('div');holder.style.cssText='position:absolute;inset:0;width:1100px;height:850px';record.iframe.contentDocument.body.append(holder);
    const host=new record.iframe.contentWindow.VivliostyleCore.CompletedPaperHost(packet.packet,holder,wire.source.compatibilityKey);await host.awaitReady();
    const cache={record,host,seed,wire,packet:packet.packet,users:0};caches.push(cache);committed=cache;outline();
    notify('seed-import-end',{revision:wire.source.revision,durationMs:performance.now()-start,reusable:!!seed});
    if(!front||front.wire.source.revision<wire.source.revision){const jobIntent=intent,target=navigated&&navAnchor?await resolveAnchor(wire.source.revision):null;const resolved=target?.target&&pageForTarget(packet.packet,target.target);
     if(navigated&&navAnchor&&!(Number.isInteger(resolved)&&resolved>=0))status.textContent='閲覧位置を解決できませんでした。ページを選び直すか、原稿を編集してください。';
     else{const index=navigated?(Number.isInteger(resolved)&&resolved>=0?resolved:Math.min(page,packet.packet.pages.length-1)):packet.targetIndex,handle=stagePaper(host.retainPages(indices(index,cache)));await host.awaitReady();await publish(record,handle,wire,'Committed',cache,jobIntent,index)}}
    total.textContent='/ '+packet.packet.pages.length;reclaim();
   }catch(error){dispose(record);throw error}
  })().finally(()=>{importing=false;kick();maybeImport()}));
 }
 function kick(){
  if(closed||importing||!committed?.seed||!latest||!latest.source.portable||latest.source.compatibilityKey!==committed.wire.source.compatibilityKey||latest.request<=lastStarted||(front?.intent===intent&&front?.wire.request>=latest.request))return;
  const lane=lanes.find(l=>l.state==='DONE');if(!lane)return;
  const wire=latest,baseline=committed,jobIntent=intent;lastStarted=wire.request;lane.state='RUNNING';baseline.users++;
  track((async()=>{
   const start=performance.now(),record=lane.record;notify('s-start',{revision:wire.source.revision,lane:lane.name,seedRevision:baseline.wire.source.revision});
   try{
    record.presentation?.remove();record.presentation=null;record.iframe.style.width='1100px';record.iframe.style.height='850px';
    record.viewer.setOptions({pageViewMode:'singlePage'});
    const seed=record.viewer.preparePreviewSnapshotSeed(baseline.seed),done=terminal(record.viewer,wire.source.revision,'focusedterminal');
    record.viewer.loadMemoryDocument(decode(wire.source),{fragment:wire.source.fragment,reusePages:true,previewSnapshotSeed:seed,focusedDisplayMode:spread()?'spread':'singlePage'});const result=await done;if(wire.source.fragment&&!result.targetResolved)throw Error('編集位置の紙面を解決できませんでした。');
    notify('s-end',{revision:wire.source.revision,lane:lane.name,durationMs:performance.now()-start,targetResolved:result.targetResolved,reusedPages:result.reusedPages,referenceCompletionRequired:result.referenceCompletionRequired});
    if(record.owner)record.owner.users--;record.owner=baseline;baseline.users++;
    const handle=await record.viewer.retainPreviewDisplayUnitAsync(),unit=record.viewer.getCurrentPreviewDisplayUnit();if(!handle||!unit)throw Error('暫定紙面がありません。');
    const index=unit.epage;
    lane.state=await publish(record,handle,wire,lane.name,null,jobIntent,index,false,unit.containers)?'FRONT':'DONE';
   }finally{baseline.users--;if(lane.state==='RUNNING')lane.state='DONE';reclaim();kick();maybeImport()}
  })());
 }
 function resolveAnchor(revision){
  if(!navAnchor)return Promise.resolve(null);const request=++targetSerial;
  return new Promise(resolve=>{const timer=setTimeout(()=>{targetWaiters.delete(request);resolve(null);},3000);targetWaiters.set(request,m=>{clearTimeout(timer);resolve(m);});notify('request-target',{position:navAnchor,revision,intent,targetRequest:request});});
 }
 function requestTarget(){
  if(!committed||!latest||!navAnchor)return;notify('request-target',{position:navAnchor,revision:latest.source.revision,intent});
 }
 function pageForTarget(packet,target){
  for(let i=0;i<packet.pages.length;i++){const p=packet.pages[i],texts=packet.sources[p.source].texts;let root=null;
   for(const fragment of p.sourceMap){const text=texts.find(t=>JSON.stringify(t.path)===JSON.stringify(fragment.sourcePath));if(text?.key!==target.key)continue;
    if(!root){const template=document.createElement('template');template.innerHTML=p.html;root=template.content.firstElementChild;}let node=root;for(const n of fragment.path)node=node?.childNodes[n];const length=node?.nodeValue?.length??0,offset=target.offset-(text.offset??0);
    for(const run of fragment.runs){const a=Math.max(fragment.start,run.viewStart),b=Math.min(fragment.start+length,run.viewStart+run.length);if(b<=a)continue;const start=run.sourceStart+(run.generated?0:a-run.viewStart),end=run.sourceStart+(run.generated?1:b-run.viewStart);if(offset>=start&&offset<end)return i;}
   }}return -1;
 }
 async function show(index){
  if(!committed||!Number.isFinite(index))return;const jobIntent=++intent;navigated=true;
  index=Math.max(0,Math.min(committed.packet.pages.length-1,index));const cache=committed,handle=stagePaper(cache.host.retainPages(indices(index,cache)));await cache.host.awaitReady();
  // A page move is allowed to show the older, complete revision.
  if(await publish(cache.record,handle,cache.wire,'Committed',cache,jobIntent,index,true)&&front?.handle===handle){
   navAnchor=null;const paper=handle.containers[indices(index,cache).indexOf(index)]??handle.containers[0],walker=paper.ownerDocument.createTreeWalker(paper,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){const p=handle.resolveTextPosition(walker.currentNode,0);if(p&&p.kind!=='generated'&&p.kind!=='ruby-reading'){navAnchor=p;break;}}requestTarget();
  }
 }
 const move=delta=>track(show(page+delta*(spread()?2:1)));
 const wheelDocuments=new WeakSet();let wheelAt=-Infinity;
 function stopDrag(){if(!drag)return;const previous=drag;drag=null;try{previous.target.releasePointerCapture(previous.id);}catch{}}
 function bindDrag(surface){
  surface.addEventListener('pointerdown',event=>{if(!front||!event.ctrlKey||event.button!==0)return;event.preventDefault();event.stopPropagation();suppressClickUntil=performance.now()+400;drag={id:event.pointerId,target:event.target,record:front.record,x:event.screenX,y:event.screenY,panX,panY};try{event.target.setPointerCapture(event.pointerId);}catch{}},{capture:true});
  surface.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();event.stopPropagation();panX=drag.panX+event.screenX-drag.x;panY=drag.panY+event.screenY-drag.y;suppressClickUntil=performance.now()+400;arrange();},{capture:true});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,event=>{if(drag&&event.pointerId===drag.id){suppressClickUntil=performance.now()+400;stopDrag();}},{capture:true});
  (surface.defaultView??surface.ownerDocument.defaultView).addEventListener('blur',stopDrag);
  surface.addEventListener('click',event=>{if(event.ctrlKey||performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 }
 function wheel(event){event.preventDefault();event.stopPropagation();if(event.ctrlKey||event.metaKey){setZoom(zoom+(event.deltaY<0?.1:-.1));return;}const delta=event.deltaY||event.deltaX;if(!front||Math.abs(delta)<8||performance.now()-wheelAt<120)return;wheelAt=performance.now();move(delta>0?1:-1);}
 document.getElementById('previous').onclick=()=>move(-1);document.getElementById('next').onclick=()=>move(1);number.onchange=()=>track(show(Number(number.value)-1));document.getElementById('refresh').onclick=()=>notify('refresh');
 document.getElementById('first').onclick=()=>track(show(0));document.getElementById('last').onclick=()=>track(show(committed?.packet.pages.length-1));document.getElementById('seek').oninput=event=>track(show(Number(event.target.value)-1));
 const modeControl=document.getElementById('mode');modeControl.value=mode;const markMode=()=>document.querySelectorAll('[data-spread-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.spreadMode===mode)));markMode();modeControl.onchange=()=>{mode=modeControl.value;markMode();saveState();track(show(page));};document.querySelectorAll('[data-spread-mode]').forEach(button=>button.onclick=()=>{modeControl.value=button.dataset.spreadMode;modeControl.onchange();});
 const setZoom=value=>{zoom=Math.max(.4,Math.min(2.5,value));fit=false;saveState();arrange();};
 document.getElementById('zoom-in').onclick=()=>setZoom(zoom+.1);document.getElementById('zoom-out').onclick=()=>setZoom(zoom-.1);document.getElementById('zoom').onclick=()=>setZoom(1);document.getElementById('fit').onclick=()=>{fit=true;saveState();arrange();};
 papers.addEventListener('wheel',wheel,{passive:false});
 bindDrag(papers);
 let wasSpread=spread();new ResizeObserver(()=>{const now=spread();if(mode==='auto'&&now!==wasSpread){wasSpread=now;track(show(page));}else arrange();}).observe(papers);
 const navigationKey=event=>{if(event.target.closest('input,select,textarea,button'))return;const rtl=latest?.source.direction!=='ltr';const actions={Home:()=>show(0),End:()=>show(committed?.packet.pages.length-1),PageDown:()=>move(1),PageUp:()=>move(-1),ArrowLeft:()=>move(rtl?1:-1),ArrowRight:()=>move(rtl?-1:1)};if(actions[event.key]){event.preventDefault();track(Promise.resolve(actions[event.key]()));}};document.addEventListener('keydown',navigationKey);
 document.getElementById('pdf').onclick=()=>notify('pdf');
 lanes=[{name:'S1',state:'DONE',record:await frame('S1')},{name:'S2',state:'DONE',record:await frame('S2')}];
 const ping=setInterval(()=>cw.contentWindow.postMessage({type:'ping'},origin),100);
 window.addEventListener('message',event=>{
  const message=event.data;
  if(event.source===cw.contentWindow&&event.origin===origin){
   if(message.type==='cw-ready'&&!ready){clearInterval(ping);ready=true;notify('ready')}
   if(message.type==='layout-start'||message.type==='layout-end'){if(!front){if(message.type==='layout-start'){progressRevision=message.revision;progressPercent=0;initialBusy(true);initialProgress(0);}else status.textContent='紙面を準備中';}notify(message.type,message);}
   if(message.type==='layout-progress'&&initializing&&message.revision===progressRevision){initialProgress(message.fraction);notify('layout-progress',{revision:message.revision,percent:progressPercent});}
   if(message.type==='reuse-unavailable')notify(message.type,message);
   if(message.type==='failure')fail(Error(message.message));
   if(message.type==='oracle-result'){
    const texts=committed.packet.pages.map(p=>new DOMParser().parseFromString(p.html,'text/html').body.textContent);
    const containers=front.handle.containers;
    const unit=[...containers].sort((a,b)=>Number(a.getAttribute('data-vivliostyle-page-side')==='right')-Number(b.getAttribute('data-vivliostyle-page-side')==='right')).map(c=>({text:c.textContent,width:c.offsetWidth,height:c.offsetHeight}));
    notify('oracle-result',{revision:message.revision,fullMatches:JSON.stringify(texts)===JSON.stringify(message.texts),targetMatches:JSON.stringify(unit)===JSON.stringify(message.unit),pages:texts.length});
   }
   if(message.type==='completed'){requested=false;pending=message;notify('seed-received',{revision:message.wire.source.revision});maybeImport()}return;
  }
  if(frames.some(record=>event.source===record.iframe.contentWindow))return;
  receiveSettings(message);
  if(message.type==='source-focus'){navigated=false;navAnchor=null;intent++;}
  if(message.type==='raw-edit'){lastEditAt=message.at;if(navigated){navigated=false;navAnchor=null;intent++;}maybeImport()}
  if(message.type==='input'){latest=message;const rtl=message.source.direction!=='ltr';document.getElementById('page-navigation').dataset.progression=rtl?'rtl':'ltr';document.getElementById('previous').textContent=rtl?'›':'‹';document.getElementById('next').textContent=rtl?'‹':'›';document.getElementById('first').textContent=rtl?'⇥':'⇤';document.getElementById('last').textContent=rtl?'⇤':'⇥';document.getElementById('seek').style.direction=message.source.direction==='ltr'?'ltr':'rtl';status.textContent='更新中';cw.contentWindow.postMessage(message,origin);if(navigated)requestTarget();else kick();maybeImport()}
  if(message.type==='source-target'){const waiter=targetWaiters.get(message.targetRequest);if(waiter){targetWaiters.delete(message.targetRequest);waiter(message);}else if(message.fragment&&message.intent===intent&&message.revision===latest?.source.revision){latest={...latest,source:{...latest.source,fragment:message.fragment}};lastStarted=-1;kick();}}
  if(message.type==='status')status.textContent=message.message;
  if(message.type==='test-ui'&&message.action==='layout-diagnostics'){layoutDiagnostics=true;for(const record of frames)record.iframe.contentWindow.__ogenkouReuseProfile=sample=>notify('reuse-profile',sample);}
  if(message.type==='test-ui'&&message.action==='layout-inspect')notify('paper-layout',describeLayout());
  if(message.type==='test-ui'&&message.action==='drag'){const target=message.surface==='paper'?front?.handle.containers[0]:papers;if(target){const win=target.ownerDocument.defaultView;for(const [type,x,y]of [['pointerdown',100,100],['pointermove',100+(message.dx??60),100+(message.dy??40)],['pointerup',100+(message.dx??60),100+(message.dy??40)]])target.dispatchEvent(new win.PointerEvent(type,{screenX:x,screenY:y,pointerId:1,button:0,buttons:type==='pointerup'?0:1,ctrlKey:message.ctrlKey!==false,bubbles:true,cancelable:true}));notify('paper-layout',describeLayout());}}
  if(message.type==='test-ui'&&message.action==='wheel'){const target=message.surface==='paper'?front?.handle.containers[0]:papers;if(target){const event=new target.ownerDocument.defaultView.WheelEvent('wheel',{deltaY:message.deltaY??120,ctrlKey:!!message.ctrlKey,bubbles:true,cancelable:true});target.dispatchEvent(event);notify('wheel-test',{prevented:event.defaultPrevented});}}
  if(message.type==='test-ui'&&message.action==='inspect')notify('ui-state',{initializing,progressHidden:progress.hidden,progressPercent:Number(progress.getAttribute('aria-valuenow')),refreshDisabled:document.getElementById('refresh').disabled,pdfDisabled:document.getElementById('pdf').disabled,applyDisabled:document.getElementById('settings-apply').disabled,freezeDisabled:document.getElementById('settings-freeze').disabled,paperScrollbar:getComputedStyle(papers).scrollbarWidth,paperFrameScrollbar:front?getComputedStyle(front.record.iframe.contentDocument.documentElement).scrollbarWidth:null,paperOptions:[...document.querySelectorAll('[data-key="paper.preset"] option')].map(o=>o.textContent),orientationOptions:[...document.querySelectorAll('[data-key="paper.orientation"] option')].map(o=>o.textContent)});
  if(message.type==='navigate')track(show(message.page));
  if(message.type==='view-options'){if(message.settingsTab)receiveSettings({type:'settings-tab',tab:message.settingsTab});const changed=message.mode&&message.mode!==mode;if(message.mode){mode=message.mode;modeControl.value=mode;markMode();}if(Number.isSafeInteger(message.page)&&!front){page=message.page;navigated=true;}if(message.zoom)setZoom(message.zoom);if(message.zoomSetting)zoom=message.zoomSetting;if(message.fit!==undefined)fit=message.fit;saveState();if(front&&changed)track(show(page));else arrange();}
  if(message.type==='test-ui'){if(message.action==='heading')document.querySelectorAll('#outline button')[message.index??0]?.click();if(message.action==='toc-link'){const links=front?.handle.containers[0]?.querySelectorAll('a[href]');links?.[message.index??0]?.click();}if(message.action==='geometry')document.getElementById('settings-geometry')?.click();if(message.action==='settings')document.getElementById('settings-toggle').click();if(message.action==='change'){const input=document.querySelector('[data-key="'+message.key+'"]');if(input){if(input.type==='checkbox')input.checked=message.value;else input.value=message.value;input.dispatchEvent(new Event('change'));}}if(message.action==='apply')document.getElementById('settings-apply').click();if(message.action==='discard')document.getElementById('settings-discard').click();}
  if(message.type==='test-click'){const node=front?.handle.containers[0];if(node){const walker=node.ownerDocument.createTreeWalker(node,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const text=walker.currentNode;if(!text.nodeValue.trim()||!front.handle.resolveTextPosition(text,0))continue;const range=node.ownerDocument.createRange();range.setStart(text,0);range.setEnd(text,Math.min(1,text.length));const rect=range.getBoundingClientRect();if(rect.width&&rect.height){const hit=hitSource(node.ownerDocument,rect.x+rect.width/2,rect.y+rect.height/2);notify('click-diagnostic',{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport:{width:node.ownerDocument.defaultView.innerWidth,height:node.ownerDocument.defaultView.innerHeight},hit:!!hit,element:node.ownerDocument.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.tagName});if(hit)notify('source-click',{position:hit});break;}}}}
  if(message.type==='oracle')track((async()=>{const deadline=Date.now()+120000;while(importing||pending||lanes.some(l=>l.state==='RUNNING')||committed?.wire.request!==latest?.request){maybeImport();if(Date.now()>deadline)throw Error('検証前の確定版取込みが完了しませんでした。');await pause(20)}await publishQueue;cw.contentWindow.postMessage({type:'oracle',wire:latest,page,spread:spread()},origin)})());
 });
 window.addEventListener('beforeunload',()=>{closed=true;clearInterval(ping);clearTimeout(quietTimer);front?.handle.release();for(const cache of caches)cache.host.release();for(const record of [...frames])dispose(record);URL.revokeObjectURL(scriptURL)});
}
