const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async()=>{
 const workspace=process.env.OGENKOU_ENTRY_WORKSPACE,output=process.env.OGENKOU_ENTRY_RESULT;
 const benchmark=process.env.OGENKOU_ENTRY_BENCHMARK==='1',spreadBenchmark=process.env.OGENKOU_ENTRY_SPREAD_BENCHMARK==='1';if(spreadBenchmark)await vscode.workspace.getConfiguration('ogenkou').update('preview.mode','spread',vscode.ConfigurationTarget.Workspace);
 const extension=vscode.extensions.getExtension('ogenkou-local.ogenkou');assert(extension,'Production extension discovered');
 const api=await extension.activate(),checks=[],measurements=[];
 const until=async(predicate,label)=>{const end=Date.now()+120000;while(Date.now()<end){const failed=api.diagnostics()?.events.find(e=>e.type==='input-failure'||e.type==='failure');if(failed)throw Error(JSON.stringify(failed));if(predicate()){checks.push(label);await fs.writeFile(output+'.progress',JSON.stringify({checks,diagnostics:api.diagnostics()},null,2));return;}await fs.writeFile(output+'.progress',JSON.stringify({checks,diagnostics:api.diagnostics()},null,2));await pause(50)}throw Error('Timeout: '+label+' '+JSON.stringify(api.diagnostics()));};
 async function burst(uri){
  const doc=await vscode.workspace.openTextDocument(uri),startRevision=api.diagnostics().events.filter(e=>e.type==='display').at(-1).revision;
  for(let i=0;i<40;i++){const edit=new vscode.WorkspaceEdit(),offset=doc.getText().indexOf('編集対象の本文です。');assert(offset>=0);edit.insert(uri,doc.positionAt(offset),'\n');assert(await vscode.workspace.applyEdit(edit));await pause(200);}
  const finalInput=()=>api.diagnostics().events.filter(e=>e.type==='input').at(-1);
  await until(()=>{const input=finalInput();return input&&api.diagnostics().events.some(e=>e.type==='display'&&e.revision===input.revision)&&Date.now()-input.at>1500},'continuous end editing settled');
  const observedDisplays=spreadBenchmark?api.diagnostics().events.filter(e=>e.type==='display'&&e.revision>startRevision):null;await api.validate();await until(()=>api.diagnostics().events.some(e=>e.type==='oracle-result'&&e.revision>startRevision),'fresh full render comparison');
  const oracle=api.diagnostics().events.filter(e=>e.type==='oracle-result').at(-1);assert(oracle.fullMatches);if(!spreadBenchmark||process.env.OGENKOU_ENTRY_ALLOW_NO_REUSE!=='1')assert(oracle.targetMatches);
  const events=api.diagnostics().events,displays=observedDisplays??events.filter(e=>e.type==='display'&&e.revision>startRevision);
  assert(displays.some(e=>e.lane==='S1'||e.lane==='S2'),'Speculative lane actually displayed');assert(displays.every(e=>e.page>50),'End editing follows the end page');
  const median=a=>{a=a.slice().sort((a,b)=>a-b);return a[Math.floor(a.length/2)]};
  const intervals=displays.slice(1).map((e,i)=>e.at-displays[i].at),latencies=displays.filter(e=>e.receivedAt).map(e=>e.at-e.receivedAt);
  return {oracleTargetMatches:oracle.targetMatches,characters:doc.getText().length,displays:displays.length,updateIntervalMedian:median(intervals),editToPaperMedian:median(latencies),events};
 }
 const uri=vscode.Uri.file(path.join(workspace,'first','01.novel')),document=await vscode.workspace.openTextDocument(uri);
 await vscode.window.showTextDocument(document);
 await vscode.commands.executeCommand('ogenkou.preview.open',uri);
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'initial completed paper');
 if(benchmark)measurements.push({case:'40000-burst',...await burst(uri)});
 if(benchmark&&process.env.OGENKOU_ENTRY_BENCHMARK_ONLY==='1'){
  const second=vscode.Uri.file(path.join(workspace,'second','01.nv'));await vscode.commands.executeCommand('ogenkou.preview.open',second);
  await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'160000 initial completed paper');measurements.push({case:'160000-burst',...await burst(second)});
  for(const measure of measurements){const jobs=measure.events.filter(e=>e.type==='layout-end'&&e.revision>1);assert(jobs.length>=3,'at least three CW update cycles');const s=measure.events.filter(e=>e.type==='s-end');if(!spreadBenchmark||process.env.OGENKOU_ENTRY_ALLOW_NO_REUSE!=='1')assert(s.some(e=>e.reusedPages>0));if(process.env.OGENKOU_ENTRY_RESOURCE_BENCHMARK==='1')assert(s.every(e=>!e.referenceCompletionRequired));}
  await vscode.commands.executeCommand('ogenkou.preview.close');assert.equal(api.diagnostics(),undefined);checks.push('three CW cycles, speculative prefix reuse and cleanup');
  await fs.writeFile(output,JSON.stringify({checks,measurements,vscode:vscode.version},null,2));return;
 }
 let state=api.diagnostics();assert(state.events.some(e=>e.type==='ready'));assert(state.events.some(e=>e.pages>1));checks.push('CW ready and multiple pages');
 measurements.push({case:'40000',events:state.events});assert.equal(JSON.parse(await fs.readFile(path.join(workspace,'first/ogenkou.jsonc'),'utf8')).settingsVersion,1);checks.push('new project settings initialized');
 assert.equal((await fetch(state.runtimeUrl+'../core.js')).status,404);checks.push('runtime token enforced');
 const firstRevision=state.events.filter(e=>e.type==='display').at(-1).revision;
 const edit=new vscode.WorkspaceEdit();edit.insert(uri,new vscode.Position(0,0),'追加された本文。\n');assert(await vscode.workspace.applyEdit(edit));assert(document.isDirty);
 await until(()=>api.diagnostics().events.some(e=>e.type==='s-start'&&e.revision>firstRevision),'S started before page move');
 await api.navigate(5);await until(()=>api.diagnostics().events.some(e=>e.type==='display'&&e.page===6&&e.intent>0),'Committed page move while S running');
 const move=api.diagnostics().events.filter(e=>e.type==='display'&&e.intent>0).at(-1);
 await until(()=>api.diagnostics().events.some(e=>e.type==='s-end'&&e.revision>firstRevision),'old target completed after page move');
 await pause(1000);assert(!api.diagnostics().events.some(e=>e.type==='display'&&e.at>move.at&&e.intent===move.intent&&e.page===1));checks.push('old target did not move the display back');
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'&&e.revision>firstRevision),'unsaved edit reflected');
 const revision=api.diagnostics().events.filter(e=>e.type==='display').at(-1).revision;
 await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.Two});
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='hidden'),'panel hidden');
 const hiddenEdit=new vscode.WorkspaceEdit();hiddenEdit.insert(uri,new vscode.Position(1,0),'非表示中の追加。\n');assert(await vscode.workspace.applyEdit(hiddenEdit));
 await vscode.commands.executeCommand('ogenkou.preview.open',uri);
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'&&e.revision>revision),'hidden edit reflected on return');
 await vscode.commands.executeCommand('ogenkou.preview.open',uri);assert.equal(api.diagnostics().runtimeUrl,state.runtimeUrl);checks.push('same work reuses panel');
 await vscode.commands.executeCommand('ogenkou.preview.restart');await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'explicit runtime restart');
 const second=vscode.Uri.file(path.join(workspace,'second','01.nv'));await vscode.commands.executeCommand('ogenkou.preview.open',second);
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'work switch displayed');
 if(benchmark)measurements.push({case:'160000-burst',...await burst(second)});
 measurements.push({case:'160000',events:api.diagnostics().events});
 await assert.rejects(fetch(state.runtimeUrl+'core.js'));checks.push('retired runtime closed');
 const endpoint=api.diagnostics().runtimeUrl;await vscode.commands.executeCommand('ogenkou.preview.close');assert.equal(api.diagnostics(),undefined);await assert.rejects(fetch(endpoint+'core.js'));checks.push('panel and runtime disposed');
 await vscode.commands.executeCommand('ogenkou.preview.open',second);await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'reopen after dispose');
 const doc2=await vscode.workspace.openTextDocument(second),version=api.diagnostics().events.filter(e=>e.type==='display').at(-1).revision;
 const busyEdit=new vscode.WorkspaceEdit();busyEdit.insert(second,new vscode.Position(0,0),'組版中終了。\n');assert(await vscode.workspace.applyEdit(busyEdit));
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='layout-start'&&e.revision>version),'layout before close');
 await vscode.commands.executeCommand('ogenkou.preview.close');
 assert.equal(api.diagnostics(),undefined);checks.push('close while rendering');
 await fs.writeFile(output,JSON.stringify({checks,measurements,vscode:vscode.version},null,2));
};
