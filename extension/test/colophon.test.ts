import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'parse5';
import {parseColophon,colophonTemplate,COLOPHON_CSS} from '../src/compiler/colophon.js';
import {createColophon} from '../src/services/create-colophon.js';
import {SnapshotBuilder,type WorkSnapshot} from '../src/services/snapshot-builder.js';
import {NodeSnapshotHost} from '../src/services/node-snapshot-host.js';
import {compileVfmManuscript} from '../src/compiler/vfm-manuscript.js';
import {resolveGeneratedPosition} from '../src/compiler/manuscript.js';
import {BUILTIN_PUBLICATION} from '../src/config/publication-editor.js';
import type {DocumentStore,TextRecord} from '../src/services/contracts.js';

const sample=`template: okuduke
書名: 夜明けの窓辺
発行日: 2026年10月17日 初版発行
項目:
  - 名前: 編集・装丁
    内容: '綾川 & <いっこう>'
  - 名前: お問い合わせ
    内容: https://example.com/
罫線: true
注意書き: |
  転載しないでください。
  お問い合わせは上記まで。
`;
function snapshot(yaml=sample):WorkSnapshot {
 const settings={...structuredClone(BUILTIN_PUBLICATION),processing:{...BUILTIN_PUBLICATION.processing,titlePage:false}};
 const sources=[{uri:'file:///work/01.nv',text:'# 第一章\n本文。'},{uri:'file:///work/99_okuduke.yaml',text:yaml}].map(s=>({...s,virtualStart:0,virtualEnd:s.text.length,dirty:true}));
 return {work:'file:///work/',epoch:1,revision:1,fingerprint:'test',content:sources.map(s=>s.text).join('\n\n'),sources,boundaries:[],settings,rawSettings:settings,resources:[],resourceManifestComplete:false,configText:'{}',config:{theme:[],quickPreview:true,overrides:{}}};
}

test('colophon parses editable labels, optional fields, comments and multiline notices',()=>{
 const parsed=parseColophon(sample)!;assert.equal(parsed.items[0]!.name.value,'編集・装丁');assert(parsed.notice!.value.includes('\nお問い合わせ'));
 assert.equal(parseColophon('template: okuduke\n罫線: false')!.rule,false);
 assert.equal(parseColophon('unrelated: true'),undefined);
 assert.equal(parseColophon('unrelated: [broken'),undefined);
 const text=colophonTemplate('書名: 特別','著者',new Date('2026-10-16T16:00:00Z'));
 assert.equal(parseColophon(text)!.date!.value,'2026年10月17日 初版発行');assert.equal(parseColophon(text)!.title!.value,'書名: 特別');
 for(const invalid of ['template: wrong','template: okuduke\n書名: true','template: okuduke\n罫線: yes','template: okuduke\n項目: [x]','template: okuduke\n項目:\n - 名前: 著者','template: okuduke\n書名: A\n書名: B','template: okuduke\n書名: &name [a]\n注意書き: *name','template: okuduke\n注意書き: !!js/function x'])assert.throws(()=>parseColophon(invalid),/奥付YAML/u,invalid);
});

test('colophon compiles escaped content, omits it from TOC and maps every field to YAML ranges',()=>{
 const s=snapshot(),compiled=compileVfmManuscript(s);assert.equal(compiled.headings.length,1);
 assert.match(compiled.html,/<section class="colophon"/u);assert.match(compiled.html,/綾川 &amp; &lt;いっこう&gt;/u);
 assert.match(compiled.html,/<a href="https:\/\/example.com\/">/u);assert.match(compiled.html,/<hr>/u);assert.match(compiled.css,/page: ogenkou-colophon/u);
 const tree:any=parse(compiled.html),html=tree.childNodes.find((n:any)=>n.nodeName==='html');
 for(const entry of compiled.sourceMap){let node=html;for(const step of entry.path)node=node.childNodes[step];assert.equal(node.value,entry.text);}
 const yamlMaps=compiled.mappings.filter(m=>m.uri.endsWith('.yaml'));assert(yamlMaps.length>=7);
 for(const mapping of yamlMaps){const point=resolveGeneratedPosition(compiled,mapping.key,0)!;assert(point.start>=0&&point.end<=sample.length);assert.equal(point.uri,s.sources[1]!.uri);}
 const author=yamlMaps.find(m=>m.text==='綾川 & <いっこう>')!,point=resolveGeneratedPosition(compiled,author.key,0)!;
 assert.equal(sample.slice(point.start,point.end),"'綾川 & <いっこう>'");
 const empty=compileVfmManuscript(snapshot('template: okuduke\n項目:\n  - 名前: ""\n    内容: ""'));assert(!empty.html.includes('data-ogenkou-map-'));
 const noRule=compileVfmManuscript(snapshot('template: okuduke\n罫線: false\n注意書き: "<script>alert(1)</script>"'));
 assert(!noRule.html.includes('<hr>'));assert(!noRule.html.includes('<script>'));assert.match(noRule.html,/&lt;script&gt;/u);
});

