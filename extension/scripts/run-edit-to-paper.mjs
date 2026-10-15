import {vscodeExecutable} from './vscode-executable.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {manuscript} from './edit-to-paper-workload.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const match=/^--([^=]+)=(.+)$/u.exec(arg);if(!match)throw Error('Use --name=value');return [match[1],match[2]]}));
const sizes=(options.sizes??'40000,80000,160000').split(',').map(Number),profiles=(options.profiles??'plain,dense').split(',');
const count=Number(options.inputs??40),interval=Number(options.interval??200),isolated=Number(options.isolated??3);
if(sizes.some(n=>!Number.isSafeInteger(n)||n<1000||n>320000)||profiles.some(p=>!['plain','dense'].includes(p))||!Number.isSafeInteger(count)||count<1||count>200||!Number.isSafeInteger(interval)||interval<50||interval>5000||!Number.isSafeInteger(isolated)||isolated<1||isolated>5)throw Error('Invalid benchmark options');
const output=path.join(root,'.recovery/compiler-host/edit-to-paper',String(Date.now())),workspace=path.join(root,'.recovery/20261010-edit-to-paper',path.basename(output));
await fs.mkdir(output,{recursive:true});await fs.mkdir(workspace,{recursive:true});
const cases=[];
for(const profile of profiles)for(const size of sizes){const name=`${profile}-${size}`,dir=path.join(workspace,name),fixture=manuscript(size,profile,options.position??'middle');await fs.mkdir(dir);
 await fs.writeFile(path.join(dir,'01.novel'),fixture.text);await fs.writeFile(path.join(dir,'ogenkou.jsonc'),JSON.stringify({settingsVersion:1,title:'測定',style:'custom.css'}));await fs.writeFile(path.join(dir,'custom.css'),'p { color: #202020; }');
 cases.push({name,size,profile,position:options.position??'middle',directory:dir,marker:fixture.marker,offset:fixture.offset,inputCount:count,inputIntervalMs:interval,isolatedCount:isolated});}
await fs.writeFile(path.join(output,'plan.json'),JSON.stringify(cases,null,2)+'\n');
await fs.mkdir(path.join(output,'sources'));
for(const file of ['extension/scripts/edit-to-paper-browser.mjs','extension/scripts/edit-to-paper-workload.mjs','extension/scripts/run-edit-to-paper.mjs','extension/test-host/edit-to-paper.cjs',
 'extension/src/services/snapshot-builder.ts','extension/dist/src/services/snapshot-builder.js','extension/src/host/vscode-adapters.ts','extension/dist/src/host/vscode-adapters.js'])await fs.copyFile(path.join(root,file),path.join(output,'sources',path.basename(file)));
const sha=async file=>createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
await fs.writeFile(path.join(output,'environment.json'),JSON.stringify({node:process.version,os:os.release(),cpu:os.cpus()[0]?.model,ram:os.totalmem(),
 scope:'Actual VS Code edit event -> snapshot/VFM/collector -> CW/S renderer -> two animation frames; excludes physical keyboard and production UI',
 transport:{css:'captured bytes as data URL, CSS dependencies unsupported in this fixture transport',core:'same Core bytes captured once as a blob script in S'},
 hashes:{core:await sha('vivliostyle/packages/core/lib/vivliostyle.iife.js'),compiler:await sha('extension/dist/src/compiler/vfm-manuscript.js'),snapshot:await sha('extension/dist/src/services/snapshot-builder.js'),adapter:await sha('extension/dist/src/host/vscode-adapters.js'),collector:await sha('extension/dist/src/services/resource-collector.js'),browser:await sha('extension/scripts/edit-to-paper-browser.mjs'),host:await sha('extension/test-host/edit-to-paper.cjs'),workload:await sha('extension/scripts/edit-to-paper-workload.mjs')}},null,2)+'\n');
const code=vscodeExecutable();
const child=spawn(code,[workspace,'--new-window','--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes',
 '--user-data-dir',path.join(workspace,'profile'),'--extensions-dir',path.join(workspace,'extensions'),
 '--extensionDevelopmentPath',path.join(root,'extension/test-host'),'--extensionTestsPath',path.join(root,'extension/test-host/edit-to-paper.cjs')],
 {windowsHide:true,env:{...process.env,OGENKOU_EDIT_TO_PAPER_OUTPUT:output},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',data=>{log+=data});child.stderr.on('data',data=>{log+=data});
const timer=setTimeout(()=>child.kill(),1800000);
const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});clearTimeout(timer);await fs.writeFile(path.join(output,'process.log'),log);
console.log('Results: '+output);if(status!==0)throw Error(`Edit-to-paper benchmark failed (${status}); inspect process.log and events.jsonl`);
const result=JSON.parse(await fs.readFile(path.join(output,'result.json'),'utf8'));console.log(JSON.stringify(result,null,2));
const summarizer=spawn(process.execPath,[path.join(root,'extension/scripts/summarize-edit-to-paper.mjs'),output],{windowsHide:true,stdio:'inherit'});
if(await new Promise((resolve,reject)=>{summarizer.on('error',reject);summarizer.on('exit',resolve)})!==0)throw Error('Event summary failed');
