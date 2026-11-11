import * as vscode from "vscode";
import path from "node:path";
import {writeFile} from "node:fs/promises";
const MANUSCRIPT_GLOB="**/*.{[nN][oO][vV][eE][lL],[nN][vV]}";
const isNovelFile=(name:string)=>/\.(novel|nv)$/iu.test(name);

const folderKey='ogenkou.cleanTextFolders';
const sameUri=(a:vscode.Uri,b:vscode.Uri)=>process.platform==='win32'?a.fsPath.toLowerCase()===b.fsPath.toLowerCase():a.toString()===b.toString();

export function registerCleanTextExport(context:vscode.ExtensionContext):void {
 let disposed=false,serial=0,timer:ReturnType<typeof setTimeout>|undefined,scan:vscode.CancellationTokenSource|undefined;
 async function refresh(){
  const generation=++serial;scan?.cancel();scan?.dispose();scan=new vscode.CancellationTokenSource();
  try{
   const files=await vscode.workspace.findFiles(MANUSCRIPT_GLOB,'**/{.git,node_modules,.recovery}/**',undefined,scan.token);
   if(disposed||generation!==serial)return;
   const folders=[...new Set(files.filter(uri=>uri.scheme==='file').map(uri=>vscode.Uri.joinPath(uri,'..').toString()))];
   await vscode.commands.executeCommand('setContext',folderKey,folders);
  }catch(error){if(!disposed&&generation===serial){await vscode.commands.executeCommand('setContext',folderKey,[]);console.warn('Ogenkou clean-text folder scan:',String(error));}}
 }
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),100);};
 const watcher=vscode.workspace.createFileSystemWatcher(MANUSCRIPT_GLOB,false,true,false);
 context.subscriptions.push(watcher,watcher.onDidCreate(schedule),watcher.onDidDelete(schedule),vscode.workspace.onDidRenameFiles(schedule),vscode.workspace.onDidChangeWorkspaceFolders(schedule),{dispose(){disposed=true;serial++;clearTimeout(timer);scan?.cancel();scan?.dispose();void vscode.commands.executeCommand('setContext',folderKey,[]);}});
 void refresh();
 context.subscriptions.push(vscode.commands.registerCommand('ogenkou.text.exportClean',async(value?:vscode.Uri)=>{
  const uri=value instanceof vscode.Uri?value:vscode.window.activeTextEditor?.document.uri;
  if(!uri||uri.scheme!=='file'){void vscode.window.showInformationMessage('Ogenkou: 原稿ファイルまたは作品フォルダーを右クリックしてください。');return;}
  try{
   const stat=await vscode.workspace.fs.stat(uri),folder=!!(stat.type&vscode.FileType.Directory);
   if(!folder&&!isNovelFile(uri.path))throw new Error('.novel／.nv原稿を選択してください。');
   const sources=folder?(await vscode.workspace.fs.readDirectory(uri)).filter(([name,type])=>type===vscode.FileType.File&&isNovelFile(name)).map(([name])=>vscode.Uri.joinPath(uri,name)):[uri];
   if(!sources.length){void vscode.window.showInformationMessage('Ogenkou: このフォルダー直下に原稿ファイルがありません。');return;}
   const name=folder?path.basename(uri.fsPath):path.basename(uri.fsPath).replace(/\.(novel|nv)$/iu,'');
   const output=vscode.Uri.joinPath(folder?uri:vscode.Uri.joinPath(uri,'..'),name+'.txt');
   const openOutput=()=>vscode.workspace.textDocuments.find(d=>sameUri(d.uri,output));
   if(openOutput()?.isDirty)throw new Error('出力先のtxtに未保存の編集があります。保存または破棄してから実行してください。');
   let existing:vscode.FileStat|undefined;
   try{existing=await vscode.workspace.fs.stat(output);}catch(error){if(!(error instanceof vscode.FileSystemError)||error.code!=='FileNotFound')throw error;}
   if(existing){if(existing.type!==vscode.FileType.File)throw new Error('出力先と同名のフォルダー等があります。');const answer=await vscode.window.showWarningMessage(name+'.txt は既にあります。上書きしますか？',{modal:true},'上書き');if(answer!=='上書き')return;}
   const documents:{document:vscode.TextDocument;version:number}[]=[];
   const files=await Promise.all(sources.map(async source=>{const document=vscode.workspace.textDocuments.find(d=>sameUri(d.uri,source));if(document){documents.push({document,version:document.version});return {name:path.basename(source.fsPath),text:document.getText()};}return {name:path.basename(source.fsPath),text:new TextDecoder('utf-8',{fatal:true}).decode(await vscode.workspace.fs.readFile(source))};}));
   const {mergeCleanManuscripts}=await import("../services/clean-text.js");
   const text=mergeCleanManuscripts(files);
   if(documents.some(d=>d.document.version!==d.version))throw new Error('書き出し中に原稿が編集されました。もう一度実行してください。');
   if(openOutput()?.isDirty)throw new Error('出力先のtxtに未保存の編集があります。');
   if(existing){const current=await vscode.workspace.fs.stat(output);if(current.mtime!==existing.mtime||current.size!==existing.size)throw new Error('確認後に出力先が変更されました。もう一度実行してください。');}
   await writeFile(output.fsPath,text,{encoding:'utf8',flag:existing?'w':'wx'});
   void vscode.window.showInformationMessage('Ogenkou: '+name+'.txt を出力しました。','開く').then(answer=>{if(answer==='開く')void vscode.window.showTextDocument(output);});
   return output;
  }catch(error){void vscode.window.showErrorMessage('Ogenkou: '+String(error));return;}
 }));
}