test('snapshot naturally orders only marked YAML, captures dirty edits and supports opening from YAML',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'ogenkou-colophon-')),root=pathToFileURL(folder+path.sep).href;
 let buffers:{uri:string;text:string;version:number;dirty:boolean}[]=[];
 try {
  await writeFile(path.join(folder,'ogenkou.jsonc'),'{}');await writeFile(path.join(folder,'01.nv'),'本文');await writeFile(path.join(folder,'99_okuduke.yaml'),sample);await writeFile(path.join(folder,'config.yaml'),'settings: true');
  const builder=new SnapshotBuilder(new NodeSnapshotHost(()=>buffers));builder.activate(new URL('99_okuduke.yaml',root).href);
  const first=await builder.build();assert.deepEqual(first.sources.map(s=>new URL(s.uri).pathname.split('/').at(-1)),['01.nv','99_okuduke.yaml']);
  buffers=[{uri:new URL('99_okuduke.yaml',root).href,text:sample.replace('夜明けの窓辺','変更した書名'),version:2,dirty:true}];
  const second=await builder.build();assert(second.revision>first.revision);assert.match(compileVfmManuscript(second).html,/変更した書名/u);assert(second.sources[1]!.dirty);
  assert.equal(await readFile(path.join(folder,'99_okuduke.yaml'),'utf8'),sample);
  buffers=[{...buffers[0]!,text:'template: okuduke\n項目: [broken'}];await assert.rejects(builder.build(),/99_okuduke.yaml/u);
  builder.close();
 } finally {await rm(folder,{recursive:true,force:true});}
});

class Store implements DocumentStore {
 files=new Map<string,TextRecord>();
 async read(uri:string){const r=this.files.get(uri);if(!r)throw Object.assign(new Error('missing'),{code:'ENOENT'});return r;}
 async create(uri:string,text:string){if(this.files.has(uri))throw Object.assign(new Error('exists'),{code:'EEXIST'});const r={uri,text,version:'1',dirty:false};this.files.set(uri,r);return r;}
 async compareAndSwap(base:TextRecord,text:string){assert.equal(this.files.get(base.uri),base);const r={...base,text,version:String(Number(base.version)+1),dirty:true};this.files.set(base.uri,r);return r;}
}
test('add colophon preserves existing CSS and dirty JSONC, registers style and is idempotent',async()=>{
 const store=new Store(),root='file:///work/',signal=new AbortController().signal;
 const config='// user comment\n{"publication":{"title":"私の本","author":"作者"},"style":"styles/custom.css","theme":["base.css"]}';
 store.files.set(root+'ogenkou.jsonc',{uri:root+'ogenkou.jsonc',text:config,dirty:true,version:'1'});
 store.files.set(root+'styles/custom.css',{uri:root+'styles/custom.css',text:'/* custom */',dirty:true,version:'1'});
 const result=await createColophon(store,root,async()=>{},signal,new Date('2026-10-17T00:00:00Z'));
 assert.equal(result.saveConfig,false);assert(result.config!.text.startsWith('// user comment'));assert.match(result.config!.text,/styles\/colophon.css/u);
 assert.equal(parseColophon(result.document.text)!.title!.value,'私の本');assert.equal(parseColophon(result.document.text)!.items[0]!.content.value,'作者');
 assert.equal(store.files.get(root+'styles/custom.css')!.text,'/* custom */');assert(store.files.get(root+'styles/colophon.css')!.text.includes(COLOPHON_CSS));
 const second=await createColophon(store,root,async()=>{throw Error('must not create again');},signal);assert.equal(second.document,result.document);assert.equal(second.config,undefined);
});
