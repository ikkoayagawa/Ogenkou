import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
import { BUILTIN_PUBLICATION, editProjectPublication, publicationValues, rawProjectPublication } from "../src/config/publication-editor.js";
import { parseProjectConfig } from "../src/project/project-config.js";
import { decodePaperSize, PAPER_PRESETS } from "../src/config/paper-size.js";
import { SettingsService } from "../src/services/settings-service.js";
import type { TextRecord } from "../src/services/contracts.js";
import { EditorStore, PreferencesMemory } from "./fixtures.js";

const uri = "file:///work/ogenkou.jsonc";
test("TOC depth roundtrips through JSONC and rejects out-of-range or fractional input",()=>{
 const text=editProjectPublication('{}',{'processing.tocDepth':6});assert.equal(parseProjectConfig(text).overrides.processing?.tocDepth,6);
 for(const value of [0,7,1.5,"2",null])assert.throws(()=>parseProjectConfig(JSON.stringify({overrides:{processing:{tocDepth:value}}})),/目次/);
 assert.equal(publicationValues(rawProjectPublication(BUILTIN_PUBLICATION,'{}'))['processing.tocDepth'],3);
});
function setup(text = editProjectPublication("{}", publicationValues(BUILTIN_PUBLICATION), true), dirty = false) {
  const documents = new EditorStore(), prefs = new PreferencesMemory();
  documents.set(uri, text, dirty); const service = new SettingsService(documents, prefs, 30);
  service.activate("work", uri); return { documents, prefs, service };
}
test("example title alias, conflicts and publication fields roundtrip", async () => {
  const text = await readFile(new URL("../../../ogenkou.jsonc", import.meta.url), "utf8").catch(() =>
    readFile("../ogenkou.jsonc", "utf8"));
  assert.equal(parseProjectConfig(text).title, "ベンチマーク32万字");
  assert.throws(() => parseProjectConfig('{"title":"A","publication":{"title":"B"}}'), /異なります/u);
  const values = publicationValues(BUILTIN_PUBLICATION);
  assert.equal(Object.keys(values).length, 50);
  assert.deepEqual(publicationValues(rawProjectPublication(BUILTIN_PUBLICATION, editProjectPublication(text, values, true))), values);
});
test("dirty setting edits preserve comments, unknown fields, CRLF and dormant horizontal options", async () => {
  const { documents, service } = setup('// comment\r\n{"settingsVersion":1,"private":{"keep":42},"overrides":{"writingMode":"horizontal","layout":{"furnitureMode":"custom","private":true}}}', true);
  const view = await service.read("project");
  await service.save(view, { "layout.fontSize": "10pt", "processing.automaticTcy": true });
  const result = documents.records.get(uri)!;
  assert(result.dirty); assert.equal(documents.saved.length, 0); assert(result.text.includes('// comment\r\n'));
  const decoded = parse(result.text); assert.equal(decoded.private.keep, 42);
  assert.equal(decoded.overrides.layout.private, true); assert.equal(decoded.overrides.processing.automaticTcy, true);
});
test("conflicting document cannot be overwritten and the next read/save recovers", async () => {
  const { documents, service } = setup(); const view = await service.read("project");
  documents.set(uri, documents.records.get(uri)!.text + "\n// external change", true);
  await assert.rejects(service.save(view, { "layout.fontSize": "10pt" }), /conflict/u);
  await service.save(await service.read("project"), { "layout.fontSize": "11pt" });
  assert.equal(parseProjectConfig(documents.records.get(uri)!.text).overrides.layout?.fontSize, "11pt");
});
test("work switch, forged target, old token and close reject writes", async () => {
  const { service } = setup(); const view = await service.read("project");
  await assert.rejects(service.save({ ...view, target: "defaults" }, { "layout.fontSize": "10pt" }));
  await service.read("project"); await assert.rejects(service.save(view, { "layout.fontSize": "10pt" }));
  const current = await service.read("project"); service.activate("other", "file:///other/ogenkou.jsonc");
  await assert.rejects(service.save(current, { "layout.fontSize": "10pt" }));
  service.close(); await assert.rejects(service.read("project"));
});
test("default updates affect only new projects; initialization never overwrites", async () => {
  const { service, documents } = setup(); const before = (await service.read("project")).values;
  await service.save(await service.read("defaults"), { "layout.fontSize": "12pt" });
  const defaultsView = await service.read("defaults");
  assert.equal(defaultsView.paperLayouts["vertical:A6"]!["layout.fontSize"], "12pt");
  assert.equal(defaultsView.resetPaperLayouts["vertical:A6"]!["layout.fontSize"], "9pt");
  assert.deepEqual((await service.read("project")).values, before);
  service.activate("new", "file:///new/ogenkou.jsonc"); const created = await service.initializeNew();
  assert.equal(parseProjectConfig(created.text).overrides.layout?.fontSize, "12pt");
  await assert.rejects(service.initializeNew(), /exists/u); assert.equal(documents.records.get(created.uri)?.text, created.text);
});
test("opening legacy settings is read-only and explicit freeze preserves unknowns", async () => {
  const { service, documents } = setup('{"custom":true,"overrides":{"writingMode":"horizontal"}}', true);
  const before = documents.records.get(uri)!.text; const view = await service.read("project");
  assert(view.legacy); assert.equal(documents.records.get(uri)!.text, before);
  await assert.rejects(service.save(view, { "layout.fontSize": "10pt" }), /固定化/u);
  await assert.rejects(service.save({ ...view, legacy: false }, { "layout.fontSize": "10pt" }), /固定化/u);
  await service.freezeLegacy(view);
  assert.equal(parseProjectConfig(documents.records.get(uri)!.text).settingsVersion, 1);
  assert.equal(parse(documents.records.get(uri)!.text).custom, true); assert.equal(documents.saved.length, 0);
});
test("geometry/type failure leaves trusted base usable, and inherited font arrays are permitted", async () => {
  const { service } = setup(); const view = await service.read("project");
  await assert.rejects(service.save(view, { "layout.columnCount": 5 }));
  await assert.rejects(service.save(view, { "layout.pageMargin": "100mm" }), /版面/u);
  await service.save(view, { "layout.topFontFamily": [] });
});
test("stalled reads time out; abort and later reads recover", async () => {
  const { service, documents } = setup(); const read = documents.read.bind(documents);
  documents.read = () => new Promise(() => {});
  await assert.rejects(service.read("project"), /timeout/u);
  const cancel = new AbortController(); const pending = service.read("project", cancel.signal); cancel.abort(new Error("cancel"));
  await assert.rejects(pending, /cancel/u);
  documents.read = read; assert.equal((await service.read("project")).work, "work");
});
test("named ISO B and explicit JIS B retain distinct dimensions", () => {
  assert.deepEqual(decodePaperSize("B5", PAPER_PRESETS), { preset: "custom", width: 176, height: 250 });
  assert.deepEqual(decodePaperSize("182mm,257mm", PAPER_PRESETS), { preset: "B5", width: 182, height: 257 });
  assert.deepEqual(decodePaperSize("JIS-B5 landscape", PAPER_PRESETS), { preset: "custom", width: 257, height: 182 });
});
test("out-of-order settings reads cannot invalidate the newest token", async () => {
  const { service, documents } = setup(); const read = documents.read.bind(documents);
  let release!: (value: TextRecord) => void, captured!: TextRecord;
  documents.read = async (uri, signal) => {
    captured = await read(uri, signal);
    return new Promise<TextRecord>(resolve => { release = resolve; });
  };
  const old = service.read("project");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  documents.read = read; const latest = await service.read("project");
  release(captured); await assert.rejects(old, /superseded/u);
  await service.save(latest, { "layout.fontSize": "10pt" });
});
test("JSONC BOM and comments are retained when editing", () => {
  const text = '\uFEFF// retained\r\n{"settingsVersion":1}';
  const updated = editProjectPublication(text, { "layout.fontSize": "10pt" });
  assert(updated.startsWith('\uFEFF// retained\r\n'));
  assert.equal(parseProjectConfig(updated).overrides.layout?.fontSize, "10pt");
});


