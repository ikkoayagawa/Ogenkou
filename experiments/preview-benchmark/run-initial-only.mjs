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
const sizes=(args.sizes??'5000,10000,20000,40000,80000').split(',').map(Number),reps=Number(args.reps??10),warmup=Number(args.warmup??1),timeoutMs=Number(args.timeout??120000);
if(sizes.some(v=>!Number.isSafeInteger(v)||v<1000||v>1000000)||!Number.isSafeInteger(reps)||reps<1||!Number.isSafeInteger(warmup)||warmup<0||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid options');
const upstreamRevision=execFileSync('git',['-C',repo,'rev-parse','13d0a9c4'],{encoding:'utf8'}).trim();
const reference=JSON.parse(await fs.readFile(args.reference??path.join(root,'.recovery/upstream-comparison/build/13d0a9c4918cb91b97ff0253d2da5f0d2dc9de98/build.json'),'utf8'));
const output=path.resolve(args.output??path.join(root,'.recovery/upstream-comparison',String(Date.now())));await fs.mkdir(output,{recursive:true});
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const bundles={upstream:await fs.readFile(reference.bundle),current:await fs.readFile(path.join(repo,'packages/core/lib/vivliostyle.iife.js'))};
if(hash(bundles.upstream)!==reference.sha256)throw Error('Upstream bundle changed');
for(const [name,bytes] of Object.entries(bundles))await fs.writeFile(path.join(output,name+'.js'),bytes);
const browserSource=await fs.readFile(path.join(root,'experiments/preview-benchmark/upstream-comparison-browser.mjs'));await fs.writeFile(path.join(output,'browser.mjs'),browserSource);
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),build=url.searchParams.get('build')??'current';
    if(url.pathname==='/'){if(!bundles[build])throw Error('Invalid build');res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><script src="/core.js?build='+build+'"></script></head><body><div id="root"></div></body></html>');return;}
    if(url.pathname==='/core.js'){if(!bundles[build])throw Error('Invalid build');res.setHeader('Content-Type','text/javascript');res.end(bundles[build]);return;}
    if(url.pathname==='/browser.mjs'){res.setHeader('Content-Type','text/javascript');res.end(browserSource);return;}
    if(!url.pathname.startsWith('/resources/'))throw Error('Not found');
    const base=build==='upstream'?reference.resources:path.join(repo,'packages/core/resources'),file=path.resolve(base,url.pathname.slice('/resources/'.length));
    if(!file.startsWith(base+path.sep))throw Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const rows=[],groups=[],warmups=[];let browser;
const save=()=>fs.writeFile(path.join(output,'results.json'),JSON.stringify({groups,rows,warmups},null,2)+'\n');
try{
  browser=await chromium.launch({executablePath:args.browser??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const metadata={createdAt:new Date().toISOString(),node:process.version,browser:browser.version(),os:os.type()+' '+os.release(),cpu:os.cpus()[0]?.model,ramBytes:os.totalmem(),upstream:reference,current:{revision:execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTree:execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}).trim(),sha256:hash(bundles.current)},plan:{sizes,reps,warmup,timeoutMs,positions:{early:.25,middle:.5,late:.75},css:fixture(sizes[0]).css,cssHash:hash(fixture(sizes[0]).css),browserHarnessHash:hash(browserSource),trialIsolation:'new browser page per variant; one Chrome process; sequential only',upstreamFocused:'references the same upstream complete sample; not an additional trial',metric:'Core invocation including HTML parse and local seed clone through loaded/focusedterminal; baseline setup, IPC, font snapshot, retained clone and paint excluded'}};
  await fs.writeFile(path.join(output,'environment.json'),JSON.stringify(metadata,null,2)+'\n');
  for(const size of sizes){
    const cases=[{mode:'initial',position:'middle'}];
    for(const scenario of cases){
      const input=fixture(size,scenario.position);await fs.writeFile(path.join(output,`fixture-${size}-${scenario.position}.json`),JSON.stringify(input));
      for(let trial=-warmup;trial<reps;trial++){
        const variants=scenario.mode==='initial'?[['upstream','initial'],['current','initial']]:[['upstream','complete'],['current','complete'],['current','focused']];
        // Rotate execution order to avoid giving one variant the same thermal/cache position.
        const shift=(trial+warmup)%variants.length,order=[...variants.slice(shift),...variants.slice(0,shift)],samples=[];
        for(const [build,mode] of order){
          const page=await browser.newPage({viewport:{width:1200,height:1000}});
          try{
            await page.goto(origin+'/?build='+build);await page.waitForFunction(()=>!!globalThis.VivliostyleCore?.CoreViewer);
            const result=await page.evaluate(async options=>{const {runTrial}=await import('/browser.mjs');return runTrial(options)},{build,mode,fixture:input,timeoutMs});
            samples.push({size,position:scenario.position,trial,build,mode,...result});
          }finally{await page.close();}
        }
        const referenceSample=samples.find(s=>s.build==='upstream'),referencePapers=referenceSample.papers;
        for(const sample of samples){
          const expected=sample.mode==='focused'?[referencePapers[sample.targetIndex]]:referencePapers;
          const matches=JSON.stringify(expected)===JSON.stringify(sample.papers);
          const record={...sample,paperHash:hash(sample.papers),matches};delete record.papers;
          (trial<0?warmups:rows).push(record);
          if(!matches){await fs.writeFile(path.join(output,`mismatch-${size}-${scenario.position}-${trial}-${sample.mode}.json`),JSON.stringify({expected,actual:sample.papers},null,2));await save();throw Error(`Paper mismatch ${size}/${scenario.position}/${trial}/${sample.build}/${sample.mode}`);}
        }
        const group={size,position:scenario.mode==='initial'?null:scenario.position,scenario:scenario.mode,trial,warmup:trial<0,order:order.map(v=>v.join('/')),matches:true};groups.push(group);await save();
        console.log(JSON.stringify({...group,durations:samples.map(s=>({build:s.build,mode:s.mode,ms:Math.round(s.durationMs),reused:s.terminal.reusedPages}))}));
      }
    }
  }
  const stats=values=>{const sorted=values.slice().sort((a,b)=>a-b),n=sorted.length,median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,mean=values.reduce((a,b)=>a+b,0)/n;return {count:n,minMs:sorted[0],medianMs:median,maxMs:sorted[n-1],meanMs:mean,standardDeviationMs:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/n),valuesMs:values};};
  const summary=[];
  for(const size of sizes)for(const scenario of [{mode:'initial',position:'middle'}]){
    const upstreamMode=scenario.mode==='initial'?'initial':'complete',select=(build,mode)=>rows.filter(r=>r.size===size&&r.position===scenario.position&&r.build===build&&r.mode===mode);
    const upstream=stats(select('upstream',upstreamMode).map(r=>r.durationMs)),currentRows=select('current',scenario.mode),current=stats(currentRows.map(r=>r.durationMs));
    summary.push({size,mode:scenario.mode,position:scenario.mode==='initial'?null:scenario.position,upstreamMode,upstream,current,speedup:upstream.medianMs/current.medianMs,reusedPages:currentRows.map(r=>r.terminal.reusedPages??null),seedCloneMs:scenario.mode==='focused'?stats(currentRows.map(r=>r.seedPrepareMs)):null,retainedCloneMs:scenario.mode==='focused'?stats(currentRows.map(r=>r.retainMs)):null,matches:true});
  }
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  const fmt=n=>n.toFixed(1),labels={initial:'初回',complete:'全文更新',focused:'S'},positions={early:'前半',middle:'中盤',late:'後半'};
  const markdown=['# 本家と現行Coreの比較結果','','各セルの値はms、指定回数の中央値。初回は新規Viewerへの入力、更新は同じ未編集原稿に空行一つを挿入する独立試行。前半・中盤・後半は25%・50%・75%付近。Sの本家列は全文更新の同じ測定値を参照する。','','| 字数 | 経路 | 位置 | 本家中央値 | 現行中央値 | 倍率 | 現行min–max |','| --- | --- | --- | ---: | ---: | ---: | ---: |',...summary.map(r=>`| ${r.size} | ${labels[r.mode]} | ${positions[r.position]??'—'} | ${fmt(r.upstream.medianMs)} | ${fmt(r.current.medianMs)} | ${r.speedup.toFixed(2)} | ${fmt(r.current.minMs)}–${fmt(r.current.maxMs)} |`),'',`独立した実測試行数：${rows.length}。除外warmup：${warmups.length}。全試行で全ページまたは対象紙面の本文・寸法・左右・TextNodeの表示矩形が本家全文組版と一致した。`,`環境・raw値・実行順・bundle・fixtureはこの結果ディレクトリに保存。ブラウザ起動、baseline準備、Markdown変換、IPC、seed受信・復元、紙面保持・paint、CW/S同時実行は主指標に含まない。`,''].join('\n');
  await fs.writeFile(path.join(output,'comparison.md'),markdown);
  console.log(JSON.stringify({output,timedTrials:rows.length,warmupTrials:warmups.length,parity:true}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
