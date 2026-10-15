import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compileVfmManuscript} from '../dist/src/compiler/vfm-manuscript.js';
import {BUILTIN_PUBLICATION} from '../dist/src/config/publication-editor.js';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(root,'experiments/preview-benchmark/package.json'));
const {chromium}=require('playwright'),output=path.join(root,'.recovery/title-page',String(Date.now()));await fs.mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.end('<!doctype html><div id="viewport" style="width:1000px;height:850px"></div><script src="/core.js"></script>');return;}const base=path.join(root,'vivliostyle/packages/core'),file=name==='/core.js'?path.join(base,'lib/vivliostyle.iife.js'):path.resolve(base,'resources',name.slice('/resources/'.length));if(!file.startsWith(base)||!(name==='/core.js'||name.startsWith('/resources/')))throw Error('path');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});const cases=[];
try{for(const writingMode of ['vertical','horizontal'])for(const paper of ['A6','A5']){
 const settings=structuredClone(BUILTIN_PUBLICATION);settings.writingMode=writingMode;settings.layout.pageSize=paper;settings.layout.columnCount=paper==='A5'?2:1;settings.processing.toc=false;
 const text='---\ntitle: 夜の物語\nauthor: 筆者\n---\n\n本文――続く。';
 const snapshot={work:'file:///test/',epoch:1,revision:1,fingerprint:'title',content:text,boundaries:[],configText:'{}',config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:true,resourceManifest:{stylesheetUris:[],dependencies:[]},sources:[{uri:'file:///test/01.nv',text,virtualStart:0,virtualEnd:text.length,dirty:true}]};
 const compiled=compileVfmManuscript(snapshot),page=await browser.newPage({viewport:{width:1000,height:850}});await page.goto(origin);
 const result=await page.evaluate(async({compiled,origin})=>{
  const viewer=new VivliostyleCore.CoreViewer({window,viewportElement:document.getElementById('viewport')},{autoResize:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage',userAgentRootURL:origin+'/resources/'});
  const start=performance.now();await new Promise((resolve,reject)=>{viewer.addListener('loaded',resolve);viewer.addListener('error',()=>reject(Error('layout failed')));viewer.loadMemoryDocument({url:origin+'/document.html',revision:1,html:compiled.html,sourceMap:compiled.sourceMap,resources:[]},{authorStyleSheet:[{text:compiled.css}]});});
  const elapsed=performance.now()-start,packet=viewer.exportCompletedPaper('title');const title=document.querySelector('.ogenkou-title-content'),text=document.querySelector('.ogenkou-title-text'),rect=text.getBoundingClientRect(),paper=title.closest('[data-vivliostyle-page-container]')?.getBoundingClientRect();
  let focusedReuse=null;
  if(true){
   const payload=viewer.exportCommittedSeed('title'),viewport=document.createElement('div');viewport.style.cssText='position:absolute;left:-3000px;top:-3000px;width:1000px;height:850px';document.body.append(viewport);
   const focused=new VivliostyleCore.CoreViewer({window,viewportElement:viewport},{autoResize:false,renderAllPages:false,paginationMode:'target-display-unit',pageViewMode:'singlePage',userAgentRootURL:origin+'/resources/'});
   const imported=await focused.importCommittedSeed(payload,{compatibilityKey:'title',skipInitialPage:true,documentOptions:{authorStyleSheet:[{text:compiled.css}]},timeoutMs:30000});
   const laneViewport=document.createElement('div');laneViewport.style.cssText=viewport.style.cssText;document.body.append(laneViewport);
   const lane=new VivliostyleCore.CoreViewer({window,viewportElement:laneViewport},{autoResize:false,renderAllPages:false,paginationMode:'target-display-unit',pageViewMode:'singlePage',userAgentRootURL:origin+'/resources/'});
   const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('focused timed out')),30000);lane.addListener('focusedterminal',e=>{clearTimeout(timer);resolve(e)});lane.addListener('error',()=>{clearTimeout(timer);reject(Error('focused failed'))})});
   lane.loadMemoryDocument({url:origin+'/document.html',revision:2,html:compiled.html,sourceMap:compiled.sourceMap,resources:[]},{previewSnapshotSeed:lane.preparePreviewSnapshotSeed(imported.seed),reusePages:true,authorStyleSheet:[{text:compiled.css}]});
   focusedReuse=(await done).reusedPages;viewport.remove();laneViewport.remove();
  }
  return {focusedReuse,elapsed,pages:packet.pages.length,texts:packet.pages.map(p=>new DOMParser().parseFromString(p.html,'text/html').body.textContent),titleRect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},paperBounds:paper?{x:paper.x,y:paper.y,width:paper.width,height:paper.height}:null};
 },{compiled,origin});
 assert(result.focusedReuse!==null);assert.equal(result.pages,2);assert(result.texts[0].includes('夜の物語'));assert(!result.texts[0].includes('本文'));assert(result.texts[1].includes('本文'));await page.screenshot({path:path.join(output,writingMode+'-'+paper+'.png')});
 if(paper==='A6'){
  const {renderPdf,findBrowser}=await import('../dist/src/services/pdf-export.js');const pdf=await renderPdf({snapshot,document:compiled},path.join(root,'extension/dist/runtime'),await findBrowser(),new AbortController().signal);assert.equal(pdf.pages,2);await fs.writeFile(path.join(output,writingMode+'.pdf'),pdf.bytes);
 }
 cases.push({writingMode,paper,...result});await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await fs.writeFile(path.join(output,'result.json'),JSON.stringify(cases,null,2));console.log(JSON.stringify({output,cases},null,2));
