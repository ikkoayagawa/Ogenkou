const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async()=>{
 const workspace=process.env.OGENKOU_ENTRY_WORKSPACE,output=process.env.OGENKOU_ENTRY_RESULT,checks=[];
 const extension=vscode.extensions.getExtension('IkkoAyagawa.ogenkou');assert(extension);const api=await extension.activate();
 const until=async(predicate,label)=>{const end=Date.now()+60000;while(Date.now()<end){const failure=api.diagnostics()?.events.find(e=>['failure','input-failure'].includes(e.type));if(failure)throw Error(JSON.stringify(failure));if(predicate())return;await pause(50);}throw Error('Timeout: '+label+' '+JSON.stringify(api.diagnostics()));};
 const uri=n=>vscode.Uri.file(path.join(workspace,'book',n+'.nv'));
 const filler=async(n,column)=>vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'filler'+n+'.txt'))),{viewColumn:column,preview:false});
 await filler(1,vscode.ViewColumn.One);
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('02')),{viewColumn:vscode.ViewColumn.Two,preview:false});await filler(2,vscode.ViewColumn.Two);
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('01')),{viewColumn:vscode.ViewColumn.Three,preview:false});
 const origin=vscode.window.tabGroups.activeTabGroup,second=vscode.window.tabGroups.all.find(g=>g.viewColumn===vscode.ViewColumn.Two);
 await vscode.commands.executeCommand('ogenkou.preview.open',uri('01'));
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='seed-import-end'),'committed document');
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'initial preview');
 assert.equal(api.diagnostics().events.filter(e=>e.type==='display').at(-1).pages,3,'three separately paginated source files');
 await filler(3,origin.viewColumn);
 const occurrences=target=>vscode.window.tabGroups.all.flatMap(g=>g.tabs).filter(t=>t.input instanceof vscode.TabInputText&&t.input.uri.toString()===target.toString()).length;
 const click=async(index,name,group,label)=>{
  const displays=api.diagnostics().events.filter(e=>e.type==='display').length;await api.navigate(index);await until(()=>api.diagnostics().events.filter(e=>e.type==='display').length>displays,'page '+index);
  const n=api.diagnostics().events.filter(e=>e.type==='source-revealed').length;await api.testClick();await until(()=>api.diagnostics().events.filter(e=>e.type==='source-revealed').length>n,label);
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(),uri(name).toString(),label+' source');assert.equal(vscode.window.activeTextEditor.viewColumn,group.viewColumn,label+' group');assert.equal(occurrences(uri(name)),1,label+' no duplicate tab');checks.push(label);
 };
 await click(0,'01',origin,'hidden source tab in third pane is reused');
 await click(1,'02',second,'hidden source tab in another pane is reused');
 assert.equal(occurrences(uri('03')),0);await click(2,'03',origin,'unopened source is added to invoking pane');
 await vscode.commands.executeCommand('ogenkou.preview.restart');await until(()=>api.diagnostics()?.events.some(e=>e.type==='seed-import-end'),'restart');await click(2,'03',origin,'origin survives preview restart');
 await vscode.commands.executeCommand('ogenkou.preview.close');await fs.writeFile(output,JSON.stringify({checks,vscode:vscode.version},null,2));
};
