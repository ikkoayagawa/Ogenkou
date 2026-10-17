import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {NodeSnapshotHost} from '../dist/src/services/node-snapshot-host.js';
import {SnapshotBuilder} from '../dist/src/services/snapshot-builder.js';
import {RenderInputBuilder} from '../dist/src/services/render-input-builder.js';
import {compileVfmManuscript} from '../dist/src/compiler/vfm-manuscript.js';
import {previewInput} from '../dist/src/preview/input.js';
import {colophonTemplate,COLOPHON_CSS} from '../dist/src/compiler/colophon.js';
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'.recovery/colophon',String(Date.now()));
await fs.mkdir(output,{recursive:true});
const require=createRequire(path.join(root,'experiments/preview-benchmark/package.json')),{chromium}=require('playwright');
const bundle=await fs.readFile(path.join(root,'extension/dist/runtime/core.js'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/core.js'?'text/javascript':'text/html');res.end(req.url==='/core.js'?bundle:'<div id="viewport"></div><script src="/core.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try {
 for(const mode of ['vertical','horizontal']) {
  const folder=path.join(output,mode);await fs.mkdir(path.join(folder,'styles'),{recursive:true});
  const uri=pathToFileURL(folder+path.sep).href,source=name=>new URL(name,uri).href;
  const body=count=>Array.from({length:count},(_,i)=>`段落${i}。春の雨が窓をたたく。遠くの街を眺めながら、物語を書き続ける。いつかこの本を手に取る人のことを考えた。`).join('\n\n');
  const yaml=colophonTemplate('夜明けの窓辺','綾川いっこう',new Date('2026-10-17T00:00:00Z'));
  await fs.writeFile(path.join(folder,'ogenkou.jsonc'),JSON.stringify({settingsVersion:1,theme:['styles/colophon.css'],overrides:{writingMode:mode,processing:{titlePage:false,toc:false}}}));
  await fs.writeFile(path.join(folder,'styles/colophon.css'),COLOPHON_CSS);
  let buffers=[];const snapshots=new SnapshotBuilder(new NodeSnapshotHost(()=>buffers));snapshots.activate(source('01.nv'));
  const builder=new RenderInputBuilder(snapshots,{compile:async s=>compileVfmManuscript(s)}),inputs={};
  for(const edit of ['none','after','yaml','before','css']){
   await fs.writeFile(path.join(folder,'01.nv'),body(edit==='before'?35:20));
   await fs.writeFile(path.join(folder,'99_okuduke.yaml'),yaml);
   await fs.writeFile(path.join(folder,'100_after.nv'),body(40));
   await fs.writeFile(path.join(folder,'styles/colophon.css'),COLOPHON_CSS+(edit==='css'?'\n.colophon {font-size:10pt;}':''));
   buffers=edit==='yaml'?[{uri:source('99_okuduke.yaml'),text:yaml.replace('綾川いっこう','改訂した著者'),version:2,dirty:true}]:edit==='after'?[{uri:source('100_after.nv'),text:body(40).replace('段落28。','\n\n段落28。'),version:2,dirty:true}]:[];
   const input=await builder.build();const wire=previewInput(input,{uri:source('100_after.nv'),offset:0});assert(wire.portable);
   inputs[edit]={url:wire.url,html:wire.html,sourceMap:wire.sourceMap,revision:wire.revision,resources:[]};
  }
  snapshots.close();
  const page=await browser.newPage({viewport:{width:900,height:800},deviceScaleFactor:2});await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async({inputs,mode})=>{
   const check=(value,message)=>{if(!value)throw Error(message);};
   function make(){const element=document.createElement('div');element.style.cssText='width:900px;height:800px';document.body.append(element);return new VivliostyleCore.CoreViewer({viewportElement:element},{autoResize:false,allowScripts:false,renderAllPages:true,pageViewMode:'singlePage',paginationMode:'complete'});}
   async function load(viewer,input,seed){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('load timeout')),30000);const done=()=>{clearTimeout(timer);viewer.removeListener('loaded',done);resolve();};viewer.addListener('loaded',done);viewer.addListener('error',reject);viewer.loadMemoryDocument(input,{reusePages:!!seed,previewSnapshotSeed:seed},{renderAllPages:!seed,paginationMode:"complete"});});await viewer.waitForPreviewResources({complete:true});}
   function signature(viewer){return viewer.adaptViewer_.opfView.spineItems[0].pages.map(page=>{page.container.style.display='block';const base=page.container.getBoundingClientRect(),r=n=>Math.round(n*1000)/1000,rows=[],walker=document.createTreeWalker(page.container,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;for(let i=0;i<node.length;i++){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);rows.push([node.data[i],...Array.from(range.getClientRects(),b=>[r(b.x-base.x),r(b.y-base.y),r(b.width),r(b.height)])]);}}return {text:page.container.textContent,dimensions:page.dimensions,side:page.side,rows};});}
   const producer=make();await load(producer,inputs.none);const rows=[];
   const original=signature(producer);check(original.length>5,'multi-page fixture required');
   const special=producer.adaptViewer_.opfView.spineItems[0].pages.findIndex(page=>page.container.querySelector('.colophon'));
   check(special>0&&special<original.length-1,'colophon must be between body pages');
   const sample=producer.adaptViewer_.opfView.spineItems[0].pages[special];sample.container.setAttribute('data-colophon-proof',mode);
   const element=sample.container.querySelector('.colophon');check(getComputedStyle(element).writingMode==='horizontal-tb','colophon writing mode');
   const h1=element.querySelector('h1');check(getComputedStyle(h1).fontWeight==='400','regular heading');
   for(const portable of [false,true]){
    let seed=producer.getCommittedPreviewSnapshotSeed();
    if(portable){const donor=make();seed=(await donor.importCommittedSeed(JSON.parse(JSON.stringify(producer.exportCommittedSeed('colophon'))),{compatibilityKey:'colophon',skipInitialPage:true})).seed;}
    for(const edit of ['after','yaml','before','css']){
     const viewer=make(),fresh=make(),prepared=viewer.preparePreviewSnapshotSeed(seed);await load(viewer,inputs[edit],prepared);await load(fresh,inputs[edit]);
     const actual=signature(viewer),expected=signature(fresh);check(JSON.stringify(actual)===JSON.stringify(expected),`${mode}/${portable}/${edit}: layout mismatch`);
     const opf=viewer.adaptViewer_.opfView,reused=opf.previewReusedPages,index=viewer.adaptViewer_.opfView.spineItems[0].pages.findIndex(page=>page.container.querySelector('.colophon'));
     if(edit==='after')check(reused>0&&index<opf.previewReusedPrefixPages,'colophon was not reused after later body edit '+JSON.stringify({reused,prefix:opf.previewReusedPrefixPages,index,decisions:opf.previewCacheResults}));
     if(edit==='yaml')check(actual.some(page=>page.text.includes('改訂した著者')),'unsaved YAML edit lost');
     const packet=viewer.exportCompletedPaper('colophon'),target=document.createElement('div');document.body.append(target);const host=new VivliostyleCore.CompletedPaperHost(packet,target,'colophon');await host.awaitReady();const lease=host.retainPages(packet.pages.map((_,i)=>i));
     let mapped=0;const texts=new Map(inputs[edit].sourceMap.map(item=>[item.key,item.text]));
     for(const container of lease.containers)for(const section of container.querySelectorAll('.colophon')){const walk=document.createTreeWalker(section,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const node=walk.currentNode,point=lease.resolveTextPosition(node,0);if(!point)continue;check(point.revision===inputs[edit].revision,'stale YAML revision');check(texts.get(point.key)?.slice(point.offset,point.offset+node.length)===node.nodeValue,'invalid YAML source text');mapped++;}}
     check(mapped>=6,'YAML mapping missing');lease.release();host.release();target.remove();
     rows.push({portable,edit,pages:actual.length,reused,colophonPage:index+1,mapped});
    }
   }
   // Leave one complete colophon visible for the proof screenshot.
   for(const page of producer.adaptViewer_.opfView.spineItems[0].pages)page.container.style.display='none';
   producer.navigateToPage('epage',special);return {mode,rows};
  },{inputs,mode});
  await page.locator(`[data-colophon-proof="${mode}"]`).first().waitFor({state:'visible'});
  await page.locator(`[data-colophon-proof="${mode}"]`).first().screenshot({path:path.join(output,mode+'.png')});
  results.push(result);console.log(JSON.stringify(result));await page.close();
 }
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({browser:browser.version(),results},null,2));console.log('Colophon compiler/resources/reuse checks passed: '+output);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
