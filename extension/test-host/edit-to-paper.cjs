const vscode=require('vscode'),fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async()=>{
 const root=path.resolve(__dirname,'../..'),output=process.env.OGENKOU_EDIT_TO_PAPER_OUTPUT,plan=JSON.parse(await fs.readFile(path.join(output,'plan.json'),'utf8'));
 const load=file=>import(pathToFileURL(path.join(root,'extension/dist/src',file)).href);
 const [{VSCodeWorkspace},{SnapshotBuilder},{RenderInputBuilder},{CompilerService},{createCoreMemoryInput},parse5]=await Promise.all([
  load('host/vscode-adapters.js'),load('services/snapshot-builder.js'),load('services/render-input-builder.js'),load('compiler/compiler-service.js'),load('services/core-memory-input.js'),
  import(pathToFileURL(path.join(root,'extension/node_modules/parse5/dist/index.js')).href)]);
 const events=[],emit=(type,data={})=>{const row={type,at:Date.now(),...data};events.push(row);fsSync.appendFileSync(path.join(output,'events.jsonl'),JSON.stringify(row)+'\n');return row};
 const coreBytes=await fs.readFile(path.join(root,'vivliostyle/packages/core/lib/vivliostyle.iife.js')),coreHash=createHash('sha256').update(coreBytes).digest('hex');
 let origin,caseState;
 const server=http.createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname;let file,bytes,type;
  if(name==='/cw'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><style>html,body{margin:0}#viewport{width:1100px;height:850px}</style></head><body><div id="viewport"></div><script src="${origin}/core.js"></script><script type="module">import {startCW} from '${origin}/browser.mjs';startCW('${origin}','${coreHash}');</script></body></html>`);return;}
  if(name==='/core.js'){bytes=coreBytes;type='text/javascript';}
  else if(name==='/browser.mjs'){file=path.join(root,'extension/scripts/edit-to-paper-browser.mjs');type='text/javascript';}
  else if(name.startsWith('/resources/')){const base=path.join(root,'vivliostyle/packages/core/resources'),candidate=path.resolve(base,name.slice(11));if(candidate.startsWith(base+path.sep)){file=candidate;type=name.endsWith('.css')?'text/css':name.endsWith('.xml')?'application/xml':'application/octet-stream';}}
  if(!bytes&&file&&fsSync.existsSync(file))bytes=fsSync.readFileSync(file);
  response.setHeader('Access-Control-Allow-Origin','*');if(!bytes){response.writeHead(404);response.end();return;}response.setHeader('Content-Type',type+'; charset=utf-8');response.end(bytes);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 const panel=vscode.window.createWebviewPanel('ogenkouEditToPaper','編集から紙面までの測定',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
 const compiler=new CompilerService(120000),browserMessages=[],waiters=[];
 const waitFor=(predicate,label,timeout=240000)=>new Promise((resolve,reject)=>{
  const found=browserMessages.find(predicate);if(found){resolve(found);return;}
  const item={predicate,resolve,reject,label};waiters.push(item);item.timer=setTimeout(()=>{const i=waiters.indexOf(item);if(i>=0)waiters.splice(i,1);reject(Error(label+' timed out'));},timeout);
 });
 const listener=panel.webview.onDidReceiveMessage(message=>{
  const row=emit(message.type,{...message,receivedAtHost:Date.now()});browserMessages.push(row);
  for(const waiter of [...waiters])if(waiter.predicate(row)){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(row);}
  if(message.type==='failure')for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(Error(message.message));}
 });
 panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-probe' ${origin}; connect-src ${origin} data: blob:; frame-src ${origin} 'self'; style-src 'unsafe-inline' ${origin} blob:; font-src ${origin} data: blob:; img-src ${origin} data: blob:;"><style>html,body{margin:0}iframe{position:absolute;inset:0;width:1100px;height:850px;border:0}#cw{z-index:0}</style></head><body><iframe id="cw" src="${origin}/cw"></iframe><script nonce="probe" src="${origin}/core.js"></script><script nonce="probe" type="module">import {startS} from '${origin}/browser.mjs';startS('${origin}','${coreHash}');</script></body></html>`;
 function cssTransport(memory){
  const addresses=new Map();for(const resource of memory.source.resources){if(resource.mediaType!=='text/css'||typeof resource.content!=='string')throw Error('This first benchmark supports CSS-only captured resources');
   if(/@import|url\(/iu.test(resource.content))throw Error('The inline benchmark CSS transport does not support CSS dependencies');
   addresses.set(resource.url,'data:text/css;base64,'+Buffer.from(resource.content).toString('base64'));}
  // Fixed CSS bytes are readable in both renderer origins without an HTTP fetch.
  const dom=parse5.parse(memory.source.html);const visit=node=>{for(const attr of node.attrs??[])if(attr.name==='href'&&addresses.has(attr.value))attr.value=addresses.get(attr.value);for(const child of node.childNodes??[])visit(child)};visit(dom);
  const textMapping=caseState.lastDocument.mappings.find(m=>m.text.includes(caseState.spec.marker)&&m.kind!=='ruby-reading');
  if(!textMapping)throw Error('Target source mapping missing');const entry=memory.source.sourceMap.find(e=>e.key===textMapping.key);let node=dom.childNodes.find(n=>n.nodeName==='html');for(const index of entry.path)node=node.childNodes[index];let p=node.parentNode;while(p&&p.tagName!=='p')p=p.parentNode;if(!p)throw Error('Target paragraph missing');p.attrs.push({name:'id',value:'benchmark-target'});
  const styleKey=createHash('sha256').update(memory.source.resources.map(r=>r.content).join('\n')).digest('hex');
  return {...memory.source,html:parse5.serialize(dom),resources:[],target:{key:textMapping.key,offset:textMapping.text.indexOf(caseState.spec.marker),text:caseState.spec.marker},compatibilityKey:coreHash+'\n'+styleKey};
 }
 const results=[];
 try{
  await waitFor(m=>m.type==='browser-ready','S ready',30000);await waitFor(m=>m.type==='cw-ready','CW ready',30000);
  for(const spec of plan){
   emit('case-start',{case:spec.name,spec});const uri=vscode.Uri.file(path.join(spec.directory,'01.novel')),doc=await vscode.workspace.openTextDocument(uri);
   await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.Two,preserveFocus:true});
   const api=new VSCodeWorkspace(vscode,vscode.Uri.file(spec.directory)),snapshots=new SnapshotBuilder(api.snapshotHost(),120000);snapshots.activate(uri.toString());
   const versions=new Map([[doc.version,{inputRevision:0,receivedAt:Date.now(),phase:'initial'}]]);
   const state={spec,revision:0,busy:false,processed:-1,closed:false,versions,lastDocument:null,phase:'initial',build:0};caseState=state;
   const timedCompiler={compile:async(snapshot,signal)=>{const version=snapshot.sources.find(s=>s.uri===uri.toString())?.editorVersion,edit=versions.get(version);const start=emit('conversion-start',{case:spec.name,build:state.build,inputRevision:edit?.inputRevision,editorVersion:version});
    try {const result=await compiler.compile(snapshot,signal);emit('conversion-end',{case:spec.name,build:state.build,inputRevision:edit?.inputRevision,durationMs:Date.now()-start.at});return result;}
    catch(error){emit('conversion-error',{case:spec.name,build:state.build,inputRevision:edit?.inputRevision,message:error.message});throw error;}}};
   const inputs=new RenderInputBuilder(snapshots,timedCompiler);
   async function drive(){
    if(state.busy||state.closed||state.processed>=state.revision)return;state.busy=true;const requested=state.revision;state.build++;
    const start=emit('input-start',{case:spec.name,build:state.build,requestedRevision:requested});
    try {const input=await inputs.build();const version=input.snapshot.sources.find(s=>s.uri===uri.toString()).editorVersion,edit=versions.get(version);if(!edit)throw Error('Captured editor version unknown');
     state.lastDocument=input.document;const adapterStart=Date.now(),source=cssTransport(createCoreMemoryInput(input)),readyAt=Date.now();
     state.processed=edit.inputRevision;emit('input-ready',{case:spec.name,build:state.build,inputRevision:edit.inputRevision,coreRevision:source.revision,editorVersion:version,receivedAt:edit.receivedAt,phase:edit.phase,captureAndConvertMs:readyAt-start.at,adapterMs:readyAt-adapterStart});
     await panel.webview.postMessage({type:'input',case:spec.name,inputRevision:edit.inputRevision,receivedAt:edit.receivedAt,phase:edit.phase,readyAt,source});
    }catch(error){state.processed=requested;emit('input-error',{case:spec.name,build:state.build,requestedRevision:requested,message:error.message});}
    finally{state.busy=false;if(!state.closed&&state.processed<state.revision)setImmediate(()=>drive().catch(error=>emit('failure',{message:error.message})));}
   }
   const changes=vscode.workspace.onDidChangeTextDocument(event=>{if(event.document.uri.toString()!==uri.toString()||!event.contentChanges.length)return;state.revision++;const row=emit('edit',{case:spec.name,inputRevision:state.revision,editorVersion:doc.version,phase:state.phase,changeCount:event.contentChanges.length});versions.set(doc.version,{inputRevision:state.revision,receivedAt:row.at,phase:state.phase});
    panel.webview.postMessage({type:'raw-edit',case:spec.name,inputRevision:state.revision,at:row.at});drive().catch(error=>emit('failure',{message:error.message}));});
   try{
    await panel.webview.postMessage({type:'reset',case:spec.name});await waitFor(m=>m.type==='reset-ready'&&m.case===spec.name,'reset');await drive();
    await waitFor(m=>m.type==='display'&&m.case===spec.name&&m.inputRevision===0,'initial paper');await waitFor(m=>m.type==='cw-end'&&m.case===spec.name&&m.inputRevision===0,'initial CW');
    const edit=async()=>{const target=doc.getText().indexOf(spec.marker),change=new vscode.WorkspaceEdit();change.insert(uri,doc.positionAt(target),'\n');if(!await vscode.workspace.applyEdit(change))throw Error('Editor edit rejected');return state.revision};
    state.phase='isolated';for(let i=0;i<spec.isolatedCount;i++){const revision=await edit();await waitFor(m=>m.type==='display'&&m.case===spec.name&&m.inputRevision>=revision,'isolated display');await waitFor(m=>m.type==='cw-end'&&m.case===spec.name&&m.inputRevision>=revision,'isolated CW');}
    state.phase='continuous';const began=Date.now();for(let i=0;i<spec.inputCount;i++){await pause(Math.max(0,began+i*spec.inputIntervalMs-Date.now()));await edit();}
    const stopped=emit('input-stop',{case:spec.name,inputRevision:state.revision});state.phase='settle';
    await waitFor(m=>m.type==='display'&&m.case===spec.name&&m.inputRevision===state.revision,'final display');await waitFor(m=>m.type==='cw-end'&&m.case===spec.name&&m.inputRevision===state.revision,'final CW');
    await panel.webview.postMessage({type:'oracle',case:spec.name});const oracle=await waitFor(m=>m.type==='oracle-result'&&m.case===spec.name,'oracle');
    if(!oracle.fullMatches||!oracle.targetMatches||oracle.committedRevision!==state.revision)throw Error('Final independent paper comparison failed: '+JSON.stringify(oracle));
    const rows=events.filter(e=>e.case===spec.name),displays=rows.filter(e=>e.type==='display'),ready=rows.filter(e=>e.type==='input-ready'),edits=rows.filter(e=>e.type==='edit');
    const summarize=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return {count:sorted.length,median:sorted.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:null,p95:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,max:sorted.at(-1)??null}};
    const isolatedDisplays=displays.filter(e=>e.phase==='isolated'),continuousDisplays=displays.filter(e=>e.phase==='continuous'),activeDisplays=continuousDisplays.filter(e=>e.paintedAt<=stopped.at);
    const firstVisible=edits.map(edit=>{const shown=displays.find(d=>d.inputRevision>=edit.inputRevision);return {inputRevision:edit.inputRevision,phase:edit.phase,firstVisibleRevision:shown?.inputRevision??null,tatMs:shown?shown.paintedAt-edit.at:null}});
    const result={case:spec.name,size:spec.size,profile:spec.profile,position:spec.position,baseUtf16:spec.size,finalInputRevision:state.revision,isolatedCompletedCWCycles:rows.filter(e=>e.type==='cw-end'&&e.phase==='isolated').length,
     isolatedTatMs:summarize(isolatedDisplays.map(e=>e.paintedAt-e.receivedAt)),continuousPublishedTatMs:summarize(continuousDisplays.map(e=>e.paintedAt-e.receivedAt)),continuousAllEditFirstVisibleMs:summarize(firstVisible.filter(e=>e.phase==='continuous').map(e=>e.tatMs)),
     continuousDisplayCountWhileTyping:activeDisplays.length,continuousDisplayIntervalsMs:summarize(activeDisplays.slice(1).map((e,i)=>e.paintedAt-activeDisplays[i].paintedAt)),
     inputReadyDuringTyping:ready.filter(e=>e.phase==='continuous'&&e.at<=stopped.at).length,inputErrors:rows.filter(e=>e.type==='input-error').length,conversions:rows.filter(e=>e.type==='conversion-start').length,
     finalCatchupMs:displays.find(e=>e.inputRevision===state.revision).paintedAt-stopped.at,finalCWAfterStopMs:rows.find(e=>e.type==='cw-end'&&e.inputRevision===state.revision).at-stopped.at,
     inputProcessingMs:summarize(ready.filter(e=>e.inputRevision>0).map(e=>e.captureAndConvertMs)),sLayoutMs:summarize(rows.filter(e=>e.type==='s-end').map(e=>e.durationMs)),
     frontAgesAtEditMs:summarize(rows.filter(e=>e.type==='display-age').map(e=>e.ageMs)),oracle,firstVisible};results.push(result);await fs.writeFile(path.join(output,'partial-results.json'),JSON.stringify(results,null,2)+'\n');emit('case-end',{case:spec.name,result});
   }finally{state.closed=true;changes.dispose();snapshots.close();api.dispose();await panel.webview.postMessage({type:'release',case:spec.name});await waitFor(m=>m.type==='released'&&m.case===spec.name,'release');}
  }
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({vscode:vscode.version,scope:'VS Code edit event to two-frame experimental presentation; current coherent capture path, fixed CSS data URLs, CW+S1/S2',cases:results},null,2)+'\n');
 }finally{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(Error('Closed'));}listener.dispose();panel.dispose();await compiler.close();await new Promise(resolve=>server.close(resolve));}
};
