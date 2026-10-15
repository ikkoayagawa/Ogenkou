import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SnapshotBuilder, naturalCompare, sourceAt, type OpenText, type SnapshotHost } from "../src/services/snapshot-builder.js";
import { NodeSnapshotHost } from "../src/services/node-snapshot-host.js";
import { BUILTIN_PUBLICATION } from "../src/config/publication-editor.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "ogenkou-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory + "/").href;
  const uri = (name: string) => new URL(name, root).href;
  await writeFile(join(directory, "ogenkou.jsonc"), '{"settingsVersion":1,"overrides":{"layout":{"furnitureMode":"custom"}}}');
  let buffers: OpenText[] = [], generation = 0;
  const host = new NodeSnapshotHost(() => buffers, () => generation);
  const builder = new SnapshotBuilder(host, 1000); builder.activate(uri("01.novel"));
  return { directory, root, uri, host, builder, setBuffers(value: OpenText[]) { buffers = value; generation++; } };
}
test("natural order is stable at equal numeric values and above safe integer range", () => {
  assert.deepEqual(["10.novel", "2.novel", "02.novel", "1.novel"].sort(naturalCompare), ["1.novel", "02.novel", "2.novel", "10.novel"]);
  assert(naturalCompare("9007199254740992.novel", "9007199254740993.novel") < 0);
});
test("buffers override disk, new unsaved files are included, subdirectories excluded; exact UTF-16 positions survive", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "02.nv"), "disk");
  await writeFile(join(f.directory, "01.novel"), "\uFEFF頭😀\r\n　\r\n");
  await mkdir(join(f.directory, "nested")); await writeFile(join(f.directory, "nested", "03.novel"), "exclude");
  f.setBuffers([{ uri: f.uri("02.nv"), text: "edited\n", dirty: true, version: 2 },
    { uri: f.uri("03.novel"), text: "new", dirty: true, version: 1 }]);
  const s = await f.builder.build(); assert.equal(s.sources.length, 3);
  assert.equal(s.sources[0]!.text, "\uFEFF頭😀\r\n　\r\n"); assert.equal(s.sources[1]!.text, "edited\n");
  for (const part of s.sources) assert.equal(s.content.slice(part.virtualStart, part.virtualEnd), part.text);
  assert.deepEqual(sourceAt(s, s.sources[1]!.virtualStart + 2), { uri: f.uri("02.nv"), offset: 2 });
  assert.equal(sourceAt(s, s.boundaries[0]!.start), undefined);
  assert(Object.isFrozen(s.sources[0])); assert(Object.isFrozen(s.rawSettings.layout.fontFamily));
});
test("same-content save does not increment revision; changed buffer/config/CSS/assets do", async t => {
  const f = await fixture(t); await writeFile(join(f.directory, "01.novel"), "original");
  f.setBuffers([{ uri: f.uri("01.novel"), text: "changed", dirty: true, version: 2 }]);
  const first = await f.builder.build(); await writeFile(join(f.directory, "01.novel"), "changed"); f.setBuffers([]);
  const saved = await f.builder.build(); assert.equal(saved.revision, first.revision); assert.equal(saved.sources[0]!.dirty, false);
  await writeFile(join(f.directory, "ogenkou.jsonc"), '{"title":"new","style":"custom.css","settingsVersion":1}');
  await writeFile(join(f.directory, "custom.css"), "p { color:red }"); await writeFile(join(f.directory, "image.png"), new Uint8Array([1, 2, 3]));
  f.setBuffers([{ uri: f.uri("custom.css"), text: "p { color:blue }", dirty: true, version: 1 }]);
  const next = await f.builder.build({ assetUris: [f.uri("image.png")] });
  assert(next.revision > saved.revision); assert.equal(next.config.title, "new");
  assert.equal(Buffer.from(next.resources.find(r => r.kind === "css")!.base64, "base64").toString(), "p { color:blue }");
  await writeFile(join(f.directory, "image.png"), new Uint8Array([4]));
  const resourceChange = await f.builder.build({ assetUris: [f.uri("image.png")] });
  assert(resourceChange.revision > next.revision); assert.equal(resourceChange.resourceManifestComplete, false);
});
test("generation changes cause retry, never mixed source/config generations", async t => {
  const f = await fixture(t); await writeFile(join(f.directory, "01.novel"), "disk");
  const stable = f.host.unchanged.bind(f.host); let injected = false;
  f.host.unchanged = async (reads, signal) => {
    if (!injected) { injected = true; f.setBuffers([{ uri: f.uri("01.novel"), text: "latest", dirty: true, version: 3 }]); }
    return stable(reads, signal);
  };
  const snapshot = await f.builder.build(); assert.equal(snapshot.sources[0]!.text, "latest");
});
test("work switch rejects in-flight snapshot and revisions restart in a new epoch", async t => {
  const f = await fixture(t); await writeFile(join(f.directory, "01.novel"), "text");
  const first = await f.builder.build(); const list = f.host.list.bind(f.host);
  f.host.list = async (root, signal) => { const rows = await list(root, signal); f.builder.activate(f.uri("01.novel")); return rows; };
  await assert.rejects(f.builder.build(), /superseded/u);
  f.host.list = list; const next = await f.builder.build(); assert(next.epoch > first.epoch); assert.equal(next.revision, 1);
  f.builder.close(); await assert.rejects(f.builder.build());
});
test("horizontal effective options are off while raw settings stay intact", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "ogenkou.jsonc"), '{"settingsVersion":1,"overrides":{"writingMode":"horizontal","processing":{"automaticTcy":true}}}');
  const s = await f.builder.build(); assert.equal(s.settings.processing.automaticTcy, false); assert.equal(s.rawSettings.processing.automaticTcy, true);
});
test("version-1 uses fixed built-ins, legacy uses session-frozen defaults", async t => {
  const f = await fixture(t); const defaults = structuredClone(BUILTIN_PUBLICATION);
  const changed = { ...defaults, layout: { ...defaults.layout, fontSize: "12pt" } };
  f.builder.activate(f.uri("01.novel"), changed);
  assert.equal((await f.builder.build()).rawSettings.layout.fontSize, "9pt");
  await writeFile(join(f.directory, "ogenkou.jsonc"), "{}");
  assert.equal((await f.builder.build()).rawSettings.layout.fontSize, "12pt");
});
test("cancel, perpetual changes and missing config cannot leave a pending request", async t => {
  const f = await fixture(t); const cancel = new AbortController(); cancel.abort(new Error("cancel"));
  await assert.rejects(f.builder.build({ signal: cancel.signal }), /cancel/u);
  f.host.unchanged = async () => false;
  await assert.rejects(f.builder.build(), /再試行/u);
  await rm(join(f.directory, "ogenkou.jsonc")); await assert.rejects(f.builder.build(), /設定がありません/u);
});
test("Windows case variants identify one manuscript and prefer its unsaved buffer", async () => {
  const root = "file:///C:/Work/", source = root + "01.novel", config = root + "ogenkou.jsonc";
  const host: SnapshotHost = {
    generation: () => 0,
    openTexts: () => [{ uri: "file:///c:/work/01.NOVEL", text: "unsaved", dirty: true, version: 2 }],
    list: async () => [{ uri: source, directory: false }, { uri: config, directory: false }],
    read: async uri => ({ uri, bytes: Buffer.from(uri === config ? '{"settingsVersion":1}' : "disk"), stamp: "1" }),
    unchanged: async () => true,
  };
  const builder = new SnapshotBuilder(host); builder.activate(source);
  const result = await builder.build(); assert.equal(result.sources.length, 1); assert.equal(result.sources[0]!.text, "unsaved");
});
