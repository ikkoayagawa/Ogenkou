import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fixture} from './upstream-comparison-browser.mjs';
const root=path.resolve(import.meta.dirname,'../..'),repo=path.join(root,'vivliostyle');
const require=createRequire(path.join(import.meta.dirname,'package.json')),{chromium}=require('playwright');
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split('=')));
const sizes=(args.sizes??'5000,10000,20000,40000,80000,160000,320000,640000').split(',').map(Number),reps=Number(args.reps??10),warmup=Number(args.warmup??1),timeoutMs=Number(args.timeout??600000);
if(sizes.some(v=>!Number.isSafeInteger(v)||v<1000||v>1000000)||!Number.isSafeInteger(reps)||reps<1||!Number.isSafeInteger(warmup)||warmup<0||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid options');
const reference=JSON.parse(await fs.readFile(args.reference??path.join(root,'.recovery/upstream-comparison/build/13d0a9c4918cb91b97ff0253d2da5f0d2dc9de98/build.json'),'utf8'));
const output=path.resolve(args.output??path.join(root,'.recovery/scaling-comparison',String(Date.now())));await fs.mkdir(output,{recursive:true});
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const bundles={upstream:await fs.readFile(reference.bundle),current:await fs.readFile(path.join(repo,'packages/core/lib/vivliostyle.iife.js'))};
if(hash(bundles.upstream)!==reference.sha256)throw Error('Upstream bundle changed');
const browserSource=await fs.readFile(path.join(import.meta.dirname,'upstream-comparison-browser.mjs'));
// Verify provenance before replacing any archived inputs on a resumed run.
try{const previous=JSON.parse(await fs.readFile(path.join(output,'environment.json'),'utf8'));if(previous.current.sha256!==hash(bundles.current)||previous.upstream.sha256!==hash(bundles.upstream)||previous.plan.browserHarnessHash!==hash(browserSource)||previous.plan.reps!==reps||previous.plan.warmup!==warmup)throw Error('Resume inputs differ from saved run');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const [name,bytes] of Object.entries(bundles))await fs.writeFile(path.join(output,name+'.js'),bytes);
await fs.writeFile(path.join(output,'browser.mjs'),browserSource);
let rows=[],warmups=[],oracles=[];
try{({rows,warmups,oracles}=JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
const metadata={createdAt:new Date().toISOString(),node:process.version,browser:null,os:os.type()+' '+os.release(),cpu:os.cpus()[0]?.model,ramBytes:os.totalmem(),upstream:reference,current:{revision:execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTree:execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}).trim(),sha256:hash(bundles.current)},plan:{sizes,reps,warmup,timeoutMs,positions:{early:.25,middle:.5,late:.75},css:fixture(sizes[0]).css,browserHarnessHash:hash(browserSource),metric:'local seed clone + edited HTML parse to target focusedterminal; full baseline setup excluded',oracle:'one independent upstream initial full layout of edited input per size/position; used only to verify every focused sample; not a measured comparison series'}};
const save=()=>fs.writeFile(path.join(output,'results.json'),JSON.stringify({rows,warmups,oracles},null,2)+'\n');
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),build=url.searchParams.get('build')??'current';
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><script src="/core.js?build='+build+'"></script></head><body><div id="root"></div></body></html>');return;}
 if(url.pathname==='/core.js'){res.setHeader('Content-Type','text/javascript');res.end(bundles[build]);return;}
 if(url.pathname==='/browser.mjs'){res.setHeader('Content-Type','text/javascript');res.end(browserSource);return;}
 if(!url.pathname.startsWith('/resources/'))throw Error('Not found');
 const base=build==='upstream'?reference.resources:path.join(repo,'packages/core/resources'),file=path.resolve(base,url.pathname.slice(11));
 if(!file.startsWith(base+path.sep))throw Error('Invalid path');
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
const run=async(build,mode,input)=>{
 const page=await browser.newPage({viewport:{width:1200,height:1000}});
 try{await page.goto(origin+'/?build='+build);await page.waitForFunction(()=>!!globalThis.VivliostyleCore?.CoreViewer);
 return await page.evaluate(async options=>{const {runTrial}=await import('/browser.mjs');return runTrial(options)},{build,mode,fixture:input,timeoutMs});
 }finally{await page.close();}
};
try{
 browser=await chromium.launch({executablePath:args.browser??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});metadata.browser=browser.version();try{const previous=JSON.parse(await fs.readFile(path.join(output,'environment.json'),'utf8'));if(previous.current.sha256!==metadata.current.sha256||previous.plan.browserHarnessHash!==metadata.plan.browserHarnessHash||previous.browser!==metadata.browser||previous.plan.reps!==reps||previous.plan.warmup!==warmup)throw Error('Resume inputs differ from saved run');}catch(e){if(e.code!=='ENOENT')throw e;}await fs.writeFile(path.join(output,'environment.json'),JSON.stringify(metadata,null,2));
 for(const size of sizes)for(const position of ['early','middle','late']){
  const input=fixture(size,position),oraclePath=path.join(output,`oracle-${size}-${position}.json`);await fs.writeFile(path.join(output,`fixture-${size}-${position}.json`),JSON.stringify(input));
  let papers;
  try{papers=JSON.parse(await fs.readFile(oraclePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const oracle=await run('upstream','initial',{...input,html:input.editedHtml});papers=oracle.papers;await fs.writeFile(oraclePath,JSON.stringify(papers));oracles.push({size,position,pageCount:papers.length,paperHash:hash(papers),durationMs:oracle.durationMs});await save();console.log(JSON.stringify({type:'oracle',size,position,pages:papers.length,ms:Math.round(oracle.durationMs)}));}
  for(let trial=-warmup;trial<reps;trial++){
   const store=trial<0?warmups:rows;if(store.some(r=>r.size===size&&r.position===position&&r.trial===trial))continue;
   const sample=await run('current','focused',input),expected=[papers[sample.targetIndex]],matches=JSON.stringify(expected)===JSON.stringify(sample.papers);
   const record={size,position,trial,build:'current',mode:'focused',...sample,totalPageCount:papers.length,displayUnitPages:sample.papers.length,paperHash:hash(sample.papers),matches};delete record.papers;
   if(!matches){await fs.writeFile(path.join(output,`mismatch-${size}-${position}-${trial}.json`),JSON.stringify({expected,actual:sample.papers}));throw Error(`Mismatch ${size}/${position}/${trial}`);}
   store.push(record);await save();console.log(JSON.stringify({size,position,trial,warmup:trial<0,ms:Math.round(sample.durationMs),baselineMs:Math.round(sample.baselineMs),pageCount:papers.length,targetPage:sample.targetIndex,reused:sample.terminal.reusedPages,matches}));
  }
 }
 console.log(JSON.stringify({output,timedTrials:rows.length,warmups:warmups.length,parity:true}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
