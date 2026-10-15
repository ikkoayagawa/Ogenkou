import {vscodeExecutable} from './vscode-executable.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const output=path.join(root,'.recovery','20261010-vscode-host',String(Date.now()));
const workspace=path.join(output,'workspace'); await fs.mkdir(workspace,{recursive:true});
await fs.writeFile(path.join(workspace,'01.novel'),'# 試験\n本文\n');
const code=vscodeExecutable();
const result=path.join(output,'result.json');
const args=[workspace,'--new-window','--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes',
  '--user-data-dir',path.join(output,'profile'),'--extensions-dir',path.join(output,'extensions'),
  '--extensionDevelopmentPath',path.join(root,'extension/test-host'),'--extensionTestsPath',path.join(root,'extension/test-host/test.cjs')];
const child=spawn(code,args,{windowsHide:true,env:{...process.env,OGENKOU_FOUNDATION_WORKSPACE:workspace,OGENKOU_FOUNDATION_RESULT:result},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',data=>{log+=data});child.stderr.on('data',data=>{log+=data});
const timer=setTimeout(()=>{child.kill();},120000);
const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});clearTimeout(timer);
await fs.writeFile(path.join(output,'process.log'),log);
if(status!==0)throw new Error(`VS Code host check failed (${status}); logs: ${output}`);
const report=JSON.parse(await fs.readFile(result,'utf8'));if(report.passed!==12)throw new Error('Incomplete host checks');
console.log(JSON.stringify({...report,output},null,2));
