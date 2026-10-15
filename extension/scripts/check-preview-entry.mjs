import {vscodeExecutable} from './vscode-executable.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {manuscript} from './edit-to-paper-workload.mjs';
const root=path.resolve(import.meta.dirname,'../..'),directory=path.join(root,'.recovery/preview-entry',String(Date.now()));
const workspace=path.join(directory,'workspace'),result=path.join(directory,'result.json');
for(const name of ['first','second','fallback'])await fs.mkdir(path.join(workspace,name),{recursive:true});
await fs.writeFile(path.join(workspace,'first/01.novel'),manuscript(process.env.OGENKOU_PDF_DIALOG_TEST==='1'?500:process.env.OGENKOU_INITIAL_UI_TEST==='1'?160000:40000,'plain','end').text);
await fs.writeFile(path.join(workspace,'second/01.nv'),manuscript(process.env.OGENKOU_SPREAD_UI_TEST==='1'?40000:160000,'plain','end').text);
if(process.env.OGENKOU_SPREAD_UI_TEST==='1')await fs.writeFile(path.join(workspace,'second/ogenkou.jsonc'),JSON.stringify({settingsVersion:1,overrides:{writingMode:'horizontal'}}));
if(process.env.OGENKOU_SPREAD_UI_TEST==='1'||process.env.OGENKOU_ENTRY_DASH_BENCHMARK==='1')for(const [name,file]of [['first','01.novel'],['second','01.nv']]){const uri=path.join(workspace,name,file);await fs.writeFile(uri,'ダッシュ――と——の連結。\n\n'+await fs.readFile(uri,'utf8'));}
if(process.env.OGENKOU_ENTRY_RESOURCE_BENCHMARK==='1')for(const [name,file] of [['first','01.novel'],['second','01.nv']]){
 const dir=path.join(workspace,name),text=await fs.readFile(path.join(dir,file),'utf8');
 await fs.writeFile(path.join(dir,file),'# 第一章\n\n![挿絵](a.png)\n\n'+text.replace('編集対象の本文です。','# 最終章\n\n編集対象の本文です。'));
 await fs.writeFile(path.join(dir,'a.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=','base64'));
 await fs.writeFile(path.join(dir,'custom.css'),'@import "nested.css"; img{width:8mm;height:8mm}');await fs.writeFile(path.join(dir,'nested.css'),'p{color:black}');
 await fs.writeFile(path.join(dir,'ogenkou.jsonc'),'{"settingsVersion":1,"style":"custom.css"}');
}
await fs.writeFile(path.join(workspace,'fallback/01.novel'),'# 第一章\n\n本文です。\n\n![画像](a.svg)\n\n# 第二章\n\n続きの本文。');
await fs.writeFile(path.join(workspace,'fallback/a.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="red"/></svg>');
await fs.writeFile(path.join(workspace,'fallback/ogenkou.jsonc'),'{"settingsVersion":1,"style":"custom.css"}');
await fs.writeFile(path.join(workspace,'fallback/custom.css'),'@import "nested.css"; img{width:8mm;height:8mm}');
await fs.writeFile(path.join(workspace,'fallback/nested.css'),'p{color:black}');
await fs.writeFile(path.join(workspace,'fallback/a.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=','base64'));
const code=vscodeExecutable();
const child=spawn(code,[workspace,'--new-window','--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--user-data-dir',path.join(directory,'profile'),'--extensions-dir',path.join(directory,'extensions'),'--extensionDevelopmentPath',path.join(root,'extension'),'--extensionTestsPath',path.join(root,process.env.OGENKOU_PDF_DIALOG_TEST==='1'?'extension/test-host/pdf-overwrite.cjs':process.env.OGENKOU_SPREAD_UI_TEST==='1'?'extension/test-host/spread-preview-ui.cjs':process.env.OGENKOU_INITIAL_UI_TEST==='1'?'extension/test-host/initial-preview-ui.cjs':process.env.OGENKOU_PRODUCT_TEST==='1'?'extension/test-host/product-preview.cjs':process.env.OGENKOU_ENTRY_FALLBACK_ONLY==='1'?'extension/test-host/preview-fallback.cjs':'extension/test-host/preview-entry.cjs')],{windowsHide:true,env:{...process.env,OGENKOU_ENTRY_WORKSPACE:workspace,OGENKOU_ENTRY_RESULT:result},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
const timer=setTimeout(()=>child.kill(),240000);
const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});clearTimeout(timer);
await fs.writeFile(path.join(directory,'process.log'),log);
if(status!==0)throw Error(`Preview entry test failed (${status}): ${directory}`);
const report=JSON.parse(await fs.readFile(result,'utf8'));console.log(JSON.stringify({directory,checks:report.checks,measurements:report.measurements?.map(({events,...summary})=>summary),vscode:report.vscode,pdfBytes:report.pdfBytes},null,2));
