import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {compileVfmManuscript} from '../dist/src/compiler/vfm-manuscript.js';
import {CompilerService} from '../dist/src/compiler/compiler-service.js';
import {BUILTIN_PUBLICATION as settings} from '../dist/src/config/publication-editor.js';
const root=path.resolve(import.meta.dirname,'../..');
await fs.mkdir(path.join(root,'.recovery/compiler-host'),{recursive:true});
const service=new CompilerService(),cases=[];
try{
 for(const size of [40000,80000,160000]){
  const line='これは日本語の小説本文です。主人公は窓を開けた。\n',text=line.repeat(Math.ceil(size/line.length)).slice(0,size);
  const snapshot={work:'file:///work/',epoch:1,revision:1,settings,config:{},sources:[{uri:'file:///work/01.novel',text}]};
  compileVfmManuscript(snapshot);await service.compile(snapshot);
  const direct=[],worker=[],gaps=[];let last=performance.now();
  // Main-thread heartbeat is measured only while compilation runs in the Worker.
  for(let i=0;i<3;i++){
   let start=performance.now();compileVfmManuscript(snapshot);direct.push(performance.now()-start);
   last=performance.now();const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},10);
   try{start=performance.now();await service.compile(snapshot);worker.push(performance.now()-start);await new Promise(r=>setTimeout(r,20));}finally{clearInterval(timer);}
  }
  direct.sort((a,b)=>a-b);worker.sort((a,b)=>a-b);cases.push({utf16Units:size,samples:3,directMedianMs:direct[1],directMaxMs:direct.at(-1),workerMedianMs:worker[1],workerMaxMs:worker.at(-1),mainThreadHeartbeatMaxGapMs:Math.max(...gaps)});
 }
}finally{await service.close();}
const report={scope:'Plain prose VFM conversion control; warm direct and Worker timings, not Core/UI performance',node:process.version,cases};
await fs.writeFile(path.join(root,'.recovery/compiler-host/vfm-plain.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