test("landscape paper edits update the same named preset", async () => {
  const {service}=setup();const view=await service.read("defaults");await service.save(view,{"layout.pageSize":"148mm,105mm","layout.fontSize":"10pt"});
  const next=await service.read("defaults");assert.equal(next.paperLayouts["vertical:A6"]!["layout.fontSize"],"10pt");
});


test("title page and blank running-head limit survive settings roundtrip",()=>{
 const text=editProjectPublication('{}',{'processing.titlePage':false,'layout.runningHeadMaxLength':''});const c=parseProjectConfig(text);assert.equal(c.overrides.processing?.titlePage,false);assert.equal(c.overrides.layout?.runningHeadMaxLength,'');
 for(const value of ['-1','0','1.5','1001','x'])assert.throws(()=>editProjectPublication('{}',{'layout.runningHeadMaxLength':value}));
});


test("GUI book metadata writes canonical publication fields, keeps comments and removes conflicting title aliases",()=>{
 const text=editProjectPublication('// note\n{"title":"old","private":true}',{'publication.title':'New; {book}','publication.author':'Author','processing.tocWritingMode':'horizontal','processing.tocLineHeight':2.5});
 const c=parseProjectConfig(text);assert.equal(c.title,'New; {book}');assert.equal(c.author,'Author');assert(text.includes('// note'));assert.equal(parse(text).private,true);assert.equal(parse(text).title,undefined);assert.equal(c.overrides.processing?.tocWritingMode,'horizontal');assert.equal(c.overrides.processing?.tocLineHeight,2.5);
 for(const value of ['0pt','12mm'])assert.throws(()=>editProjectPublication('{}',{'layout.fontSize':value}));
});
