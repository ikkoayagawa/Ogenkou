import {test} from "node:test";
import assert from "node:assert/strict";
import {cleanManuscriptText,mergeCleanManuscripts} from "../src/services/clean-text.js";

test("clean text keeps parent characters for all supported ruby forms, including empty readings",()=>{
 assert.equal(cleanManuscriptText('｜親文字《よみ》 |かな《カナ》 漢字《かんじ》 [[rb:基>き]] {熟語|じゅくご} <ruby><rb>字</rb><rp>（</rp><rt>じ</rt><rp>）</rp></ruby>'),'親文字 かな 漢字 基 熟語 字');
 assert.equal(cleanManuscriptText('｜未入力《》 [[rb:未入力>]] {未入力|}'),'未入力 未入力 未入力');
});

test("clean text removes all emphasis wrappers and custom marks without removing the body",()=>{
 assert.equal(cleanManuscriptText('《《大切》》 [[emphasismark:本文]] [[emphasismark:丸>○]] [[emphasismark:ゴマ>﹅]] [[emphasismark:空>]]'),'大切 本文 丸 ゴマ 空');
 assert.equal(cleanManuscriptText('［＃傍点］親文字［＃傍点終わり］ 胡麻塩おやじ［＃「おやじ」に傍点］ <em>強調</em>'),'親文字 胡麻塩おやじ 強調');
});

test("clean export removes metadata, Markdown, HTML and pixiv controls but keeps readable labels",()=>{
 const source='---\ntitle: 非本文\n---\n# 第一章\n\n**強調** [リンク](https://example.com/) ![図の説明](image.png)\n\n[chapter:第二章]\n[newpage]\n[b:太字] [i:斜体] [[jumpuri:表示名>https://example.com/]]\n[jump:2] [pixivimage:123]';
 const text=cleanManuscriptText(source);assert(text.startsWith('第一章\n\n強調 リンク 図の説明'));assert(text.includes('第二章'));assert(text.includes('太字 斜体 表示名'));
 assert(!/非本文|https:|image.png|\[chapter:|\[newpage\]|\[jump:|pixivimage:|\*\*/u.test(text));
 assert.equal(cleanManuscriptText('<p>本文 &amp; 続き</p><script>hidden</script><style>body{}</style>'),'本文 & 続き');
});

test("clean export preserves manuscript newlines, blank lines, indents and source glyphs",()=>{
 const source='  第一行。\r\n　第二行。\r\n\r\n\r\n“――１２あ゛”😀。\r\n';
 assert.equal(cleanManuscriptText(source),'  第一行。\n　第二行。\n\n\n“――１２あ゛”😀。');
 assert.equal(cleanManuscriptText('\n\n先頭'),'\n\n先頭');
});

test("folder text merges manuscripts in natural order with a safe file boundary",()=>{
 assert.equal(mergeCleanManuscripts([{name:'10.novel',text:'十。'},{name:'2.novel',text:'[[rb:二>に]]。'},{name:'1.nv',text:'《《一》》。'}]),'一。\n\n二。\n\n十。\n');
});
