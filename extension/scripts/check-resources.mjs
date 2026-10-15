import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {SnapshotBuilder} from '../dist/src/services/snapshot-builder.js';
import {NodeSnapshotHost} from '../dist/src/services/node-snapshot-host.js';
import {RenderInputBuilder} from '../dist/src/services/render-input-builder.js';
import {collectResources} from '../dist/src/services/resource-collector.js';
import {createCoreMemoryInput} from '../dist/src/services/core-memory-input.js';
import {CompilerService} from '../dist/src/compiler/compiler-service.js';
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'.recovery/compiler-host');
const sha=async file=>createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
const implementationSha=async()=>({core:await sha('vivliostyle/packages/core/lib/vivliostyle.iife.js'),compiler:await sha('extension/dist/src/compiler/vfm-manuscript.js'),collector:await sha('extension/dist/src/services/resource-collector.js'),adapter:await sha('extension/dist/src/services/core-memory-input.js')});
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ogenkou-resource-check-'));
const work=pathToFileURL(dir+'/').href,uri=name=>new URL(name,work).href;
const compiler=new CompilerService();
let browser,server;
try {
 await fs.mkdir(path.join(dir,'styles'));await fs.mkdir(path.join(dir,'assets'));
 await fs.writeFile(path.join(dir,'ogenkou.jsonc'),' {"settingsVersion":1,"style":"styles/main.css"}');
 await fs.writeFile(path.join(dir,'styles/main.css'),'@import "nested.css" layer(assets); #asset {color:rgb(0, 0, 255)}');
 await fs.writeFile(path.join(dir,'styles/nested.css'),'@import "main.css"; @font-face{font-family:ResourceFixture;src:url("../assets/font(1).woff2?v=1")} #asset{font-family:ResourceFixture}');
 await fs.copyFile(path.join(root,'vivliostyle/packages/core/test/files/fonts/ArchivoBlack/archivo-black-subset.woff2'),path.join(dir,'assets/font(1).woff2'));
 await fs.writeFile(path.join(dir,'assets/picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><image href="inner.svg" width="30" height="40"/></svg>');
 await fs.writeFile(path.join(dir,'assets/inner.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="red"/></svg>');
 const host=new NodeSnapshotHost(),snapshots=new SnapshotBuilder(host);snapshots.activate(uri('01.novel'));
 const builder=new RenderInputBuilder(snapshots,compiler),bench=[];
 const read=async(url,text)=>{const bytes=(await host.read(url,new AbortController().signal)).bytes;return text?new TextDecoder().decode(bytes):bytes};
 if(!process.argv.includes('--core-only'))for(const workload of ['plain','dense'])for(const size of [40000,80000,160000]) {
  const line=workload==='plain'?'これは日本語の小説本文です。主人公は窓を開けた。\n':'これは日本語小説です。漢字《かんじ》と｜親文字《よみ》、12、か\u3099。\n',text=line.repeat(Math.ceil(size/line.length)).slice(0,size);
  await fs.writeFile(path.join(dir,'01.novel'),text);
  const baseline=[],full=[],collection=[],gaps=[];
  await builder.build();
  for(let i=0;i<3;i++) {
   let start=performance.now();const snapshot=await snapshots.build();const compiled=await compiler.compile(snapshot);baseline.push(performance.now()-start);
   start=performance.now();await collectResources(snapshot,compiled,read,new AbortController().signal);collection.push(performance.now()-start);
   let last=performance.now();const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},10);
   try { start=performance.now();const input=await builder.build();full.push(performance.now()-start);if(!input.snapshot.resourceManifestComplete)throw Error('Incomplete benchmark resources');await new Promise(r=>setTimeout(r,20)); }
   finally {clearInterval(timer);}
  }
  const median=values=>[...values].sort((a,b)=>a-b)[1];
  bench.push({workload,utf16Units:size,samples:3,baselineSnapshotAndWorkerMedianMs:median(baseline),collectedInputMedianMs:median(full),collectorOnlyMedianMs:median(collection),collectorOnlyMaxMs:Math.max(...collection),mainThreadHeartbeatMaxGapMs:Math.max(...gaps)});
  console.log('resource benchmark completed',workload,size);
 }
 let benchmarkSha256;
 if(bench.length){benchmarkSha256=await implementationSha();await fs.writeFile(path.join(output,'resource-timing-latest.json'),JSON.stringify({node:process.version,benchmarkSha256,bench},null,2)+'\n');}
 else {const timing=JSON.parse(await fs.readFile(path.join(output,'resource-timing-latest.json'),'utf8'));bench.push(...timing.bench);benchmarkSha256=timing.benchmarkSha256;}
 await fs.writeFile(path.join(dir,'01.novel'),'<p id="asset">Sample abc</p>\n\n本文です。\n\n![画像](assets/picture.svg?v=1)');
 const input=await builder.build(),memory=createCoreMemoryInput(input);
 // Freeze proof: change disk after capture. The browser must render captured CSS/image/font bytes.
 await fs.writeFile(path.join(dir,'styles/main.css'),'#asset {color:rgb(255,0,0)}');
 await fs.writeFile(path.join(dir,'assets/picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>');
 await fs.writeFile(path.join(dir,'assets/inner.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="blue"/></svg>');
 const require=createRequire(path.join(root,'experiments/preview-benchmark/package.json'));
 const {chromium}=require('playwright');
 server=http.createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname;
  if(name==='/'){response.end('<div id="viewport" style="width:1000px;height:850px"></div><script src="/core.js"></script>');return;}
  const filename=name==='/core.js'?path.join(root,'vivliostyle/packages/core/lib/vivliostyle.iife.js'):path.resolve(root,'vivliostyle/packages/core/resources',name.slice('/resources/'.length));
  if((name==='/core.js'||name.startsWith('/resources/'))&&filename.startsWith(path.join(root,'vivliostyle/packages/core'))&&fsSync.existsSync(filename)&&fsSync.statSync(filename).isFile()){
   response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.xml')?'application/xml':'application/octet-stream');response.end(fsSync.readFileSync(filename));
  }else{response.writeHead(404);response.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),fileRequests=[];
 page.on('request',request=>{if(request.url().startsWith('file:'))fileRequests.push(request.url())});
 await page.goto(origin);await page.waitForFunction(()=>!!window.VivliostyleCore);
 const resources=memory.source.resources.map(resource=>({...resource,content:typeof resource.content==='string'?resource.content:Buffer.from(resource.content).toString('base64'),binary:typeof resource.content!=='string'}));
 const core=await page.evaluate(async({source,options,resources,origin})=>{
  source.resources=resources.map(resource=>({...resource,content:resource.binary?Uint8Array.from(atob(resource.content),c=>c.charCodeAt(0)).buffer:resource.content}));
  const parsed=new DOMParser().parseFromString(source.html,'text/html');
  for(const entry of source.sourceMap){let node=parsed.documentElement;for(const i of entry.path)node=node.childNodes[i];if(node.nodeValue!==entry.text)throw Error('Sidecar shifted');}
  const viewer=new VivliostyleCore.CoreViewer({viewportElement:document.getElementById('viewport'),userAgentRootURL:origin+'/resources/'},
   {autoResize:false,allowScripts:false,renderAllPages:true,paginationMode:'complete',pageViewMode:'singlePage'});
  const start=performance.now();await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Core timeout')),60000);viewer.addListener('loaded',()=>{clearTimeout(timer);resolve()});viewer.addListener('error',event=>{clearTimeout(timer);reject(Error(JSON.stringify(event)))});viewer.loadMemoryDocument(source,options);
  });
  const handle=await viewer.retainPreviewDisplayUnitAsync();if(!handle)throw Error('No paper');
  const container=[...viewer.getCommittedPreviewSnapshotSeed().snapshots.values()].flatMap(s=>s.pages)[0].container,
   asset=container.querySelector('[id="asset"], [data-viv-id="asset"]')??container.querySelector('p');
  const image=container.querySelector('img');if(!image)throw Error('No image');
  const style=getComputedStyle(asset),result={pages:viewer.exportCompletedPaper('resources').pages.length,coreMs:performance.now()-start,
   color:style.color,fontFamily:style.fontFamily,fontLoaded:[...document.fonts].some(font=>style.fontFamily.includes(font.family)&&font.status==='loaded'),imageWidth:image.naturalWidth,imageHeight:image.naturalHeight,imageUrl:image.src,sidecarEntries:source.sourceMap.length};
  const canvas=document.createElement('canvas');canvas.width=30;canvas.height=40;const context=canvas.getContext('2d');context.drawImage(image,0,0);result.imagePixel=[...context.getImageData(10,10,1,1).data];
  handle.release();viewer.disposeMemoryResources();return result;
 },{source:{...memory.source,resources:[]},options:memory.options,resources,origin});
 if(core.color!=='rgb(0, 0, 255)'||!core.fontLoaded||!core.fontFamily.includes('ResourceFixture')||core.imageWidth!==30||core.imageHeight!==40||JSON.stringify(core.imagePixel)!=='[255,0,0,255]'||!core.imageUrl.startsWith('blob:')||fileRequests.length)throw Error('Captured resource mismatch: '+JSON.stringify({core,fileRequests}));
 const report={scope:'Local resource collection + warm snapshot/VFM Worker input; Core captured-resource smoke, not CW/S/UI timing',node:process.version,chrome:browser.version(),
  sha256:await implementationSha(),benchmarkSha256,
  bench,core:{...core,imageUrl:'blob:(redacted)'},capturedResources:input.snapshot.resources.length,memoryAliases:resources.length,fileRequests};
 await fs.writeFile(path.join(output,'resources.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {await compiler.close();if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
