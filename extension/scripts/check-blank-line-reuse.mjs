import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {parse} from 'parse5';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
// npm run build --prefix extension, then node extension/scripts/check-blank-line-reuse.mjs [optional-manuscript-path]
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'.recovery/blank-line-audit',String(Date.now()));
await fs.mkdir(output,{recursive:true});
const require=createRequire(path.join(root,'experiments/preview-benchmark/package.json')),{chromium}=require('playwright');
const imp=name=>import(pathToFileURL(path.join(root,'extension/dist/src',name+'.js')));
const {NodeSnapshotHost}=await imp('services/node-snapshot-host'),{SnapshotBuilder}=await imp('services/snapshot-builder'),{RenderInputBuilder}=await imp('services/render-input-builder'),{compileVfmManuscript}=await imp('compiler/vfm-manuscript');
const {previewInput}=await imp('preview/input'),{BUILTIN_PUBLICATION}=await imp('config/publication-editor');
const {manuscript}=await import(pathToFileURL(path.join(root,'extension/scripts/edit-to-paper-workload.mjs')));
const {fixture}=await import(pathToFileURL(path.join(root,'experiments/preview-benchmark/upstream-comparison-browser.mjs')));
const inputs=[];
for(const heading of [false,true])for(const profile of ['plain','dense']){
 const original=manuscript(5000,profile,'middle'),prefix=heading?'# 第一章\n\n':'';
 const data={...original,text:prefix+original.text,offset:prefix.length+original.offset};const versions=[];
 for(let edit=0;edit<3;edit++){
  const text=data.text.slice(0,data.offset)+'\n'.repeat(edit)+data.text.slice(data.offset),settings={...BUILTIN_PUBLICATION,processing:{...BUILTIN_PUBLICATION.processing,titlePage:false,toc:false}};
  const snapshot={work:'file:///benchmark/',epoch:1,revision:edit+1,fingerprint:String(edit),content:text,boundaries:[],sources:[{uri:'file:///benchmark/01.nv',text,virtualStart:0,virtualEnd:text.length,dirty:true}],configText:'{}',config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:true,resourceManifest:{complete:true,stylesheetUris:[],dependencies:[],issues:[]}};
  const document=compileVfmManuscript(snapshot);
  // A layout change alone can pass even when blanks were moved to the document end.
  // Verify that the exact edited paragraph is preceded by the expected source blanks.
  const paragraphs=[],plain=n=>n.nodeName==='#text'?n.value:(n.childNodes??[]).map(plain).join('');
  const walk=n=>{if(n.tagName==='p')paragraphs.push({text:plain(n),blank:n.attrs?.some(a=>a.name==='class'&&a.value.split(/\s/u).includes('source-blank-line'))});for(const child of n.childNodes??[])walk(child);};walk(parse(document.html));
  const target=paragraphs.findIndex(p=>p.text.includes(data.marker));assert(target>=0,'benchmark target paragraph missing');
  let before=0;for(let index=target-1;index>=0&&paragraphs[index].blank;index--)before++;
  assert.equal(before,edit+1,'blank lines must remain immediately before the benchmark target');
  versions.push(previewInput({snapshot,document},{uri:'file:///benchmark/01.nv',offset:data.offset+edit}));
 }inputs.push({name:'editor-benchmark-'+(heading?'heading-':'')+profile,versions});
}
const f=fixture(5000);inputs.push({name:'core-benchmark',versions:[f.html,f.editedHtml].map((html,i)=>({url:'file:///core-fixture.html',html:html.replace('</head>','<style>'+f.css+'</style></head>'),revision:i+1,resources:[]}))});
if(process.argv[2]){
 const uri=pathToFileURL(process.argv[2]).href,text=await fs.readFile(process.argv[2],'utf8');let buffers=[];
 const snapshots=new SnapshotBuilder(new NodeSnapshotHost(()=>buffers));snapshots.activate(uri);
 const builder=new RenderInputBuilder(snapshots,{compile:async s=>compileVfmManuscript(s)}),versions=[];
 const match=/\r?\n[\t \u3000]*\r?\n/u.exec(text);assert(match,'actual source needs a paragraph break');const offset=match.index+match[0].length;
 for(let edit=0;edit<3;edit++){
  buffers=[{uri,text:text.slice(0,offset)+'\n'.repeat(edit)+text.slice(offset),version:edit+1,dirty:true}];
  const input=await builder.build();versions.push(previewInput(input,{uri,offset:offset+edit}));
 }
 inputs.push({name:'saved-work-with-memory-only-edits',versions});snapshots.close();
}
const bundle=await fs.readFile(path.join(root,'extension/dist/runtime/core.js'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/core.js'?'text/javascript':'text/html');res.end(req.url==='/core.js'?bundle:'<script src="/core.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:850},deviceScaleFactor:2});await page.goto('http://127.0.0.1:'+server.address().port);
 const results=await page.evaluate(async inputs=>{
  const make=()=>{const element=document.createElement('div');document.body.append(element);return new VivliostyleCore.CoreViewer({viewportElement:element},{autoResize:false,allowScripts:false,renderAllPages:true,pageViewMode:'singlePage',paginationMode:'complete'});};
  async function load(viewer,input,seed){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('load timeout')),60000);const done=()=>{clearTimeout(timer);viewer.removeListener('loaded',done);resolve();};viewer.addListener('loaded',done);viewer.addListener('error',reject);viewer.loadMemoryDocument(input,{reusePages:!!seed,previewSnapshotSeed:seed},{renderAllPages:!seed,paginationMode:'complete'});});await viewer.waitForPreviewResources({complete:true});}
  function signature(viewer){return viewer.adaptViewer_.opfView.spineItems[0].pages.map(page=>{page.container.style.display='block';const base=page.container.getBoundingClientRect(),r=n=>Math.round(n*1000)/1000,rows=[],walker=document.createTreeWalker(page.container,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;for(let i=0;i<node.length;i++){if(node.data[i]==='\u00a0')continue;const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);rows.push([node.data[i],...Array.from(range.getClientRects(),b=>[r(b.x-base.x),r(b.y-base.y),r(b.width),r(b.height)])]);}}return{rows,blanks:[...page.container.querySelectorAll('.source-blank-line,[id$="inserted-blank"]')].map(el=>{const rect=el.getBoundingClientRect();return{width:r(rect.width),height:r(rect.height),display:getComputedStyle(el).display};})};});}
  const results=[];
  for(const {name,versions}of inputs){
   const producer=make();await load(producer,versions[0]);const original=signature(producer),seed=producer.getCommittedPreviewSnapshotSeed(),rows=[];
   for(let i=1;i<versions.length;i++){
    const viewer=make(),fresh=make();await load(viewer,versions[i],viewer.preparePreviewSnapshotSeed(seed));await load(fresh,versions[i]);
    const actual=signature(viewer),expected=signature(fresh),correct=JSON.stringify(actual)===JSON.stringify(expected),changed=JSON.stringify(actual.map(p=>p.rows))!==JSON.stringify(original.map(p=>p.rows));
    if(!correct||!changed)throw Error(JSON.stringify({name,i,correct,changed}));
    rows.push({addedLines:i,pages:actual.length,correct,changed,reused:viewer.adaptViewer_.opfView.previewReusedPages,blanks:actual.flatMap(p=>p.blanks)});
   }
   results.push({name,originalPages:original.length,originalBlanks:original.flatMap(p=>p.blanks),rows});
  }return results;
 },inputs);
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(results,null,2));console.log('Blank-line layout change / fresh-layout agreement checks passed: '+results.reduce((n,r)=>n+r.rows.length,0)+' edits, '+output);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
