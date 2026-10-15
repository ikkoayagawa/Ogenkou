import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {access,readFile,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {createCoreMemoryInput} from "./core-memory-input.js";
import type {RenderInput} from "./render-input-builder.js";

export async function findBrowser(configured?:string):Promise<string>{
  const candidates=configured?[configured]:[
    path.join(process.env.PROGRAMFILES??"C:/Program Files","Google/Chrome/Application/chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"]??"C:/Program Files (x86)","Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.PROGRAMFILES??"C:/Program Files","Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.LOCALAPPDATA??"","Google/Chrome/Application/chrome.exe"),
  ];
  for(const candidate of candidates){try{await access(candidate);return candidate;}catch{}}
  throw Error(configured?"指定されたブラウザが見つかりません。ogenkou.pdf.browserPathを確認してください。":"Chrome／Edge／Chromiumを検出できません。ogenkou.pdf.browserPathで実行ファイルを指定してください。");
}
class CDP {
  #serial=0;#pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(readonly socket:WebSocket){socket.addEventListener("message",event=>{const m=JSON.parse(String(event.data));const p=this.#pending.get(m.id);if(!p)return;this.#pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);});socket.addEventListener("close",()=>this.close());}
  send(method:string,params:Record<string,unknown>={},sessionId?:string):Promise<any>{return new Promise((resolve,reject)=>{const id=++this.#serial,timer=setTimeout(()=>{this.#pending.delete(id);reject(Error("ブラウザ処理が時間内に完了しませんでした。"));},120000);this.#pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params,sessionId}));});}
  close(){for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(Error("ブラウザとの接続が終了しました。"));}this.#pending.clear();this.socket.close();}
}
/** Fixed captured HTML/CSS/assets; the installed browser is never downloaded. */
export async function renderPdf(input:RenderInput,runtimeDirectory:string,browserPath:string,signal:AbortSignal) {
  signal.throwIfAborted();const memory=createCoreMemoryInput(input).source;
  const source={...memory,resources:memory.resources.map(r=>typeof r.content==="string"?r:{url:r.url,mediaType:r.mediaType,base64:Buffer.from(r.content).toString("base64")})};
  const encoded=Buffer.from(JSON.stringify(source)).toString("base64"),core=await readFile(path.join(runtimeDirectory,"core.js"));
  const prefix='/'+randomBytes(24).toString('hex')+'/';
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}#viewport{width:1100px;height:850px}</style></head><body><div id="viewport"></div><script src="${prefix}core.js"></script><script>
  (async()=>{try{const source=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0))));source.resources=source.resources.map(r=>r.base64===undefined?r:{...r,content:Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)).buffer});const viewer=new VivliostyleCore.CoreViewer({window,viewportElement:document.getElementById('viewport')},{autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});await new Promise((resolve,reject)=>{viewer.addListener('loaded',e=>{if(e.revision===source.revision)resolve()});viewer.addListener('error',()=>reject(Error('PDFの組版に失敗しました。')));viewer.loadMemoryDocument(source)});await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));const packet=viewer.exportCompletedPaper('pdf');window.pdfResult={pages:packet.pages.length,texts:packet.pages.map(p=>new DOMParser().parseFromString(p.html,'text/html').body.textContent),dimensions:packet.pages.map(p=>p.dimensions),revision:source.revision};}catch(e){window.pdfError=e.message}})();</script></body></html>`;
  const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.method==='GET'&&req.url===prefix+'core.js'){res.setHeader("Content-Type","text/javascript");res.end(core);}else if(req.method==='GET'&&req.url===prefix){res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);}else{res.writeHead(404);res.end();}});
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const address=server.address();if(!address||typeof address==="string")throw Error("PDF server failed");
  const profile=await mkdtemp(path.join(tmpdir(),"ogenkou-pdf-"));
  const child=spawn(browserPath,["--headless=new","--no-first-run","--no-default-browser-check","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:"ignore"});
  let launchError:Error|undefined;child.on("error",error=>{launchError=error;});let cdp:CDP|undefined;
  const abort=()=>{cdp?.close();child.kill();};signal.addEventListener("abort",abort,{once:true});
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  try{
    const deadline=Date.now()+120000;let portFile="";
    while(!portFile){signal.throwIfAborted();if(launchError)throw launchError;if(child.exitCode!==null)throw Error("PDF用ブラウザが終了しました。");if(Date.now()>deadline)throw Error("PDF用ブラウザが起動しませんでした。");try{portFile=await readFile(path.join(profile,"DevToolsActivePort"),"utf8");}catch{await pause();}}
    const [port,endpoint]=portFile.trim().split(/\r?\n/);const socket=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("ブラウザ接続が時間内に完了しませんでした。")),10000);socket.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener("error",()=>{clearTimeout(timer);reject(Error("ブラウザへ接続できません。"));},{once:true});});cdp=new CDP(socket);
    const {targetId}=await cdp.send("Target.createTarget",{url:"about:blank"});const {sessionId}=await cdp.send("Target.attachToTarget",{targetId,flatten:true});
    const send=(method:string,params:Record<string,unknown>={})=>cdp!.send(method,params,sessionId);
    await send("Page.enable");await send("Page.navigate",{url:`http://127.0.0.1:${address.port}${prefix}`});let result:any;
    while(!result){signal.throwIfAborted();if(Date.now()>deadline)throw Error("PDF組版が時間内に完了しませんでした。");const value=await send("Runtime.evaluate",{expression:"({result:window.pdfResult,error:window.pdfError})",returnByValue:true});if(value.result?.value?.error)throw Error(value.result.value.error);result=value.result?.value?.result;if(!result)await pause();}
    const pdf=await send("Page.printToPDF",{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,generateTaggedPDF:true});
    return {bytes:Buffer.from(pdf.data,"base64"),...result,browser:browserPath};
  }finally{
    signal.removeEventListener("abort",abort);cdp?.close();child.kill();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
    await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200}).catch(()=>{});
  }
}
