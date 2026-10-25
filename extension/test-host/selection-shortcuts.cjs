const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async()=>{
 const output=process.env.OGENKOU_ENTRY_RESULT,root=process.env.OGENKOU_ENTRY_WORKSPACE,control=process.env.OGENKOU_SPACE_CONTROL,checks=[];
 const extension=vscode.extensions.getExtension('IkkoAyagawa.ogenkou');assert(extension);await extension.activate();
 const document=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'01.nv'))),editor=await vscode.window.showTextDocument(document);
 const reset=async(selected=true)=>{await editor.edit(e=>e.replace(new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),'原稿'));editor.selection=selected?new vscode.Selection(0,0,0,2):new vscode.Selection(0,2,0,2);await new Promise(r=>setTimeout(r,150));};
 const event=async(data)=>{const response=await fetch(control,{method:'POST',body:JSON.stringify(data)});if(!response.ok)throw Error(await response.text());};
 const until=async(expected)=>{const end=Date.now()+5000;while(Date.now()<end){if(document.getText()===expected)return;await new Promise(r=>setTimeout(r,30));}assert.equal(document.getText(),expected);};
 editor.options={insertSpaces:false,tabSize:4};
 await reset();await event({key:'Tab'});await until('｜原稿《》');checks.push('default Tab binding inserts ruby without user keybindings');
 await reset();await event({key:'Tab',shift:true});await until('《《原稿》》');checks.push('default Shift+Tab binding inserts emphasis');
 await reset(false);await event({key:'Tab'});await until('原稿\t');checks.push('unselected Tab remains indentation');
 await reset();await event({key:' ',text:' '});await until(' ');checks.push('selected Space remains normal text replacement');
 await reset();await editor.insertSnippet(new vscode.SnippetString().appendPlaceholder('原稿').appendText('続き').appendTabstop(0));await new Promise(r=>setTimeout(r,150));await event({key:'Tab'});await until('原稿続き');assert(editor.selection.isEmpty);checks.push('Tab navigates snippet placeholders instead of adding ruby');
 await vscode.commands.executeCommand('leaveSnippet');await reset();await event({composition:true});await new Promise(r=>setTimeout(r,100));await event({key:'Tab'});await new Promise(r=>setTimeout(r,200));assert(!document.getText().includes('｜')&&!document.getText().includes('《《'));checks.push('Tab during composition does not apply notation');
 await fs.writeFile(output,JSON.stringify({checks,vscode:vscode.version},null,2));
};
