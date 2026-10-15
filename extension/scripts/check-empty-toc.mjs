import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compileVfmManuscript} from '../dist/src/compiler/vfm-manuscript.js';
import {BUILTIN_PUBLICATION} from '../dist/src/config/publication-editor.js';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(root,'experiments/preview-benchmark/package.json'));
const {chromium}=require('playwright'),output=path.join(root,'.recovery/empty-toc',String(Date.now()));await fs.mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.end('<!doctype html><div id="viewport" style="width:1000px;height:850px"></div><script src="/core.js"></script>');return;}const base=path.join(root,'vivliostyle/packages/core'),file=name==='/core.js'?path.join(base,'lib/vivliostyle.iife.js'):path.resolve(base,'resources',name.slice('/resources/'.length));if(!file.startsWith(base)||!(name==='/core.js'||name.startsWith('/resources/')))throw Error('path');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});const cases=[];
try{for(const mode of ['empty','vertical-toc','horizontal-toc']){
 const settings=structuredClone(BUILTIN_PUBLICATION);settings.processing.toc=mode!=='empty';settings.processing.titlePage=false;settings.processing.tocWritingMode=mode==='horizontal-toc'?'horizontal':'inherit';
 const text=mode==='empty'?'':'# 一\n\n本文。\n\n# 二\n\n本文。\n\n# 三\n\n本文。\n\n# 四\n\n本文。';
 const snapshot={work:'file:///test/',epoch:1,revision:1,fingerprint:'test',content:text,boundaries:[],configText:'{}',config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:true,resourceManifest:{stylesheetUris:[],dependencies:[]},sources:[{uri:'file:///test/01.nv',text,virtualStart:0,virtualEnd:text.length,dirty:true}]};
 const compiled={...compileVfmManuscript(snapshot)};if(mode!=='empty')compiled.css+='\n@page one {counter-reset:page 0} @page twelve {counter-reset:page 11} @page hundred {counter-reset:page 122} @page thousand {counter-reset:page 1233} h1[data-running-head="一"]{page:one} h1[data-running-head="二"]{page:twelve} h1[data-running-head="三"]{page:hundred} h1[data-running-head="四"]{page:thousand}';
 const page=await browser.newPage({viewport:{width:1000,height:850}});await page.goto(origin);
 const result=await page.evaluate(async({compiled,origin,mode})=>{
  const viewer=new VivliostyleCore.CoreViewer({window,viewportElement:document.getElementById('viewport')},{autoResize:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage',userAgentRootURL:origin+'/resources/'});
  const load=async(doc)=>{await new Promise((resolve,reject)=>{viewer.addListener('loaded',function done(e){if(e.revision!==doc.revision)return;viewer.removeListener('loaded',done);resolve()});viewer.addListener('error',()=>reject(Error('layout failed')));viewer.loadMemoryDocument(doc,{authorStyleSheet:[{text:compiled.css}],reusePages:true});});};
  await load({url:origin+'/document.html',revision:1,html:compiled.html,sourceMap:compiled.sourceMap,resources:[]});
  const packet=viewer.exportCompletedPaper('test');const numbers=[...document.querySelectorAll('.ogenkou-toc-page')].map(n=>({text:n.textContent,html:n.innerHTML,width:(n.querySelector('[data-adapt-pseudo]')??n).getBoundingClientRect().width,height:(n.querySelector('[data-adapt-pseudo]')??n).getBoundingClientRect().height}));
  if(mode==='empty'){await load({url:origin+'/document.html',revision:2,html:compiled.html.replace('<br>','本文。<br>'),sourceMap:[],resources:[]});await load({url:origin+'/document.html',revision:3,html:compiled.html,sourceMap:[],resources:[]});if(viewer.exportCompletedPaper('test').pages.length!==1)throw Error('cleared manuscript did not return to one page');}
  let focusedReuse=null;
  if(mode!=='empty'){
   const payload=viewer.exportCommittedSeed('test'),viewport=document.createElement('div');viewport.style.cssText='position:absolute;left:-3000px;top:-3000px;width:1000px;height:850px';document.body.append(viewport);
   const focused=new VivliostyleCore.CoreViewer({window,viewportElement:viewport},{autoResize:false,renderAllPages:false,paginationMode:'target-display-unit',pageViewMode:'singlePage',userAgentRootURL:origin+'/resources/'});
   const imported=await focused.importCommittedSeed(payload,{compatibilityKey:'test',skipInitialPage:true,documentOptions:{authorStyleSheet:[{text:compiled.css}]},timeoutMs:30000});
   const laneViewport=document.createElement('div');laneViewport.style.cssText=viewport.style.cssText;document.body.append(laneViewport);
   const lane=new VivliostyleCore.CoreViewer({window,viewportElement:laneViewport},{autoResize:false,renderAllPages:false,paginationMode:'target-display-unit',pageViewMode:'singlePage',userAgentRootURL:origin+'/resources/'});
   const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('focused timed out')),30000);lane.addListener('focusedterminal',e=>{clearTimeout(timer);resolve(e)});lane.addListener('error',()=>{clearTimeout(timer);reject(Error('focused failed'))})});
   lane.loadMemoryDocument({url:origin+'/document.html',revision:2,html:compiled.html,sourceMap:compiled.sourceMap,resources:[]},{previewSnapshotSeed:lane.preparePreviewSnapshotSeed(imported.seed),reusePages:true,authorStyleSheet:[{text:compiled.css}]});
   focusedReuse=(await done).reusedPages;viewport.remove();laneViewport.remove();
  }
  return {focusedReuse,rowSizes:[...document.querySelectorAll('.ogenkou-toc-entry')].map(n=>n.getBoundingClientRect().height),pages:packet.pages.length,firstPageSide:packet.pages[0].side,texts:packet.pages.map(p=>new DOMParser().parseFromString(p.html,'text/html').body.textContent),numbers};
 },{compiled,origin,mode});
 if(mode==='empty')assert.equal(result.pages,1);else {assert.equal(result.firstPageSide,'left');assert(result.focusedReuse>0,'TOC seed should retain reusable pages');assert.equal(result.numbers.length,4);assert.deepEqual(result.numbers.map(n=>n.text),['1','12','123','1234']);if(mode==='vertical-toc')assert(result.numbers.every(n=>Math.abs(n.height-result.numbers[0].height)<.1));else {assert(result.numbers[2].width>result.numbers[0].width*2.5);assert(result.rowSizes.every(h=>h<36));}}
 await page.screenshot({path:path.join(output,mode+'.png')});cases.push({mode,...result});await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await fs.writeFile(path.join(output,'result.json'),JSON.stringify(cases,null,2));console.log(JSON.stringify({output,cases},null,2));
