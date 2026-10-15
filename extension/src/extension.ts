import * as vscode from "vscode";
import {writeFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import path from "node:path";
import {VSCodeWorkspace, VSCodePreferences} from "./host/vscode-adapters.js";
import {SnapshotBuilder} from "./services/snapshot-builder.js";
import {RenderInputBuilder} from "./services/render-input-builder.js";
import {CompilerService} from "./compiler/compiler-service.js";
import {previewInput} from "./preview/input.js";
import {BUILTIN_PUBLICATION, PUBLICATION_FIELDS, applyPublicationValues} from "./config/publication-editor.js";
import {RuntimeServer} from "./preview/runtime-server.js";
import {SettingsService, type SettingsView} from "./services/settings-service.js";
import type {RenderInput} from "./services/render-input-builder.js";
import {previewMarkup} from "./preview/webview.js";
import {SourceHistory,resolveSource,type SourcePosition} from "./preview/source-navigation.js";
import {calculateLayoutGeometry} from "./config/layout-geometry.js";
import {decodePaperSize,PAPER_PRESETS} from "./config/paper-size.js";
import {findBrowser,renderPdf} from "./services/pdf-export.js";
import {registerEditorSupport} from "./host/editor-support.js";

class PreviewSession {
  #server: RuntimeServer;
  #panel?: vscode.WebviewPanel;
  #workspace: VSCodeWorkspace;
  #snapshots: SnapshotBuilder;
  #compiler = new CompilerService(120000);
  #input: RenderInputBuilder;
  #abort = new AbortController();
  #closed = false;#busy = false;#dirty = false;#serial = 0;
  #rendererReady = false;#sentRevision?: number;
  #subscriptions: vscode.Disposable[] = [];
  #readyTimer?: ReturnType<typeof setTimeout>;
  readonly events: {type: string;revision?: number;pages?: number;message?:string;durationMs?:number;at?:number; [key:string]:unknown}[] = [];
  #position: {uri:string;offset:number;at?:number} = {uri:"",offset:0};
  #history=new SourceHistory();
  #renders=new Map<number,RenderInput>();
  #frontRevision=0;#committedRevision=0;#cwRevision=0;
  #laneRevisions=new Map<string,number>();
  #settings?:SettingsService;#settingsView?:SettingsView;
  #pdfBusy=false;
  #lastViewState="";
  #problems=vscode.languages.createDiagnosticCollection("ogenkou");
  #positions = new Map<string,{uri:string;offset:number;at:number}>();
  constructor(private readonly context: vscode.ExtensionContext, readonly manuscript: vscode.Uri,
    private readonly onClose: () => void) {
    const root = vscode.Uri.joinPath(manuscript, "..");
    this.#position={uri:manuscript.toString(),offset:vscode.window.activeTextEditor?.document.uri.toString()===manuscript.toString()?vscode.window.activeTextEditor.document.offsetAt(vscode.window.activeTextEditor.selection.active):0};
    this.#workspace = new VSCodeWorkspace(vscode, root);
    this.#snapshots = new SnapshotBuilder(this.#workspace.snapshotHost(),120000);
    this.#input = new RenderInputBuilder(this.#snapshots,this.#compiler);
    this.#server = new RuntimeServer(path.join(context.extensionPath,"dist/runtime"));
  }
  async open(): Promise<void> {
    try {
      const preferencesStore=new VSCodePreferences(this.context.globalState);
      const preferences = await preferencesStore.read(this.#abort.signal);
      const root=vscode.Uri.joinPath(this.manuscript,".."),config=vscode.Uri.joinPath(root,"ogenkou.jsonc");
      let exists=vscode.workspace.textDocuments.some(document=>document.uri.toString()===config.toString());
      if(!exists){try{await vscode.workspace.fs.stat(config);exists=true;}catch(error){if(!(error instanceof vscode.FileSystemError)||error.code!=="FileNotFound")throw error;}}
      if(!exists){const settings=new SettingsService(this.#workspace,preferencesStore);settings.activate(root.toString(),config.toString());try{await settings.initializeNew(this.#abort.signal);}finally{settings.close();}}
      const styles=vscode.Uri.joinPath(root,"styles"),css=vscode.Uri.joinPath(styles,"custom.css");
      try{await vscode.workspace.fs.stat(css);}catch(error){if(!(error instanceof vscode.FileSystemError)||error.code!=="FileNotFound")throw error;
        await vscode.workspace.fs.createDirectory(styles);await writeFile(css.fsPath,'/* Ogenkou: 作品CSS\n * 本文: p / 見出し: h1〜h6 / ルビ: ruby, rt\n * 傍点: .ogenkou-emphasis / 縦中横: .ogenkou-tcy\n * 目次: .ogenkou-toc, .ogenkou-toc-entry\n * 画像・リンク: img, a / リスト: ul, ol, li\n * 引用・コード: blockquote, pre, code / 表: table, thead, tbody, tr, th, td\n * 追加CSSを使うには ogenkou.jsonc の style に "styles/custom.css" を指定します。\n */\n/* p { color: #111; } */\n/* h1 { font-size: 1.6em; } */\n',{encoding:'utf8',flag:'wx'});
      }
      this.#snapshots.activate(this.manuscript.toString(),applyPublicationValues(BUILTIN_PUBLICATION,preferences.value.defaults,false));
      this.#settings=new SettingsService(this.#workspace,preferencesStore);this.#settings.activate(root.toString(),config.toString());
      await this.#server.start();if(this.#closed){await this.#server.close();return;}
      const base = this.#server.url,origin = new URL(base).origin,nonce = randomBytes(16).toString("hex");
      const panel = vscode.window.createWebviewPanel("ogenkou.preview","Ogenkou — "+path.basename(path.dirname(this.manuscript.fsPath)),vscode.ViewColumn.Beside,
        {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(this.context.extensionUri,"dist/runtime")]});
      this.#panel = panel;
      this.#readyTimer=setTimeout(()=>{
        const message="プレビューの初期化に失敗しました。再起動コマンドでやり直してください。";
        this.events.push({type:"failure",message});void panel.webview.postMessage({type:"status",message});
        void vscode.window.showErrorMessage("Ogenkou: "+message);
      },30000);
      this.#subscriptions.push(panel.onDidDispose(()=>{void this.close();}),panel.onDidChangeViewState(()=>{
        this.events.push({type:panel.visible?"visible":"hidden"});if(panel.visible)this.refresh();
      }),panel.webview.onDidReceiveMessage((message: unknown)=>{
        if(!message||typeof message!=="object")return;
        const value=message as {type?: string;revision?: number;pages?:number;message?:string;durationMs?:number};
        if(value.type==="refresh")this.refresh(true);
        if(value.type==="settings")void this.#settingsMessage(value as any);
        if(value.type==="source-click")void this.#sourceClick((value as any).position).catch(error=>vscode.window.showWarningMessage("Ogenkou: "+String(error)));
        if(value.type==="request-target")void this.#navigationTarget(value as any);
        if(value.type==="view-preferences"){const tab=(value as any).settingsTab;if(["publication","layout","furniture","processing"].includes(tab))void this.context.workspaceState.update("preview:"+root.toString(),{...this.context.workspaceState.get<Record<string,unknown>>("preview:"+root.toString(),{}),settingsTab:tab});}
        if(value.type==="pdf")void this.exportPdf().catch(()=>{});
        if(value.type==="view-state"||value.type==="click-diagnostic"){
          this.events.push({...value,type:value.type,at:Date.now()});
          if(value.type==="view-state"){const v=value as any,state={...this.context.workspaceState.get<Record<string,unknown>>("preview:"+root.toString(),{}),mode:v.mode,zoomSetting:v.zoomSetting,fit:v.fit,page:v.page},serialized=JSON.stringify(state);if(serialized!==this.#lastViewState){this.#lastViewState=serialized;void this.context.workspaceState.update("preview:"+root.toString(),state);}}
        }
        if(["ready","display","failure","layout-start","layout-end","layout-progress","ui-state","paper-layout","wheel-test","reuse-profile","s-start","s-end","seed-import-end","seed-received","reuse-unavailable","oracle-result"].includes(value.type??"")){
          this.events.push({...value,type:value.type!,at:Date.now()});
          if(this.events.length>2000)this.events.splice(0,this.events.length-2000);
          if(value.type==="ready"){clearTimeout(this.#readyTimer);this.#rendererReady=true;void panel.webview.postMessage({type:"view-options",mode:vscode.workspace.getConfiguration("ogenkou").get("preview.mode","single"),...this.context.workspaceState.get<Record<string,unknown>>("preview:"+root.toString(),{})});this.refresh(true);}
          if(value.type==="display")this.#frontRevision=value.revision??0;
          if(value.type==="seed-import-end")this.#committedRevision=value.revision??0;
          if(value.type==="layout-start")this.#cwRevision=value.revision??0;
          if(value.type==="s-start")this.#laneRevisions.set((value as any).lane,value.revision??0);
          if(value.type==="failure")void vscode.window.showErrorMessage("Ogenkou: "+(value.message??"プレビューに失敗しました。"));
        }
      }));
      const script=panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,"dist/runtime/core.js"));
      panel.webview.html=previewMarkup(nonce,panel.webview.cspSource,origin,base,String(script));
      const belongs=(uri: vscode.Uri)=>uri.scheme==="file"&&uri.fsPath.toLowerCase().startsWith(root.fsPath.toLowerCase()+path.sep);
      const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,"**/*"));
      this.#subscriptions.push(watcher,vscode.workspace.onDidChangeTextDocument(event=>{if(event.contentChanges.length&&belongs(event.document.uri)){
          if(/\.(?:novel|nv)$/iu.test(event.document.uri.path)){
            this.#history.record(event.document.uri.toString(),event.document.version,event.contentChanges.map(c=>({start:c.rangeOffset,end:c.rangeOffset+c.rangeLength,text:c.text})));
            const change=event.contentChanges[0]!;this.#position={uri:event.document.uri.toString(),offset:change.rangeOffset+change.text.length};
            const edit={...this.#position,at:Date.now()};this.#positions.set(this.#position.uri+":"+event.document.version,edit);
            if(this.#positions.size>200)this.#positions.delete(this.#positions.keys().next().value!);
            void panel.webview.postMessage({type:"raw-edit",at:edit.at});this.events.push({type:"edit",at:edit.at,version:event.document.version});
          }else if(event.document.uri.toString()===config.toString())void panel.webview.postMessage({type:"settings-invalidated"});this.refresh();}}),
        watcher.onDidCreate(()=>this.refresh()),watcher.onDidChange(()=>this.refresh()),watcher.onDidDelete(()=>this.refresh()),
        vscode.window.onDidChangeTextEditorSelection(event=>{if(vscode.workspace.getConfiguration("ogenkou").get("preview.followCursor",false)&&belongs(event.textEditor.document.uri)&&/\.(novel|nv)$/iu.test(event.textEditor.document.uri.path)){
          this.#position={uri:event.textEditor.document.uri.toString(),offset:event.textEditor.document.offsetAt(event.selections[0]!.active),at:Date.now()};void panel.webview.postMessage({type:"source-focus"});this.refresh(true);}}));
    }catch(error){await this.close();throw error;}
  }
  reveal(): void {this.#panel?.reveal(vscode.ViewColumn.Beside,true);}
  refresh(force=false): void {if(this.#closed||!force&&!vscode.workspace.getConfiguration("ogenkou").get("preview.autoUpdate",true))return;if(force)this.#sentRevision=undefined;this.#dirty=true;void this.#drive();}
  async #drive(): Promise<void> {
    if(this.#closed||this.#busy||!this.#panel||!this.#rendererReady)return;this.#busy=true;
    try {
      while(this.#dirty&&!this.#closed){
        this.#dirty=false;
        try {
          const input=await this.#input.build({signal:this.#abort.signal});if(this.#closed)return;
          if(input.document.revision===this.#sentRevision)continue;
          const captured=input.snapshot.sources.map(part=>this.#positions.get(part.uri+":"+part.editorVersion)).filter(item=>item!==undefined).sort((a,b)=>b.at-a.at)[0];
          const source=previewInput(input,this.#position.at!==undefined&&this.#position.at>(captured?.at??0)?this.#position:captured??this.#position);
          this.#problems.clear();for(const part of input.snapshot.sources){const document=vscode.workspace.textDocuments.find(d=>d.uri.toString()===part.uri);if(document)this.#problems.set(document.uri,input.document.diagnostics.filter(d=>d.uri===part.uri).map(d=>new vscode.Diagnostic(new vscode.Range(document.positionAt(d.start),document.positionAt(d.end)),d.message,vscode.DiagnosticSeverity.Warning)));}
          this.#renders.set(source.revision,input);
          const retained=new Set([source.revision,this.#frontRevision,this.#committedRevision,this.#cwRevision,...this.#laneRevisions.values()]);
          for(const revision of [...this.#renders.keys()].slice(0,-32))if(!retained.has(revision))this.#renders.delete(revision);
          const at=Date.now();this.events.push({type:"input",revision:source.revision,at,receivedAt:captured?.at,portable:source.portable,fragment:source.fragment});
          if(await this.#panel.webview.postMessage({type:"input",epoch:1,request:++this.#serial,source,receivedAt:captured?.at??at}))this.#sentRevision=input.document.revision;
        }catch(error){if(this.#closed)return;const message=error instanceof Error?error.message:String(error);
          this.events.push({type:"input-failure",message});await this.#panel.webview.postMessage({type:"status",message});
          void vscode.window.showErrorMessage("Ogenkou: "+message);
        }
      }
    }finally{this.#busy=false;}
  }
  validate(){return this.#panel?.webview.postMessage({type:"oracle"});}
  navigate(page:number){return this.#panel?.webview.postMessage({type:"navigate",page});}
  viewOptions(options:{mode?:string;zoom?:number}){return this.#panel?.webview.postMessage({type:"view-options",...options});}
  testClick(){return this.#panel?.webview.postMessage({type:"test-click"});}
  uiAction(action:string,data:Record<string,unknown>={}){return this.#panel?.webview.postMessage({type:"test-ui",action,...data});}
  async #sourceClick(position:SourcePosition){
    const input=this.#renders.get(position.revision),resolved=input&&resolveSource(input,position);if(!resolved)throw Error("表示版の原稿位置を解決できません。プレビューを更新してください。");
    const document=await vscode.workspace.openTextDocument(vscode.Uri.parse(resolved.uri));
    const captured=input!.snapshot.sources.find(s=>s.uri===resolved.uri)!;
    const offset=document.getText()===captured.text?resolved.offset:this.#history.rebase(resolved.uri,resolved.offset,resolved.version,document.version);
    if(offset===null)throw Error("原稿の変更履歴が不足しています。プレビューを更新してから移動してください。");
    const editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preserveFocus:false});if(this.#closed)return;
    const point=document.positionAt(offset);editor.selection=new vscode.Selection(point,point);editor.revealRange(new vscode.Range(point,point),vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.events.push({type:"source-revealed",revision:position.revision,at:Date.now(),uri:resolved.uri,offset});
  }
  async #navigationTarget(message:{position:SourcePosition;intent:number;revision:number;targetRequest?:number}){
    const reply=(data:Record<string,unknown>)=>this.#panel?.webview.postMessage({type:"source-target",revision:message.revision,intent:message.intent,targetRequest:message.targetRequest,...data});
    const old=this.#renders.get(message.position.revision),current=this.#renders.get(message.revision),position=old&&resolveSource(old,message.position);if(!position||!current){await reply({});return;}
    const part=current.snapshot.sources.find(s=>s.uri===position.uri),prior=old!.snapshot.sources.find(s=>s.uri===position.uri);if(!part){await reply({});return;}
    const offset=prior?.text===part.text?position.offset:part.editorVersion===undefined?null:this.#history.rebase(position.uri,position.offset,position.version,part.editorVersion);
    if(offset===null){await reply({});return;}const source=previewInput(current,{uri:position.uri,offset});await reply({fragment:source.fragment,target:source.target});
  }
  async #settingsMessage(message:{action:string;request:number;target:"project"|"defaults";token?:string;changes?:Record<string,unknown>;values?:Record<string,unknown>}){
    const reply=(data:Record<string,unknown>)=>this.#panel?.webview.postMessage({type:"settings-result",request:message.request,...data});
    try{
      if(!this.#settings||!["project","defaults"].includes(message.target))throw Error("設定対象が不正です。");
      if(message.action==="geometry"){this.events.push({type:"settings-geometry",at:Date.now()});const settings=applyPublicationValues(BUILTIN_PUBLICATION,message.values??{});await reply({geometry:calculateLayoutGeometry(message.values??{},decodePaperSize(settings.layout.pageSize,PAPER_PRESETS))});return;}
      if(message.action==="save"||message.action==="freeze"){
        const view=this.#settingsView;if(!view||view.token!==message.token||view.target!==message.target)throw Error("設定を読み直してください。");
        if(message.action==="save")await this.#settings.save(view,message.changes??{},this.#abort.signal);else await this.#settings.freezeLegacy(view,this.#abort.signal);
        this.refresh();
      }else if(message.action!=="read")throw Error("設定操作が不正です。");
      const view=await this.#settings.read(message.target,this.#abort.signal);this.#settingsView=view;const publication=applyPublicationValues(BUILTIN_PUBLICATION,view.values,false);await reply({view,fields:PUBLICATION_FIELDS,applied:message.action==="save",geometry:calculateLayoutGeometry(view.values,decodePaperSize(publication.layout.pageSize,PAPER_PRESETS))});this.events.push({type:"settings-result",action:message.action,at:Date.now()});
    }catch(error){await reply({error:error instanceof Error?error.message:String(error)});}
  }
  async exportPdf(destination?:vscode.Uri){
    if(this.#closed||this.#pdfBusy)return;this.#pdfBusy=true;
    try{
      const chosen=destination??await vscode.window.showSaveDialog({defaultUri:vscode.Uri.joinPath(this.manuscript,"..",path.basename(path.dirname(this.manuscript.fsPath))+".pdf"),filters:{PDF:["pdf"]}});if(!chosen)return;
      let exists=false;try{await vscode.workspace.fs.stat(chosen);exists=true;}catch(error){if(!(error instanceof vscode.FileSystemError)||error.code!=="FileNotFound")throw error;}
      // The save dialog already confirms replacement; direct paths bypass it.
      if(destination&&exists&&await vscode.window.showWarningMessage("既存のPDFを上書きしますか？",{modal:true},"上書き")!=="上書き")return;
      const browser=await findBrowser(vscode.workspace.getConfiguration("ogenkou").get<string>("pdf.browserPath")||undefined);
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:"Ogenkou: PDFを書き出しています",cancellable:true},async(progress,token)=>{
        const abort=new AbortController(),cancel=token.onCancellationRequested(()=>abort.abort()),close=()=>abort.abort();this.#abort.signal.addEventListener("abort",close,{once:true});
        try{
          progress.report({message:"未保存の原稿と資源を取得"});const snapshots=new SnapshotBuilder(this.#workspace.snapshotHost(),120000),compiler=new CompilerService(120000);
          let input:RenderInput;try{snapshots.activate(this.manuscript.toString());input=await new RenderInputBuilder(snapshots,compiler).build({signal:abort.signal});}finally{snapshots.close();await compiler.close();}
          progress.report({message:"全文組版とPDF生成"});const result=await renderPdf(input,path.join(this.context.extensionPath,"dist/runtime"),browser,abort.signal);abort.signal.throwIfAborted();
          await vscode.workspace.fs.writeFile(chosen,result.bytes);this.events.push({type:"pdf-export",pages:result.pages,at:Date.now()});
          void vscode.window.showInformationMessage("Ogenkou: PDFを書き出しました。"+(result.pages??"")+"ページ");
        }finally{cancel.dispose();this.#abort.signal.removeEventListener("abort",close);}
      });
    }catch(error){if((error as Error).name!=="AbortError")void vscode.window.showErrorMessage("Ogenkou: "+String(error));throw error;}
    finally{this.#pdfBusy=false;}
  }
  get diagnostics(){return {closed:this.#closed,runtimeUrl:this.#server.url,events:[...this.events]};}
  async close(): Promise<void> {
    if(this.#closed)return;this.#closed=true;clearTimeout(this.#readyTimer);this.#abort.abort();this.#snapshots.close();
    this.#subscriptions.splice(0).forEach(item=>item.dispose());this.#panel?.dispose();this.#panel=undefined;
    this.#settings?.close();this.#problems.dispose();this.#renders.clear();this.#workspace.dispose();await this.#compiler.close();await this.#server.close();this.events.push({type:"closed"});this.onClose();
  }
}
let session: PreviewSession|undefined;
export async function activate(context: vscode.ExtensionContext) {
  registerEditorSupport(context);
  let opening: Promise<void>|undefined;
  const open=async(uri?: vscode.Uri)=>{
    if(opening)await opening;
    const target=uri instanceof vscode.Uri?uri:vscode.window.activeTextEditor?.document.uri;
    const selected=target?.scheme==="file"&&/\.(?:novel|nv)$/iu.test(target.path)?target:(await vscode.window.showOpenDialog({canSelectMany:false,filters:{"小説原稿":["novel","nv"]}}))?.[0];
    if(!selected)return;
    if(session?.manuscript.toString()===selected.toString()){session.reveal();return;}
    opening=(async()=>{await session?.close();const next=new PreviewSession(context,selected,()=>{if(session===next)session=undefined;});session=next;await next.open();})();
    try{await opening;}catch(error){void vscode.window.showErrorMessage("Ogenkou: "+String(error));}finally{opening=undefined;}
  };
  context.subscriptions.push(vscode.commands.registerCommand("ogenkou.preview.open",open),
    vscode.commands.registerCommand("ogenkou.preview.refresh",()=>session?.refresh(true)),
    vscode.commands.registerCommand("ogenkou.preview.restart",async()=>{const target=session?.manuscript;if(target){await session?.close();await open(target);}}),
    vscode.commands.registerCommand("ogenkou.preview.close",()=>session?.close()));
  context.subscriptions.push(vscode.commands.registerCommand("ogenkou.pdf.export",async()=>{if(!session)await open();await session?.exportPdf();}));
  return {diagnostics:()=>session?.diagnostics,navigate:(page:number)=>session?.navigate(page),validate:()=>session?.validate(),viewOptions:(options:{mode?:string;zoom?:number})=>session?.viewOptions(options),testClick:()=>session?.testClick(),uiAction:(action:string,data:Record<string,unknown>)=>session?.uiAction(action,data),exportPdf:(uri:vscode.Uri)=>session?.exportPdf(uri)};
}
export async function deactivate(){await session?.close();}
