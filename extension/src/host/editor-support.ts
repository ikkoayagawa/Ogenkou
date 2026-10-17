import * as vscode from "vscode";
import {execFile} from "node:child_process";
import path from "node:path";
import {promisify} from "node:util";
import {naturalCompare} from "../services/snapshot-builder.js";
import {Worker} from "node:worker_threads";
const exec=promisify(execFile);
export function manuscriptCount(text:string,whitespace=false,notation='body',ruby='base'){
  const rubyText=(base:string,reading:string)=>ruby==='reading'?reading:ruby==='both'?base+reading:base;
  const visible=notation==='source'?text:text.replace(/(?:[｜|]([^《\r\n]+)|([\p{Script=Han}々〆ヶ]+))《([^《》\r\n]+)》/gu,(_,a,b,r)=>rubyText(a??b,r))
    .replace(/\[\[rb:([^>\r\n]+)>([^\r\n]+?)\]\]/gu,(_,b,r)=>rubyText(b,r)).replace(/《《([^\r\n]+?)》》/gu,'$1').replace(/\[\[emphasismark:([^>\]\r\n]+)(?:>[^\]\r\n]+)?\]\]/gu,'$1');
  return Array.from(whitespace?visible:visible.replace(/\s/gu,'')).length;
}
export function registerEditorSupport(context:vscode.ExtensionContext){
  const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,30);status.tooltip='ルビは親文字を数えます。小説記法を除き、Markdownの記号は文字数に含まれます。';let serial=0,timer:ReturnType<typeof setTimeout>|undefined;
  async function update(){
    const id=++serial,document=vscode.window.activeTextEditor?.document;if(!document||document.uri.scheme!=='file'||! /\.(novel|nv)$/iu.test(document.uri.path)){status.hide();return;}
    const configuration=vscode.workspace.getConfiguration('ogenkou'),whitespace=configuration.get('count.includeWhitespace',false),count=(text:string)=>manuscriptCount(text,whitespace,configuration.get('count.notation','body'),configuration.get('count.ruby','base')),current=count(document.getText()),root=vscode.Uri.joinPath(document.uri,'..');let total=0;
    try{const entries=await vscode.workspace.fs.readDirectory(root);for(const [name,type]of entries.filter(([n,t])=>t===vscode.FileType.File&&/\.(novel|nv)$/iu.test(n)).sort(([a],[b])=>naturalCompare(a,b))){const uri=vscode.Uri.joinPath(root,name),open=vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());total+=count(open?.getText()??new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));}
      let difference='';try{const {stdout:base}=await exec('git',['-C',root.fsPath,'show','HEAD:./'+path.basename(document.uri.fsPath)],{windowsHide:true,timeout:3000,maxBuffer:8*1024*1024});const delta=current-count(base);difference=` / HEAD ${delta>=0?'+':''}${delta}`;}catch{}
      if(id!==serial)return;status.text=`$(book) ${current.toLocaleString()}字 / 作品 ${total.toLocaleString()}字${difference}`;status.show();
    }catch{if(id===serial){status.text=`$(book) ${current.toLocaleString()}字`;status.show();}}
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void update(),250);};
  context.subscriptions.push(status,vscode.window.onDidChangeActiveTextEditor(schedule),vscode.workspace.onDidChangeTextDocument(schedule),vscode.workspace.onDidChangeConfiguration(schedule),{dispose(){clearTimeout(timer);serial++;}});schedule();
  let worker:Worker|undefined,highlightTimer:ReturnType<typeof setTimeout>|undefined,budgetTimer:ReturnType<typeof setTimeout>|undefined,generation=0,decorations:vscode.TextEditorDecorationType[]=[];
  let highlightedEditor:vscode.TextEditor|undefined,ruleKey='';
  const stopWorker=()=>{clearTimeout(budgetTimer);void worker?.terminate();worker=undefined;};
  const clearDecorations=()=>{decorations.splice(0).forEach(d=>d.dispose());};
  const highlight=()=>{
    const id=++generation;clearTimeout(highlightTimer);stopWorker();
    const editor=vscode.window.activeTextEditor,config=vscode.workspace.getConfiguration('ogenkou');
    const rules=config.get<{pattern:string;flags?:string;color?:string;backgroundColor?:string}[]>('highlight.rules',[]).slice(0,32);
    if(!editor||editor.document.languageId!=='novel'||!config.get('highlight.enabled',true)||!rules.length){clearDecorations();highlightedEditor=undefined;ruleKey='';return;}
    const key=JSON.stringify(rules);
    if(editor!==highlightedEditor||key!==ruleKey){clearDecorations();highlightedEditor=editor;ruleKey=key;}
    // Keep decoration types alive during edits. VS Code tracks their existing
    // ranges until the worker supplies replacements, avoiding an uncolored frame.
    highlightTimer=setTimeout(()=>{
      const version=editor.document.version;
      const currentWorker=new Worker(new URL('./highlight-worker.js',import.meta.url),{workerData:{text:editor.document.getText(),rules}});worker=currentWorker;
      budgetTimer=setTimeout(()=>{if(id===generation)stopWorker();},150);
      currentWorker.once('message',(rows:{ranges:{start:number;end:number}[]}[])=>{
        if(id!==generation||editor.document.version!==version||vscode.window.activeTextEditor!==editor)return;
        stopWorker();
        rows.forEach((row,i)=>{
          const decoration=decorations[i]??(decorations[i]=vscode.window.createTextEditorDecorationType({color:rules[i]?.color,backgroundColor:rules[i]?.backgroundColor}));
          editor.setDecorations(decoration,row.ranges.map(r=>new vscode.Range(editor.document.positionAt(r.start),editor.document.positionAt(r.end))));
        });
      });
      currentWorker.once('error',()=>{if(id===generation)stopWorker();});
    },180);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(highlight),vscode.workspace.onDidChangeTextDocument(event=>{if(event.document===vscode.window.activeTextEditor?.document)highlight();}),vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('ogenkou.highlight'))highlight();}),{dispose(){generation++;clearTimeout(highlightTimer);stopWorker();clearDecorations();}});highlight();
}
