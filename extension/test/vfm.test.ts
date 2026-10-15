import {test} from "node:test";
import assert from "node:assert/strict";
import {parse} from "parse5";
import {compileVfmManuscript} from "../src/compiler/vfm-manuscript.js";
import {resolveGeneratedPosition} from "../src/compiler/manuscript.js";
import {BUILTIN_PUBLICATION} from "../src/config/publication-editor.js";
import type {WorkSnapshot} from "../src/services/snapshot-builder.js";
function input(texts:string[]):WorkSnapshot {
 const settings=structuredClone(BUILTIN_PUBLICATION);
 return {work:"file:///work/",epoch:1,revision:2,fingerprint:"test",content:texts.join("\n\n"),boundaries:[],configText:"{}",config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:false,
 sources:texts.map((text,i)=>({uri:`file:///work/${i}.novel`,text,virtualStart:0,virtualEnd:text.length,dirty:true}))};
}
function paths(c:ReturnType<typeof compileVfmManuscript>){
 const dom:any=parse(c.html),html=dom.childNodes.find((n:any)=>n.nodeName==="html");
 for(const e of c.sourceMap){let n=html;for(const i of e.path)n=n.childNodes[i];assert.equal(n.nodeName,"#text");assert.equal(n.value,e.text);}
 assert(!c.html.includes("data-ogenkou-map-"));assert.equal(new Set(c.mappings.map(m=>m.key)).size,c.mappings.length);
}
test("TOC can be disabled without removing heading anchors and source mapping",()=>{
 const s=input(['# 第一章\n\n｜本文《ほんぶん》。\n\n# 第二章\n\n次。']);
 const enabled=compileVfmManuscript(s),disabled=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,toc:false}}});
 assert(enabled.html.includes('role="doc-toc"'));assert(!disabled.html.includes('role="doc-toc"'));assert.equal(disabled.headings.length,2);paths(disabled);
 assert(disabled.html.includes(disabled.headings[0]!.id));
});
test("TOC depth selects heading levels without changing outline or body source mapping",()=>{
 const s=input(['# 章\n\n## 節\n\n### 項\n\n#### 詳細\n\n##### 小詳細\n\n###### 末端\n\n本文。']);
 for(const depth of [1,3,6]){
  const c=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,tocDepth:depth}}});paths(c);
  assert.equal((c.html.match(/class="ogenkou-toc-entry"/g)??[]).length,depth);assert.equal(c.headings.length,6);
 }
});
test("VFM preserves Markdown structures and source positions through emphasis, escapes and entities",()=>{
 const text="**強調**と本文\\* &amp; 😀\n\n- 項目\n\n> 引用\n\n|列|値|\n|---|---|\n|A|B|";
 const c=compileVfmManuscript(input([text]));paths(c);for(const tag of ["strong","ul","blockquote","table"])assert(c.html.includes("<"+tag));
 for(const m of c.mappings)for(const r of m.runs)if(r.mode==="identity")assert.equal(m.text.slice(r.generatedStart,r.generatedEnd),text.slice(r.sourceStart,r.sourceEnd));
 const entity=c.mappings.find(m=>m.text.includes("&"))!,p=resolveGeneratedPosition(c,entity.key,entity.text.indexOf("&"))!;assert.equal(text.slice(p.start,p.end),"&amp;");
});
test("ASCII and ideographic indent survive hard breaks; structural Markdown indent stays structural",()=>{
 const c=compileVfmManuscript(input(["  第一行。\r\n  **第二行**\n　第三行。\n\n    コード"]));paths(c);
 assert(c.html.includes("<p>  第一行。<br>  <strong>第二行</strong><br>　第三行。</p>"));assert(/<pre(?:\s|>)/u.test(c.html));
 const s=input(["  第一行。\n  第二行。"]);
 const no=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,preserveLineIndent:false}}});assert(no.html.includes("<p>第一行。<br>第二行。</p>"));paths(no);
});
test("ruby forms and emphasis retain exact body ranges; readings follow parent ranges",()=>{
 const text="😀｜親文字《よみ》 漢字《かんじ》 [[rb:基>き]] [[emphasismark:本文>○]] 《《傍点》》";
 const c=compileVfmManuscript(input([text]));paths(c);assert.equal(c.mappings.filter(m=>m.kind==="ruby-base").length,3);
 for(const m of c.mappings.filter(m=>m.kind==="ruby-base")){const p=resolveGeneratedPosition(c,m.key,0)!;assert.equal(text.slice(p.start,p.start+m.text.length),m.text);}
 for(const m of c.mappings.filter(m=>m.kind==="ruby-reading")){const p=resolveGeneratedPosition(c,m.key,0)!;assert(["親文字","漢字","基"].includes(text.slice(p.start,p.end)));assert(p.approximate);}
 assert(c.html.includes("text-emphasis-style: '○'"));assert(c.mappings.some(m=>m.text==="傍点"));
 const block=compileVfmManuscript(input(["[[rb:基>き]]\n\n[[emphasismark:本文]]"]));assert(block.html.includes("<ruby>基<rt>き</rt></ruby>"));assert(block.html.includes("ogenkou-emphasis"));paths(block);
});
test("legacy Japanese typography handles wide digits, punctuation and uncomposable kana; code stays literal",()=>{
 const c=compileVfmManuscript(input(['１２ !? あ゛ かﾞ “引用” ―― `漢字《よみ》12`']));paths(c);
 assert(c.html.includes('class="ogenkou-tcy">12'));assert(c.html.includes('class="ogenkou-tcy">!?'));assert(c.html.includes('class="kana-mark"'));assert(c.html.includes("か\u3099"));assert(c.html.includes('〝引用〟'));assert(c.html.includes('<code>漢字《よみ》12</code>'));
});
test("connected dash variants preserve source characters and obey the switch",()=>{
 const text='前――途中——後―—。単独―と—。`――`';const s=input([text]);
 const yes=compileVfmManuscript(s);paths(yes);
 assert.equal((yes.html.match(/class="connected-dashes"/g)??[]).length,3);
 for(const value of ['――','——','―—']){const map=yes.mappings.find(m=>m.text===value)!;assert(map);const p=resolveGeneratedPosition(yes,map.key,1)!;assert.equal(p.start,text.indexOf(value)+1);assert(!p.approximate);}
 assert(yes.html.includes('<code>――</code>'));
 const no=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,connectedDashes:false}}});paths(no);assert(!no.html.includes('class="connected-dashes"'));
});
test("soft lines stay soft and quotes do not turn the rest of a paragraph into approximate positions",()=>{
 const text='本文 “引用” と後半。\r\n  次行。';const s=input([text]);
 const c=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,hardLineBreaks:false}}});paths(c);
 assert(!c.html.includes("<br>"));assert(c.html.includes("と後半。   次行。"));
 const map=c.mappings.find(m=>m.text.includes("後半"))!,p=resolveGeneratedPosition(c,map.key,map.text.indexOf("後半"))!;assert.equal(p.start,text.indexOf("後半"));assert(!p.approximate);
 const hard=compileVfmManuscript(input(["第一行。  \n第二行。"]));paths(hard);assert(hard.html.includes("<br>第二行。"));
});
test("file-local fences, empty lines, automatic TOC, unique heading IDs and file-relative assets",()=>{
 const c=compileVfmManuscript(input(["```\n｜無変換《よみ》\n", "# 同名\n\n本文。\n\n![図](assets/a.png)\n\n# 同名\n末尾"]));paths(c);
 assert.equal(c.headings.length,2);assert.notEqual(c.headings[0]!.id,c.headings[1]!.id);assert(c.html.includes('role="doc-toc"'));assert(c.html.includes('source-blank-line'));assert.equal(c.resourceRequests[0]!.uri,"file:///work/assets/a.png");assert(c.html.includes("無変換《よみ》"));
});
test("disabled notation and horizontal processing retain the original setting intent",()=>{
 const s=input(["｜漢字《かんじ》 [[rb:基>き]]"]);
 const c=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,ruby:{...s.settings.processing.ruby,pipeAngle:false,bracket:false}}}});paths(c);assert(!c.html.includes("<ruby>"));assert(c.html.includes("｜漢字《かんじ》"));
 const horizontal=compileVfmManuscript({...s,settings:{...s.settings,writingMode:"horizontal",processing:{...s.settings.processing,automaticTcy:false,kanaMarks:false,verticalQuotes:false}},sources:[{...s.sources[0]!,text:'１２ あ゛ “引用”'}]});paths(horizontal);assert(!horizontal.html.includes('class="ogenkou-tcy"'));assert(!horizontal.html.includes('class="kana-mark"'));assert(horizontal.html.includes('“引用”'));
});
test("native VFM ruby readings also follow the parent text instead of losing their click target",()=>{
 const text='前 {東京|とうきょう} 後',c=compileVfmManuscript(input([text]));paths(c);
 const reading=c.mappings.find(m=>m.kind==="ruby-reading")!,position=resolveGeneratedPosition(c,reading.key,1)!;assert.equal(text.slice(position.start,position.end),"東京");
});


