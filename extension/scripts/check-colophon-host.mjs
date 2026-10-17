import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {vscodeExecutable} from './vscode-executable.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=path.join(root,'.recovery/colophon-host',String(Date.now())),workspace=path.join(folder,'workspace'),result=path.join(folder,'result.json');
await fs.mkdir(workspace,{recursive:true});
await fs.writeFile(path.join(workspace,'01.nv'),'# 第一章\n\n'+Array.from({length:30},(_,i)=>`本文${i}。雨の降る窓辺で本を書き続ける。`).join('\n\n'));
await fs.writeFile(path.join(workspace,'ogenkou.jsonc'),JSON.stringify({settingsVersion:1,publication:{title:'試験の本',author:'試験の著者'},overrides:{processing:{titlePage:false,toc:false}}}));
const processEnv={...process.env,OGENKOU_COLOPHON_WORKSPACE:workspace,OGENKOU_COLOPHON_RESULT:result};
// An isolated test profile leaves the user's installed extension and work untouched.
const child=spawn(vscodeExecutable(),[workspace,'--new-window','--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--user-data-dir',path.join(folder,'profile'),'--extensions-dir',path.join(folder,'extensions'),'--extensionDevelopmentPath',path.join(root,'extension'),'--extensionTestsPath',path.join(root,'extension/test-host/colophon.cjs')],{windowsHide:true,env:processEnv,stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);
const timer=setTimeout(()=>child.kill(),180000);
const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
await fs.writeFile(path.join(folder,'process.log'),log);
if(status!==0)throw Error('Colophon host test failed ('+status+'): '+folder);
const report=JSON.parse(await fs.readFile(result,'utf8'));console.log(JSON.stringify({folder,checks:report.checks,vscode:report.vscode},null,2));
