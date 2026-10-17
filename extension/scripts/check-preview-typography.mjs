// npm run build --prefix extension, then node extension/scripts/check-preview-typography.mjs
// Tests the production startDisplay pipeline, not a separate display implementation.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'.recovery/preview-typography',String(Date.now()));
await fs.mkdir(output,{recursive:true});
const require=createRequire(path.join(root,'experiments/preview-benchmark/package.json')),{chromium}=require('playwright');
const imp=name=>import(pathToFileURL(path.join(root,'extension/dist/src',name+'.js')));
const {compileVfmManuscript}=await imp('compiler/vfm-manuscript'),{BUILTIN_PUBLICATION}=await imp('config/publication-editor'),{previewInput}=await imp('preview/input'),{previewMarkup}=await imp('preview/webview'),{RuntimeServer}=await imp('preview/runtime-server');
const runtime=new RuntimeServer(process.argv[2]??path.join(root,'extension/dist/runtime'));await runtime.start();
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(previewMarkup('test','',new URL(runtime.url).origin,runtime.url,runtime.url+'core.js').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,''));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
for(const deviceScaleFactor of [1,2]) {
const page=await browser.newPage({viewport:{width:1000,height:850},deviceScaleFactor});
await page.addInitScript(()=>{window.messages=[];window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:message=>window.messages.push(message)});});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.messages.some(m=>m.type==='ready'));
 const cases=[['normal','ああ\nいい',true],['one-blank','ああ\n\nいい',true],['two-blanks','ああ\n\n\nいい',true],['disabled','ああ\n\nいい',false],['heading-normal','# 章\n\nああ\nいい',true],['heading-one-blank','# 章\n\nああ\n\nいい',true],['heading-two-blanks','# 章\n\nああ\n\n\nいい',true],['symbols','あ――あ\nあ——あ\nあ……あ\nあ⋯⋯あ',true]];
 let revision=0;
 for(const font of ['Source Han Serif JP','Yu Mincho']) for(const [name,text,preserveEmptyLines]of cases){
  revision++;
  const settings={...BUILTIN_PUBLICATION,layout:{...BUILTIN_PUBLICATION.layout,fontFamily:[font,'serif']},processing:{...BUILTIN_PUBLICATION.processing,titlePage:false,toc:false,preserveEmptyLines}};
  const snapshot={work:'file:///work/',epoch:1,revision,fingerprint:String(revision),content:text,boundaries:[],sources:[{uri:'file:///work/01.nv',text,virtualStart:0,virtualEnd:text.length,dirty:true}],configText:'{}',config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:true,resourceManifest:{complete:true,stylesheetUris:[],dependencies:[],issues:[]}};
  const document=compileVfmManuscript(snapshot),wire=previewInput({snapshot,document},{uri:'file:///work/01.nv',offset:0});
  await page.evaluate(({wire,request})=>window.postMessage({type:'input',epoch:1,request,source:wire},'*'),{wire,request:revision});
  await page.waitForFunction(revision=>window.messages.some(m=>m.type==='display'&&m.revision===revision),revision,{timeout:60000});
  // Wait until this revision's full committed paper is imported as well.
  await page.waitForFunction(revision=>window.messages.some(m=>m.type==='seed-import-end'&&m.revision===revision),revision,{timeout:60000});
  const measure=()=>{
   const paper=document.querySelector('[data-ogenkou-paper]')??document.querySelector('[data-vivliostyle-page-container]');
   if(!paper)return null;
   const b=paper.getBoundingClientRect(),scale=b.width/paper.offsetWidth,r=n=>Math.round(n*1000)/1000;
   const glyphs=[],walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){const node=walker.currentNode;for(let i=0;i<node.length;i++){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);const rect=range.getBoundingClientRect();if(!rect.width&&!rect.height)continue;glyphs.push({char:node.data[i],x:r((rect.x-b.x)/scale),y:r((rect.y-b.y)/scale),w:r(rect.width/scale),h:r(rect.height/scale),parent:node.parentElement.outerHTML.slice(0,160)});}}
   const props=el=>{const s=getComputedStyle(el);return Object.fromEntries(['font-family','font-size','font-weight','line-height','writing-mode','text-orientation','text-rendering','zoom','transform','font-feature-settings','font-kerning','--viv-layoutUnitAdj'].map(k=>[k,s.getPropertyValue(k)]));};
   const ancestors=[];for(let el=paper.querySelector('p');el;el=el.parentElement)ancestors.push({tag:el.tagName,style:props(el)});
   return {text:paper.textContent,glyphs,ancestors,blanks:[...paper.querySelectorAll('.source-blank-line')].map(el=>{const x=el.getBoundingClientRect(),style=getComputedStyle(el);return{x:r((x.x-b.x)/scale),y:r((x.y-b.y)/scale),w:r(x.width/scale),h:r(x.height/scale),display:style.display,lineHeight:style.lineHeight,font:style.fontFamily};}),symbols:[...paper.querySelectorAll('.connected-dashes')].map(el=>{const x=el.getBoundingClientRect(),style=getComputedStyle(el);return{text:el.textContent,x:r((x.x-b.x)/scale),w:r(x.width/scale),font:style.fontFamily,fontSize:style.fontSize,verticalAlign:style.verticalAlign,lineHeight:style.lineHeight,backgroundPosition:style.backgroundPosition};})};
  };
  const cw=page.frames().find(frame=>frame.url()===runtime.url+'cw');
  const native=await cw.evaluate(measure);
  let displayed;for(const frame of page.frames()){if(frame===page.mainFrame()||frame===cw)continue;const m=await frame.evaluate(measure);if(m&&await frame.evaluate(()=>getComputedStyle(window.frameElement).visibility==='visible')){displayed=m;break;}}
  results.push({deviceScaleFactor,font,name,body:document.html.match(/<body>[\s\S]*<\/body>/)?.[0],native,displayed});assert(native&&displayed,'both Core and presentation paper required');
  const compare=(actual,label)=>{assert.equal(actual.glyphs.length,native.glyphs.length,label+' glyph count');for(let i=0;i<native.glyphs.length;i++){const a=actual.glyphs[i],b=native.glyphs[i];assert.equal(a.char,b.char,label+' text');for(const key of ['x','y','w','h'])assert(Math.abs(a[key]-b[key])<=.003,label+' '+key+' '+JSON.stringify({a,b}));}};
  compare(displayed,deviceScaleFactor+'/'+font+'/'+name);
  assert.equal(displayed.blanks.length,{'normal':0,'one-blank':1,'two-blanks':2,'disabled':0,'symbols':0,'heading-normal':1,'heading-one-blank':2,'heading-two-blanks':3}[name]);
  if(name!=='symbols'){const a=displayed.glyphs.find(g=>g.char==='あ'),b=displayed.glyphs.find(g=>g.char==='い'),lines={'normal':1,'one-blank':2,'two-blanks':3,'disabled':1,'heading-normal':1,'heading-one-blank':2,'heading-two-blanks':3}[name];assert(Math.abs(Math.abs(a.x-b.x)-21*lines)<.1,'blank line must reserve one line pitch');}
  if(name==='symbols'){
   await page.locator('#zoom-in').click();
   for(const frame of page.frames())if(frame!==cw&&frame!==page.mainFrame()&&await frame.locator('[data-ogenkou-paper]').count()&&await frame.evaluate(()=>getComputedStyle(window.frameElement).visibility==='visible'))compare(await frame.evaluate(measure),'zoomed symbols');
   await page.locator('#zoom').click();
   for(const frame of page.frames())if(frame!==cw&&frame!==page.mainFrame()&&await frame.locator('[data-ogenkou-paper]').count()&&await frame.evaluate(()=>getComputedStyle(window.frameElement).visibility==='visible'))await frame.locator('[data-ogenkou-paper]').first().screenshot({path:path.join(output,'symbols-'+deviceScaleFactor+'-'+font.replaceAll(' ','-')+'.png')});
   const old=await page.locator('#cw').getAttribute('style');await page.locator('#papers').evaluate(el=>el.style.visibility='hidden');await page.locator('#cw').evaluate(el=>el.style.cssText='position:fixed;left:0;top:0;width:1100px;height:850px;z-index:99;border:0');
   await cw.locator('[data-vivliostyle-page-container]').first().screenshot({path:path.join(output,'native-symbols-'+deviceScaleFactor+'-'+font.replaceAll(' ','-')+'.png')});
   await page.locator('#cw').evaluate((el,old)=>el.setAttribute('style',old??''),old);await page.locator('#papers').evaluate(el=>el.style.visibility='');
  }
 }
 await page.close();
}
 await fs.writeFile(path.join(output,'preview-spacing-results.json'),JSON.stringify(results,null,2));
console.log('Preview typography checks passed: '+results.length+' cases, '+output);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await runtime.close();}
