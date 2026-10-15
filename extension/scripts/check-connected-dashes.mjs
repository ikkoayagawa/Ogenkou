import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compileVfmManuscript} from '../dist/src/compiler/vfm-manuscript.js';
import {BUILTIN_PUBLICATION} from '../dist/src/config/publication-editor.js';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(root,'experiments/preview-benchmark/package.json'));
const {chromium}=require('playwright'),output=path.join(root,'.recovery/connected-dashes',String(Date.now()));await fs.mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.end('<!doctype html><div id="viewport" style="width:1000px;height:850px"></div><script src="/core.js"></script>');return;}const base=path.join(root,'vivliostyle/packages/core'),file=name==='/core.js'?path.join(base,'lib/vivliostyle.iife.js'):path.resolve(base,'resources',name.slice('/resources/'.length));if(!file.startsWith(base)||!(name==='/core.js'||name.startsWith('/resources/')))throw Error('path');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});const cases=[];
try{for(const writingMode of ['vertical','horizontal'])for(const enabled of [true,false]){
 const settings=structuredClone(BUILTIN_PUBLICATION);settings.writingMode=writingMode;settings.processing.connectedDashes=enabled;settings.processing.toc=false;
 const text='前――途中——最後――――。',compiled=compileVfmManuscript({work:'file:///work/',epoch:1,revision:1,fingerprint:'dash',content:text,boundaries:[],sources:[{uri:'file:///work/01.novel',text,virtualStart:0,virtualEnd:text.length,dirty:true}],configText:'{}',config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:false});
 const page=await browser.newPage({viewport:{width:1100,height:900}});await page.goto(origin);await page.waitForFunction(()=>!!window.VivliostyleCore);
 const result=await page.evaluate(async({compiled,origin})=>{
  const viewer=new VivliostyleCore.CoreViewer({viewportElement:document.getElementById('viewport'),userAgentRootURL:origin+'/resources/'},{autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),60000);viewer.addListener('loaded',()=>{clearTimeout(timer);resolve();});viewer.addListener('error',e=>{clearTimeout(timer);reject(Error(JSON.stringify(e)))});viewer.loadMemoryDocument({url:origin+'/document.html',revision:1,html:compiled.html,sourceMap:compiled.sourceMap,resources:[]},{authorStyleSheet:[{text:compiled.css}]});});
  await viewer.waitForPreviewResources({complete:true});const unit=viewer.getCurrentPreviewDisplayUnit(),lease=await viewer.retainPreviewDisplayUnitAsync();
  const spans=[...unit.containers[0].querySelectorAll('.connected-dashes')].map(n=>{const style=getComputedStyle(n),after=style,r=n.getBoundingClientRect();return {text:n.textContent,width:r.width,height:r.height,fill:style.webkitTextFillColor,after:{image:after.backgroundImage,size:after.backgroundSize},mapped:[...lease.containers[0].querySelectorAll('.connected-dashes')].some(c=>{const walk=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);while(walk.nextNode())if(lease.resolveTextPosition(walk.currentNode,0))return true;return false;})};});
  return {spans,text:unit.containers[0].textContent,pages:viewer.exportCompletedPaper('dash').pages.length};
 },{compiled,origin});
 assert.equal(result.spans.length,enabled?3:0);if(enabled)for(const span of result.spans){assert(span.mapped);assert.equal(span.fill,'rgba(0, 0, 0, 0)');const size=span.after.size.split(' ');assert.equal(size[writingMode==='vertical'?1:0],'100%');assert(parseFloat(size[writingMode==='vertical'?0:1])>0);assert(span.after.image.startsWith('linear-gradient'));}
 await page.screenshot({path:path.join(output,writingMode+'-'+enabled+'.png')});cases.push({writingMode,enabled,...result});await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await fs.writeFile(path.join(output,'result.json'),JSON.stringify(cases,null,2));console.log(JSON.stringify({output,cases},null,2));
