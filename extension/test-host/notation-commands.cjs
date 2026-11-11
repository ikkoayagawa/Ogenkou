const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async()=>{
 const workspace=process.env.OGENKOU_ENTRY_WORKSPACE,result=process.env.OGENKOU_ENTRY_RESULT,checks=[];
 const extension=vscode.extensions.getExtension('IkkoAyagawa.ogenkou');assert(extension);await extension.activate();
 const uri=vscode.Uri.file(path.join(workspace,'01.nv')),document=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(document);
 const select=()=>editor.selections=[new vscode.Selection(0,0,0,1),new vscode.Selection(0,2,0,3)];select();
 await vscode.commands.executeCommand('ogenkou.text.addEmphasis');assert.equal(document.getText(),'《《春》》と《《夏》》。');checks.push('default emphasis command edits both selections');
 await vscode.commands.executeCommand('undo');assert.equal(document.getText(),'春と夏。');checks.push('one undo restores every selection');
 await vscode.workspace.getConfiguration('ogenkou',uri).update('editing.emphasisNotation','bracket',vscode.ConfigurationTarget.Workspace);select();
 await vscode.commands.executeCommand('ogenkou.text.addEmphasis');assert.equal(document.getText(),'[[emphasismark:春>﹅]]と[[emphasismark:夏>﹅]]。');checks.push('workspace notation setting changes inserted syntax');
 await vscode.commands.executeCommand('undo');assert.equal(document.getText(),'春と夏。');
 select();await vscode.commands.executeCommand('ogenkou.text.addRuby');assert.equal(document.getText(),'｜春《》と｜夏《》。');for(const selection of editor.selections){assert(selection.isEmpty);const offset=document.offsetAt(selection.active);assert.equal(document.getText().slice(offset-1,offset+1),'《》');}checks.push('ruby creates empty readings and positions both carets');
 await vscode.commands.executeCommand('type',{text:'よみ'});assert.equal(document.getText(),'｜春《よみ》と｜夏《よみ》。');checks.push('typing fills the empty readings directly');
 await vscode.commands.executeCommand('undo');assert.equal(document.getText(),'｜春《》と｜夏《》。');await vscode.commands.executeCommand('undo');assert.equal(document.getText(),'春と夏。');checks.push('ruby insertion has its own undo step');
 await vscode.workspace.getConfiguration('ogenkou',uri).update('editing.rubyNotation','bracket',vscode.ConfigurationTarget.Workspace);editor.selection=new vscode.Selection(0,0,0,1);await vscode.commands.executeCommand('ogenkou.text.addRuby');assert.equal(document.getText(),'[[rb:春>]]と夏。');const caret=document.offsetAt(editor.selection.active);assert.equal(document.getText().slice(caret-1,caret+2),'>]]');checks.push('bracket ruby also positions caret in empty reading');

 const contributions=extension.packageJSON.contributes;for(const [command,key]of [['ogenkou.text.addRuby','ctrl+alt+r'],['ogenkou.text.addEmphasis','ctrl+alt+e']]){assert(contributions.commands.some(c=>c.command===command));assert(contributions.keybindings.some(k=>k.command===command&&k.key===key&&k.when.includes('editorHasSelection')));}for(const [command,key] of [['ogenkou.text.addRuby','tab'],['ogenkou.text.addEmphasis','shift+tab']]){assert(contributions.keybindings.some(k=>k.command===command&&k.key===key&&k.when.includes('editorHasSelection')&&k.when.includes('!isComposing')));}assert(!contributions.keybindings.some(k=>['f2','f4'].includes(k.key)&&['ogenkou.text.addRuby','ogenkou.text.addEmphasis'].includes(k.command)));checks.push('commands and selection-only default shortcuts are contributed');
 await fs.writeFile(result,JSON.stringify({checks,vscode:vscode.version},null,2));
};
