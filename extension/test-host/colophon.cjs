const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async()=>{
 const workspace=process.env.OGENKOU_COLOPHON_WORKSPACE,result=process.env.OGENKOU_COLOPHON_RESULT,checks=[];
 const api=await vscode.extensions.getExtension('IkkoAyagawa.ogenkou').activate();
 async function until(predicate,label){const deadline=Date.now()+90000;while(Date.now()<deadline){const error=api.diagnostics()?.events.find(e=>['failure','input-failure','colophon-error'].includes(e.type));if(error)throw Error(JSON.stringify(error));if(await predicate()){checks.push(label);return;}await fs.writeFile(result+'.progress',JSON.stringify({checks,diagnostics:api.diagnostics()},null,2));await pause(100);}throw Error('Timeout: '+label);}
 const body=vscode.Uri.file(path.join(workspace,'01.nv'));await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(body));await vscode.commands.executeCommand('ogenkou.preview.open',body);
 await until(()=>api.diagnostics()?.events.some(e=>e.type==='display'),'initial preview');
 await api.uiAction('settings');
 await until(async()=>{await api.uiAction('inspect');await pause(150);return api.diagnostics()?.events.filter(e=>e.type==='ui-state').at(-1)?.colophonAvailable;},'add colophon button visible');
 await api.uiAction('colophon');
 const yaml=vscode.Uri.file(path.join(workspace,'99_okuduke.yaml'));
 await until(()=>vscode.window.activeTextEditor?.document.uri.toString()===yaml.toString(),'button creates and opens YAML');
 const original=await fs.readFile(yaml.fsPath,'utf8');assert.match(original,/template: okuduke/);assert.match(original,/試験の本/);assert.match(original,/試験の著者/);checks.push('metadata populated');
 assert.match(await fs.readFile(path.join(workspace,'styles/colophon.css'),'utf8'),/\.colophon/u);assert.match(await fs.readFile(path.join(workspace,'ogenkou.jsonc'),'utf8'),/colophon.css/u);checks.push('editable stylesheet registered');
 const doc=vscode.window.activeTextEditor.document;
 await until(()=>api.diagnostics()?.events.filter(e=>e.type==='input').length>=2&&api.diagnostics()?.events.filter(e=>e.type==='display').at(-1)?.revision===api.diagnostics()?.events.filter(e=>e.type==='input').at(-1)?.revision,'colophon displayed');
 const prior=api.diagnostics().events.filter(e=>e.type==='input').at(-1).revision;
 const offset=doc.getText().indexOf('試験の本'),edit=new vscode.WorkspaceEdit();edit.replace(yaml,new vscode.Range(doc.positionAt(offset),doc.positionAt(offset+'試験の本'.length)),'未保存の奥付');assert(await vscode.workspace.applyEdit(edit));
 await until(()=>api.diagnostics()?.events.filter(e=>e.type==='display').some(e=>e.revision>prior),'unsaved YAML edit refreshes preview');assert.equal(await fs.readFile(yaml.fsPath,'utf8'),original);checks.push('YAML remains unsaved');
 await api.validate();await until(()=>api.diagnostics()?.events.some(e=>e.type==='oracle-result'&&e.fullMatches&&e.targetMatches),'full layout comparison');
 await api.exportPdf(vscode.Uri.file(path.join(workspace,'colophon.pdf')));const pdf=await fs.readFile(path.join(workspace,'colophon.pdf'));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert(pdf.length>1000);assert(api.diagnostics().events.some(e=>e.type==='pdf-export'&&e.pages>1));checks.push('PDF export with unsaved colophon');
 const previousClicks=api.diagnostics().events.filter(e=>e.type==='source-revealed').length;await api.testClick();await until(()=>api.diagnostics()?.events.filter(e=>e.type==='source-revealed').length>previousClicks,'colophon click reveals YAML');assert.equal(vscode.window.activeTextEditor.document.uri.toString(),yaml.toString());
 await vscode.commands.executeCommand('ogenkou.colophon.add');assert.equal(doc.getText().includes('未保存の奥付'),true);assert.equal(await fs.readFile(yaml.fsPath,'utf8'),original);checks.push('repeat add preserves dirty YAML');
 const diagnostics=api.diagnostics();await vscode.commands.executeCommand('ogenkou.preview.close');await fs.writeFile(result,JSON.stringify({checks,diagnostics,vscode:vscode.version},null,2));
 await doc.save();
};
