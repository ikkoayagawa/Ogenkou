import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createPublicationCss} from '../dist/src/compiler/publication-css.js';
import {applyVerticalTypographyToText} from '../dist/src/compiler/legacy-japanese.js';
import {BUILTIN_PUBLICATION} from '../dist/src/config/publication-editor.js';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(root,'experiments/preview-benchmark/package.json')),{chromium}=require('playwright');
const output=path.join(root,'.recovery/kana-marks',String(Date.now()));await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 const sample='あ゛ い゛ う゛ え゛ お゛ か゛ は゜ カﾞ ハﾟ',render=n=>n.type==='text'?n.value:`<${n.tagName} class="${(n.properties.className??[]).join(' ')}">${n.children.map(render).join('')}</${n.tagName}>`,native=applyVerticalTypographyToText(sample,BUILTIN_PUBLICATION.processing).map(render).join('');
 const old=sample.replace(/([ぁ-ゖァ-ヺ])([\u3099-\u309c\uff9e\uff9f])/gu,(_,base,mark)=>`<span class="old ${/[\u309a\u309c\uff9f]/u.test(mark)?'semi':''}">${base}</span>`);
 await page.setContent(`<style>${createPublicationCss({settings:BUILTIN_PUBLICATION})}html,body{writing-mode:horizontal-tb}body{background:#eee;color:#111;font-family:"Yu Mincho",serif}.row{display:flex;gap:60px;background:white;margin:20px;padding:20px}.text{writing-mode:vertical-rl;font-size:24pt;line-height:1.8;height:510px}.old{display:inline-block;position:relative;width:1em;height:1em;line-height:1;white-space:nowrap}.old::after{content:"\u201d";position:absolute;writing-mode:horizontal-tb;font-family:"Times New Roman",serif;font-size:.65em;line-height:1;inset-block-start:-.08em;inset-inline-end:-.2em}.old.semi::after{content:"\u00b0"}</style><div class="row"><div>従来：引用符の重ね描き<div class="text">${old}</div></div><div>修正：濁点字形＋標準字形<div class="text" id="native">${native}</div></div><div>入力：結合濁点そのまま<div class="text">あ゙ い゙ ゔ え゙ お゙ が ぱ ガ パ</div></div></div>`);
 await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('#native .kana-mark').count(),4);await page.screenshot({path:path.join(output,'comparison.png')});console.log(output);
}finally{await browser.close();}