test("explicit title metadata generates an optional cover before TOC and preserves body positions",()=>{
 const text='---\ntitle: 夜の物語\nauthor: 筆者\n---\n\n# 第一章\n\n本文。';const s=input([text]);
 const c=compileVfmManuscript(s);paths(c);assert(c.html.includes('<title>夜の物語</title>'));assert(c.html.indexOf('ogenkou-title-page')<c.html.indexOf('role="doc-toc"'));assert(c.html.includes('筆者'));assert.equal(c.headings.length,1);
 const body=c.mappings.find(m=>m.text.includes('本文。'))!;assert.equal(text.slice(body.runs[0]!.sourceStart,body.runs.at(-1)!.sourceEnd),'本文。');
 const off=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,titlePage:false}}});assert(!off.html.includes('ogenkou-title-page'));paths(off);
 const overridden=compileVfmManuscript({...s,config:{...s.config,title:'作品設定の題名'}});assert(overridden.html.includes('<title>作品設定の題名</title>'));
 assert(!compileVfmManuscript(input(['# 章名\n\n本文。'])).html.includes('ogenkou-title-page'));
});
test("running-head limit counts characters including ellipsis; blank preserves the full heading",()=>{
 const s=input(['# あいうえお𠮷かきくけこ\n\n本文。']);
 for(const [limit,expected] of [['5','あいうえ…'],['1','…'],['','あいうえお𠮷かきくけこ']]){
  const c=compileVfmManuscript({...s,settings:{...s.settings,layout:{...s.settings.layout,runningHeadMaxLength:limit}}});paths(c);assert(c.html.includes('data-running-head="'+expected+'"'));assert.equal(c.headings[0]!.title,'あいうえお𠮷かきくけこ');
 }
});


