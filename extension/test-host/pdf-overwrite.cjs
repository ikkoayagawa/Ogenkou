const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async()=>{
 const workspace=process.env.OGENKOU_ENTRY_WORKSPACE,output=process.env.OGENKOU_ENTRY_RESULT,checks=[];
 const api=await vscode.extensions.getExtension('IkkoAyagawa.ogenkou').activate();
 const source=vscode.Uri.file(path.join(workspace,'first/01.novel'));
 await vscode.commands.executeCommand('ogenkou.preview.open',source);
 const deadline=Date.now()+30000;
 while(!api.diagnostics()?.events.some(e=>e.type==='display')){const failure=api.diagnostics()?.events.find(e=>e.type==='failure');if(failure)throw Error(failure.message);if(Date.now()>deadline)throw Error('initial preview timed out');await new Promise(r=>setTimeout(r,40));}
 checks.push('production preview initializes with tabbed settings support');
 const existing=vscode.Uri.file(path.join(workspace,'existing.pdf')),fresh=vscode.Uri.file(path.join(workspace,'new.pdf'));
 const sentinel=Buffer.from('existing PDF sentinel');await fs.writeFile(existing.fsPath,sentinel);
 const original={showSaveDialog:vscode.window.showSaveDialog,showWarningMessage:vscode.window.showWarningMessage,withProgress:vscode.window.withProgress};
 let saves=0,warnings=0,jobs=0,selection=existing,approval;
 try{
  // Exercise the real extension export entry; stop before rendering/writing.
  vscode.window.showSaveDialog=async()=>{saves++;return selection;};
  vscode.window.showWarningMessage=async()=>{warnings++;return approval;};
  vscode.window.withProgress=async()=>{jobs++;};
  await api.exportPdf();assert.deepEqual([saves,warnings,jobs],[1,0,1]);checks.push('save-dialog selection does not trigger a second overwrite confirmation');
  await api.exportPdf(existing);assert.deepEqual([saves,warnings,jobs],[1,1,1]);checks.push('direct existing destination still requires confirmation and can cancel');
  approval='上書き';await api.exportPdf(existing);assert.deepEqual([saves,warnings,jobs],[1,2,2]);checks.push('direct overwrite proceeds after confirmation');
  await api.exportPdf(fresh);assert.deepEqual([saves,warnings,jobs],[1,2,3]);checks.push('new direct destination needs no confirmation');
  selection=undefined;await api.exportPdf();assert.deepEqual([saves,warnings,jobs],[2,2,3]);checks.push('cancelled save dialog does not start export');
  assert.deepEqual(await fs.readFile(existing.fsPath),sentinel);checks.push('dialog checks leave the existing file intact');
 }finally{Object.assign(vscode.window,original);await vscode.commands.executeCommand('ogenkou.preview.close');}
 await fs.writeFile(output,JSON.stringify({checks,vscode:vscode.version},null,2));
};
