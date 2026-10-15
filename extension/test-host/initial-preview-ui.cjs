const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async()=>{
 const workspace=process.env.OGENKOU_ENTRY_WORKSPACE,output=process.env.OGENKOU_ENTRY_RESULT,checks=[];
 const api=await vscode.extensions.getExtension('ogenkou-local.ogenkou').activate();
 const events=()=>api.diagnostics()?.events??[];
 async function until(predicate,label){const deadline=Date.now()+120000;while(Date.now()<deadline){const error=events().find(e=>e.type==='failure'||e.type==='input-failure');if(error)throw Error(JSON.stringify(error));if(predicate()){checks.push(label);return;}await pause(40);}throw Error('Timeout: '+label);}
 async function inspect(){const count=events().filter(e=>e.type==='ui-state').length;await api.uiAction('inspect');await until(()=>events().filter(e=>e.type==='ui-state').length>count,'UI snapshot received');return events().filter(e=>e.type==='ui-state').at(-1);}
 const uri=vscode.Uri.file(path.join(workspace,'first/01.novel'));
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
 await vscode.commands.executeCommand('ogenkou.preview.open',uri);
 await until(()=>events().some(e=>e.type==='layout-progress'&&e.percent>0),'initial pagination makes measurable progress');
 let state=await inspect();assert(state.initializing&&!state.progressHidden);assert(state.refreshDisabled&&state.pdfDisabled&&state.applyDisabled&&state.freezeDisabled);assert.equal(state.paperScrollbar,'none');
 checks.push('initial layout locks repagination actions and hides paper scrollbar');
 await api.uiAction('settings');await until(()=>events().some(e=>e.type==='settings-result'),'settings available while initial layout runs');
 await api.uiAction('change',{key:'processing.toc',value:false});
 state=await inspect();assert(state.initializing&&state.applyDisabled);assert(state.paperOptions.every(s=>!s.includes('JIS')&&!s.includes('縦向き')));assert(state.paperOptions.some(s=>s.startsWith('B5')));assert.deepEqual(state.orientationOptions,['縦向き','横向き']);
 await api.uiAction('apply');await pause(100);assert(!events().some(e=>e.type==='settings-result'&&e.action==='save'));assert.equal(events().filter(e=>e.type==='layout-start').length,1);
 checks.push('draft can be edited but disabled Apply cannot restart initial layout');
 await until(()=>events().some(e=>e.type==='display'),'initial paper displayed');
 state=await inspect();assert(!state.initializing&&state.progressHidden);assert(!state.refreshDisabled&&!state.pdfDisabled&&!state.applyDisabled);assert.equal(state.paperFrameScrollbar,'none');
 const progress=events().filter(e=>e.type==='layout-progress');assert(progress.length>2&&progress.length<=101);assert(progress.every((e,i)=>e.percent>=0&&e.percent<=99&&(!i||e.percent>=progress[i-1].percent)));
 checks.push('progress is monotonic and actions unlock when complete paper is displayed');
 await api.uiAction('apply');await until(()=>events().some(e=>e.type==='settings-result'&&e.action==='save'),'Apply works after initial layout');
 await api.validate();await until(()=>events().some(e=>e.type==='oracle-result'&&e.fullMatches&&e.targetMatches),'fresh full paper matches');
 const diagnostics=api.diagnostics();await vscode.commands.executeCommand('ogenkou.preview.close');
 await fs.writeFile(output,JSON.stringify({checks,vscode:vscode.version,measurements:[],diagnostics},null,2));
};