test("empty manuscripts still contain an unmapped blank page anchor",()=>{
 const c=compileVfmManuscript(input(['']));paths(c);assert(c.html.includes('ogenkou-empty-manuscript'));assert.equal(c.mappings.length,0);assert.equal(c.sourceMap.length,0);
});
test("TOC numbers have a separate generated box and independent direction and line spacing",()=>{
 const s=input(['# 一\n\n本文。\n\n# 二\n\n本文。']);
 const c=compileVfmManuscript(s);paths(c);assert.equal((c.html.match(/class="ogenkou-toc-page"/g)??[]).length,2);assert(c.css.includes('text-combine-upright: all'));
 const horizontal=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,tocWritingMode:'horizontal',tocLineHeight:2.5}}});assert(horizontal.css.includes('writing-mode: horizontal-tb; line-height: 2.5'));assert(horizontal.css.includes('text-combine-upright: none'));
});

test("voiced kana use native shaping and uncommon kana marks use real inherited glyphs",()=>{
 const text="あ゛ かﾞ は゜ あ\u3099 か\u3099 は\u309a",s=input([text]),c=compileVfmManuscript(s);paths(c);
 assert.equal((c.html.match(/class="kana-mark"/g)??[]).length,2);assert(c.html.includes("か\u3099 は\u309a"));
 let offset=0;for(const m of c.mappings){for(let i=0;i<m.text.length;i++){
  const p=resolveGeneratedPosition(c,m.key,i)!;assert.equal(p.start,offset+i);if(p.approximate)assert.equal(p.end,p.start+1);
 }offset+=m.text.length;}assert.equal(offset,text.length);
 assert(c.css.includes('content: "゛"'));assert(!c.css.includes('Times New Roman'));
 const off=compileVfmManuscript({...s,settings:{...s.settings,processing:{...s.settings.processing,kanaMarks:false}}});assert(off.html.includes(text));paths(off);
});
