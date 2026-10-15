import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolveGeneratedPosition} from '../dist/src/compiler/manuscript.js';
import {compileVfmManuscript as compileManuscript} from '../dist/src/compiler/vfm-manuscript.js';
import {BUILTIN_PUBLICATION} from '../dist/src/config/publication-editor.js';
const root=path.resolve(import.meta.dirname,'../..');
const require=createRequire(path.join(root,'experiments/preview-benchmark/package.json'));
const {chromium}=require('playwright');
const output=path.join(root,'.recovery/compiler-host');await fs.mkdir(output,{recursive:true});
function fixture(text,horizontal=false){
  const settings=structuredClone(BUILTIN_PUBLICATION);
  if(horizontal){settings.writingMode='horizontal';settings.processing.automaticTcy=false;settings.processing.verticalQuotes=false;settings.processing.kanaMarks=false;}
  return {work:'file:///work/',epoch:1,revision:1,fingerprint:'fixture',content:text,boundaries:[],
    sources:[{uri:'file:///work/01.novel',text,virtualStart:0,virtualEnd:text.length,dirty:true}],
    configText:'{}',config:{title:'検証',theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:false};
}
const server=http.createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname;
  if(name==='/'){response.end('<!doctype html><div id="viewport" style="width:1000px;height:850px"></div><script src="/core.js"></script>');return;}
  const filename=name==='/core.js'?path.join(root,'vivliostyle/packages/core/lib/vivliostyle.iife.js'):path.resolve(root,'vivliostyle/packages/core/resources',name.slice('/resources/'.length));
  if((name==='/core.js'||name.startsWith('/resources/'))&&filename.startsWith(path.join(root,'vivliostyle/packages/core'))&&fsSync.existsSync(filename)&&fsSync.statSync(filename).isFile()){
    response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.xml')?'application/xml':'application/octet-stream');response.end(fsSync.readFileSync(filename));
  }else{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const cases=[];
const chromeVersion=browser.version();
try{
 for(const [name,input,horizontal] of [
  ['vertical','｜親文字《よみ》 漢字《かんじ》 《《傍点》》 😀 12 か\u3099\n'.repeat(40),false],
  ['horizontal','[[rb:親文字>よみ]] [[emphasismark:本文]] `無変換12`\n'.repeat(40),true],
  ['toc','[[toc]]\n\n# ｜第一章《だいいっしょう》\n\n本文。\n\n'.repeat(3),false]]){
  const compiled=compileManuscript(fixture(input,horizontal));const page=await browser.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.VivliostyleCore);
  const result=await page.evaluate(async({compiled,origin})=>{
    const parsed=new DOMParser().parseFromString(compiled.html,'text/html');
    for(const entry of compiled.sourceMap){let node=parsed.documentElement;for(const i of entry.path)node=node.childNodes[i];if(node?.nodeType!==3||node.nodeValue!==entry.text)throw Error('Compiler sidecar/parsed DOM mismatch');}
    const viewer=new VivliostyleCore.CoreViewer({viewportElement:document.getElementById('viewport'),userAgentRootURL:origin+'/resources/'},
      {autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});
    const start=performance.now();await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Core timeout')),60000);
      viewer.addListener('loaded',()=>{clearTimeout(timer);resolve();});viewer.addListener('error',event=>{clearTimeout(timer);reject(Error(JSON.stringify(event)));});
      viewer.loadMemoryDocument({url:origin+'/document.html',revision:compiled.revision,html:compiled.html,sourceMap:compiled.sourceMap,resources:[]},{authorStyleSheet:[{text:compiled.css}]});
    });
    await viewer.waitForPreviewResources({complete:true});
    const packet=viewer.exportCompletedPaper('compiler-smoke'),positions=[];
    if(!packet.pages.length)throw Error('No completed paper');
    const holder=document.createElement('div');document.body.append(holder);
    const host=new VivliostyleCore.CompletedPaperHost(packet,holder,'compiler-smoke');await host.awaitReady();
    const handle=host.retainPages(packet.pages.map((_,index)=>index));
    for(const container of handle.containers){const walk=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const position=handle.resolveTextPosition(walk.currentNode,0);if(position)positions.push({...position,visible:walk.currentNode.nodeValue});}}
    handle.release();host.release();viewer.disposeMemoryResources();return {pages:packet.pages.length,coreMs:performance.now()-start,positions,sidecarEntries:compiled.sourceMap.length};
  },{compiled,origin});
  if(!result.positions.length)throw Error('No paper source positions');
  for(const p of result.positions){
    const source=resolveGeneratedPosition(compiled,p.key,p.offset),mapping=compiled.mappings.find(m=>m.key===p.key);
    if(!source||source.revision!==1||mapping.text.slice(p.offset,p.offset+p.visible.length)!==p.visible)throw Error('Paper/compiler source position mismatch');
  }
  cases.push({name,pages:result.pages,coreMs:result.coreMs,sidecarEntries:result.sidecarEntries,paperPositions:result.positions.length});await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={scope:'VFM and Japanese transforms through Core completed-paper export; visible text positions resolve to manuscript mappings',node:process.version,chrome:chromeVersion,
 coreSha256:sha256(await fs.readFile(path.join(root,'vivliostyle/packages/core/lib/vivliostyle.iife.js'))),
 compilerSha256:sha256(await fs.readFile(path.join(root,'extension/dist/src/compiler/vfm-manuscript.js'))),cases};
await fs.writeFile(path.join(output,'vfm-core.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
