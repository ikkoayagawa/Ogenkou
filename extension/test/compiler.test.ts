import { test } from "node:test";
import assert from "node:assert/strict";
import { compileManuscript, resolveGeneratedPosition } from "../src/compiler/manuscript.js";
import { BUILTIN_PUBLICATION } from "../src/config/publication-editor.js";
import type { WorkSnapshot } from "../src/services/snapshot-builder.js";

export function fixture(parts: string[], horizontal = false): WorkSnapshot {
  const settings = structuredClone(BUILTIN_PUBLICATION);
  return { work: "file:///work/", epoch: 1, revision: 7, fingerprint: "fixture", content: parts.join("\n\n"), boundaries: [],
    sources: parts.map((text, i) => ({ uri: `file:///work/${i + 1}.novel`, text, virtualStart: 0, virtualEnd: text.length, dirty: true })),
    configText: "{}", config: { theme: [], quickPreview: true, overrides: {} }, rawSettings: settings,
    settings: horizontal ? { ...settings, writingMode: "horizontal", processing: { ...settings.processing, automaticTcy: false, verticalQuotes: false, kanaMarks: false } } : settings,
    resources: [], resourceManifestComplete: false };
}
test("three ruby forms map bases and readings to exact original UTF-16 ranges", () => {
  const original = "😀｜親文字《よみ》 漢字《かんじ》 [[rb:rb>るび]]";
  const c = compileManuscript(fixture([original])); assert.equal(c.sourceMap.filter(e => e.kind === "ruby-base").length, 3);
  for (const map of c.mappings.filter(e => e.kind === "ruby-base" || e.kind === "ruby-reading")) {
    const position = resolveGeneratedPosition(c, map.key, 0)!;
    assert.equal(original.slice(position.start, position.start + map.text.length), map.text);
  }
});
test("emphasis wins over ruby; code and raw HTML are safe literal text", () => {
  const c = compileManuscript(fixture(['漢字《《傍点》》 [[emphasismark:本文]] `｜無変換《よみ》12` <script>alert(1)</script>']));
  assert.equal(c.sourceMap.filter(e => e.kind === "ruby-base").length, 0);
  assert(c.html.includes('class="ogenkou-emphasis"')); assert(c.html.includes('&lt;script&gt;'));
  assert(c.html.includes('<code>｜無変換《よみ》12</code>')); assert(!c.html.includes('<script>'));
});
test("disabled pipe ruby cannot fall through to bare-kanji conversion", () => {
  const s = fixture(["｜漢字《かんじ》"]);
  const c = compileManuscript({ ...s, settings: { ...s.settings, processing: { ...s.settings.processing, ruby: { ...s.settings.processing.ruby, pipeAngle: false } } } });
  assert.equal(c.sourceMap.filter(e => e.kind === "ruby-base").length, 0); assert(c.html.includes("｜漢字《かんじ》"));
});
test("unclosed fences end at file boundary and CRLF mapping covers both source units", () => {
  const c = compileManuscript(fixture(["```\r\n漢字《よみ》\r\n", "# 次章\n本文"]));
  assert.equal(c.diagnostics.length, 1); assert.equal(c.headings.length, 1); assert(c.html.includes('<code>漢字《よみ》\n</code>'));
  const code = c.mappings.find(m => m.text.endsWith("\n"))!;
  const position = resolveGeneratedPosition(c, code.key, code.text.length - 1)!;
  assert.equal(position.end - position.start, 2); assert(position.approximate);
});
test("composition, vertical quotes and tcy retain raw settings and source correspondence", () => {
  const original = 'か\u3099 “引用” 12 123'; const s = fixture([original]); const c = compileManuscript(s);
  const composed = c.mappings.find(m => m.text.includes("が"))!;
  const p = resolveGeneratedPosition(c, composed.key, composed.text.indexOf("が"))!;
  assert.equal(original.slice(p.start, p.end), 'か\u3099'); assert(p.approximate);
  assert(c.html.includes("〝引用〟")); assert.equal((c.html.match(/class="ogenkou-tcy"/gu) ?? []).length, 1);
  const h = compileManuscript(fixture([original], true)); assert(h.html.includes("か\u3099 “引用” 12 123"));
});
test("soft lines coalesce TextNodes with disjoint original ranges; source blanks and indentation preserved", () => {
  const s = fixture(["　前\r\n後\n\n終"]);
  const c = compileManuscript({ ...s, settings: { ...s.settings, processing: { ...s.settings.processing, hardLineBreaks: false } } });
  const m = c.mappings.find(m => m.text === "　前後")!;
  assert(m); assert.equal(resolveGeneratedPosition(c, m.key, 2)!.start, 4);
  assert(c.html.includes('class="source-blank-line"'));
});
test("TOC titles and running heads use visible parent text; links and image bases remain file-local", () => {
  const c = compileManuscript(fixture(["[[toc]]\n# ｜章題《しょうだい》\n![画像](images/a.png) [外部](https://example.com/) [危険](javascript:alert)"]));
  assert.equal(c.headings[0]!.title, "章題"); assert(c.html.includes('data-running-head="章題"'));
  assert(c.css.includes("target-counter(attr(data-target), page)")); assert.equal(c.resourceRequests[0]!.uri, "file:///work/images/a.png");
  assert.equal(c.diagnostics.length, 1); assert(!c.html.includes('href="javascript:'));
  const toc = c.mappings.find(m => m.kind === "generated")!;
  assert(resolveGeneratedPosition(c, toc.key, 0)!.approximate);
});
test("escaping does not alter correspondence and long paragraphs keep a compact map", () => {
  const c = compileManuscript(fixture(["漢".repeat(40000) + "<&😀"]));
  assert.equal(c.mappings.length, 1); assert.equal(c.mappings[0]!.runs.length, 1);
  assert(c.html.includes("&lt;&amp;😀")); assert.equal(resolveGeneratedPosition(c, c.mappings[0]!.key, 40003)!.start, 40003);
});
