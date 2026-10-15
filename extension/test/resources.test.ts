import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SnapshotBuilder, type OpenText } from "../src/services/snapshot-builder.js";
import { NodeSnapshotHost } from "../src/services/node-snapshot-host.js";
import { RenderInputBuilder } from "../src/services/render-input-builder.js";
import { CompilerService } from "../src/compiler/compiler-service.js";
import { compileVfmManuscript } from "../src/compiler/vfm-manuscript.js";
import { collectResources, findResource, resourceIdentity } from "../src/services/resource-collector.js";
import { cssReferences, absoluteCss, srcsetReferences } from "../src/services/resource-references.js";
import { createCoreMemoryInput } from "../src/services/core-memory-input.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "ogenkou-resources-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = pathToFileURL(dir + "/").href, uri = (name: string) => new URL(name, root).href;
  await mkdir(join(dir, "styles")); await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "ogenkou.jsonc"), '{"settingsVersion":1,"style":"styles/main.css"}');
  await writeFile(join(dir, "01.novel"), "# 本文\n\n![画像](assets/a.svg#shape)\n");
  await writeFile(join(dir, "styles/main.css"), '@import "nested.css" layer(test) print; p { background:url(../assets/p.png?v=1) }');
  await writeFile(join(dir, "styles/nested.css"), '@import url(main.css); @font-face { font-family:Sample; src:url(../assets/f.woff2) }');
  await writeFile(join(dir, "assets/a.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><image href="p.png"/><path id="shape" fill="url(#gradient)"/></svg>');
  await writeFile(join(dir, "assets/p.png"), new Uint8Array([1, 2, 3]));
  await writeFile(join(dir, "assets/f.woff2"), new Uint8Array([4, 5]));
  let buffers: OpenText[] = [], gen = 0;
  const host = new NodeSnapshotHost(() => buffers, () => gen);
  const snapshots = new SnapshotBuilder(host); snapshots.activate(uri("01.novel"));
  const compiler = { compile: async (s: Parameters<typeof compileVfmManuscript>[0]) => compileVfmManuscript(s) };
  return { dir, root, uri, host, snapshots, builder: new RenderInputBuilder(snapshots, compiler),
    buffers(value: OpenText[]) { buffers = value; gen++; } };
}

test("CSS scanner ignores comments/literal strings and resolves imports, escaped url names and image-set", () => {
  const css = '@namespace url("http://www.w3.org/1999/xhtml"); /* url(fake) */ p{content:"url(fake)";background:u\\72l("../a b.png")} @import "nested.css" screen; x{background:image-set("a.png" 1x,url(b.png) 2x)}';
  assert.deepEqual(cssReferences(css).map(r => [r.value, r.kind]), [["../a b.png", "asset"], ["nested.css", "css"], ["a.png", "asset"], ["b.png", "asset"]]);
  const resolved = absoluteCss(css, "file:///work/css/main.css");
  assert(resolved.includes("file:///work/a%20b.png")); assert(resolved.includes(" screen;"));
  assert(resolved.includes('content:"url(fake)"'));
  assert.deepEqual(srcsetReferences("data:image/png;base64,AAAA 1x, ../two.png 2x, three.png, "), [
    { url: "data:image/png;base64,AAAA", descriptor: "1x" }, { url: "../two.png", descriptor: "2x" }, { url: "three.png", descriptor: "" }]);
});

test("real Worker collects recursive CSS/font/SVG/image dependencies with cycles and one stamped revision", async t => {
  const f = await fixture(t), compiler = new CompilerService(); t.after(() => compiler.close());
  const result = await new RenderInputBuilder(f.snapshots, compiler).build();
  assert.equal(result.snapshot.resourceManifestComplete, true);
  assert.equal(result.document.revision, result.snapshot.revision);
  assert.equal(result.snapshot.resources.length, 5);
  assert.equal(result.snapshot.resourceManifest!.issues.length, 0);
  assert(Object.isFrozen(result.snapshot.resources[0]));
  assert.equal(findResource(result.snapshot, f.uri("assets/a.svg#shape"))!.mediaType, "image/svg+xml");
  assert(findResource(result.snapshot, f.uri("styles/main.css"))!.resolvedCss!.includes(f.uri("styles/nested.css")));
  assert.equal(Buffer.from(findResource(result.snapshot, f.uri("assets/p.png?v=9"))!.base64, "base64")[0], 1);
  const memory = createCoreMemoryInput(result);
  assert(memory.source.resources.some(r => r.url.endsWith("p.png?v=1")));
  const css = memory.source.resources.find(r => r.url.endsWith("nested.css"))!.content;
  assert.equal(typeof css, "string"); assert((css as string).includes("data:text/css,"));
  const svg = memory.source.resources.find(r => r.url.endsWith("a.svg"))!.content;
  assert.equal(typeof svg, "string"); assert((svg as string).includes("data:image/png;base64,AQID"));
  assert(memory.source.html.includes('<link rel="stylesheet"'));
});

test("body edits during conversion preserve the captured version and the next build catches up", async t => {
  const f = await fixture(t);
  f.buffers([{ uri: f.uri("01.novel"), text: "old body", dirty: true, version: 2 }]);
  let calls = 0;
  const builder = new RenderInputBuilder(f.snapshots, { compile: async s => {
    calls++;
    f.buffers([{ uri: f.uri("01.novel"), text: "new body", dirty: true, version: 3 }]);
    return compileVfmManuscript(s);
  } });
  const old = await builder.build();
  assert.equal(calls, 1);
  assert.equal(old.snapshot.sources[0]!.editorVersion, 2);
  assert.equal(old.snapshot.content, "old body");
  assert(old.document.html.includes("old body"));
  const next = await f.builder.build();
  assert.equal(next.snapshot.sources[0]!.editorVersion, 3);
  assert(next.snapshot.revision > old.snapshot.revision);
  assert(next.document.html.includes("new body"));
});

test("configuration and newly opened CSS edits during conversion still invalidate the attempt", async t => {
  const f = await fixture(t); let calls = 0;
  const builder = new RenderInputBuilder(f.snapshots, { compile: async s => {
    calls++;
    if (calls === 1) f.buffers([
      { uri: f.uri("ogenkou.jsonc"), text: '{"settingsVersion":1,"title":"new","style":"styles/main.css"}', dirty: true, version: 2 },
      { uri: f.uri("styles/main.css"), text: 'p { color: blue }', dirty: true, version: 2 },
    ]);
    return compileVfmManuscript(s);
  } });
  const input = await builder.build();
  assert.equal(calls, 2);
  assert.equal(input.snapshot.config.title, "new");
  assert.equal(Buffer.from(findResource(input.snapshot, f.uri("styles/main.css"))!.base64, "base64").toString(), 'p { color: blue }');
});

test("disk body edits after capture are allowed, but work switch during conversion rejects", async t => {
  const f = await fixture(t);
  const builder = new RenderInputBuilder(f.snapshots, { compile: async s => {
    await writeFile(join(f.dir, "01.novel"), "new disk body");
    return compileVfmManuscript(s);
  } });
  const input = await builder.build();
  assert(input.snapshot.content.includes("本文"));
  assert.equal((await f.builder.build()).snapshot.content, "new disk body");
  const switching = new RenderInputBuilder(f.snapshots, { compile: async s => {
    f.snapshots.activate(f.uri("01.novel")); return compileVfmManuscript(s);
  } });
  await assert.rejects(switching.build(), /superseded/u);
});

test("resource bytes changed after collection retry conversion, including newly opened CSS", async t => {
  const f = await fixture(t), unchanged = f.host.unchanged.bind(f.host);
  let checks = 0, calls = 0;
  f.host.unchanged = async (reads, signal) => {
    if (++checks === 2) {
      await writeFile(join(f.dir, "assets/p.png"), new Uint8Array([9]));
      f.buffers([{ uri: f.uri("styles/main.css"), text: "p { color: green }", dirty: true, version: 2 }]);
    }
    return unchanged(reads, signal);
  };
  const input = await new RenderInputBuilder(f.snapshots, { compile: async s => {
    calls++; return compileVfmManuscript(s);
  } }).build();
  assert.equal(calls, 2);
  assert.equal(Buffer.from(findResource(input.snapshot, f.uri("assets/p.png"))!.base64, "base64")[0], 9);
  assert.equal(Buffer.from(findResource(input.snapshot, f.uri("styles/main.css"))!.base64, "base64").toString(), "p { color: green }");
});

test("cancelling a captured conversion settles it and permits a later build", async t => {
  const f = await fixture(t), abort = new AbortController();
  const builder = new RenderInputBuilder(f.snapshots, { compile: async s => {
    abort.abort(new Error("cancel captured body")); return compileVfmManuscript(s);
  } });
  await assert.rejects(builder.build({ signal: abort.signal }), /cancel captured body/u);
  assert((await f.builder.build()).snapshot.resourceManifestComplete);
});

test("context watcher guards changes during the final negative-resource check", async t => {
  const f = await fixture(t); let context = 0, misses = 0, calls = 0;
  Object.assign(f.host, { contextGeneration: () => context });
  await writeFile(join(f.dir, "01.novel"), "![missing](assets/missing.png)");
  const read = f.host.read.bind(f.host);
  f.host.read = async (uri, signal) => {
    if (uri.endsWith("missing.png") && ++misses === 2) {
      context++;
      f.buffers([{ uri: f.uri("ogenkou.jsonc"), text: '{"settingsVersion":1,"title":"changed during validation"}', dirty: true, version: 2 }]);
    }
    return read(uri, signal);
  };
  const input = await new RenderInputBuilder(f.snapshots, { compile: async s => { calls++; return compileVfmManuscript(s); } }).build();
  assert.equal(calls, 2); assert.equal(input.snapshot.config.title, "changed during validation");
});

test("unsaved imported CSS wins, resource edits increment revision, same-content saves do not mutate old bytes", async t => {
  const f = await fixture(t), css = 'p { color:blue }';
  f.buffers([{ uri: f.uri("styles/nested.css"), text: css, dirty: true, version: 2 }]);
  const first = await f.builder.build();
  assert.equal(Buffer.from(findResource(first.snapshot, f.uri("styles/nested.css"))!.base64, "base64").toString(), css);
  await writeFile(join(f.dir, "styles/nested.css"), css); f.buffers([]);
  const saved = await f.builder.build(); assert.equal(saved.snapshot.revision, first.snapshot.revision);
  await writeFile(join(f.dir, "assets/p.png"), new Uint8Array([9]));
  const changed = await f.builder.build(); assert(changed.snapshot.revision > saved.snapshot.revision);
  assert.equal(Buffer.from(findResource(first.snapshot, f.uri("assets/p.png"))!.base64, "base64")[0], 1);
});

test("missing resources and external URLs produce incomplete manifests; later creation changes revision", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "01.novel"), '![欠落](assets/missing.png)\n\n![外部](https://example.invalid/a.png)');
  const first = await f.builder.build(); assert.equal(first.snapshot.resourceManifestComplete, false);
  assert.throws(() => createCoreMemoryInput(first), /資源が揃っていません/u);
  assert.deepEqual(first.snapshot.resourceManifest!.issues.map(i => i.code).sort(), ["external", "missing"]);
  await writeFile(join(f.dir, "assets/missing.png"), new Uint8Array([8]));
  const next = await f.builder.build(); assert(next.snapshot.revision > first.snapshot.revision);
  assert.deepEqual(next.snapshot.resourceManifest!.issues.map(i => i.code), ["external"]);
});

test("asset mutation during collection retries the entire transaction, including negative reads", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "01.novel"), '![画像](assets/missing.png)');
  const unchanged = f.host.unchanged.bind(f.host); let injected = false;
  f.host.unchanged = async (reads, signal) => {
    if (!injected) { injected = true; await writeFile(join(f.dir, "assets/missing.png"), new Uint8Array([7])); }
    return unchanged(reads, signal);
  };
  const result = await f.builder.build(); assert.equal(result.snapshot.revision, 1);
  assert.equal(result.snapshot.resourceManifestComplete, true);
  assert(findResource(result.snapshot, f.uri("assets/missing.png")));
});

test("HTML srcset, inline CSS and nested SVG keep the originating manuscript base without changing text map", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "01.novel"), '<img srcset="assets/p.png 1x, assets/p.png?v=2 2x">\n\n<span style="background:url(assets/p.png)">本文</span>');
  const result = await f.builder.build(); assert.equal(result.snapshot.resourceManifestComplete, true);
  assert(result.document.html.includes(f.uri("assets/p.png")));
  const body = result.document.mappings.find(m => m.text === "本文")!;
  assert(body); assert(result.document.sourceMap.some(m => m.key === body.key));
  assert(result.snapshot.resourceManifest!.dependencies.some(d => d.uri.endsWith("p.png?v=2")));
});

test("cancel, work switch, unsupported active documents and resource limits settle requests", async t => {
  const f = await fixture(t), abort = new AbortController(); abort.abort(new Error("stop"));
  await assert.rejects(f.builder.build({ signal: abort.signal }), /stop/u);
  const read = f.host.read.bind(f.host); let switchWork = true;
  f.host.read = async (uri, signal) => { const value = await read(uri, signal); if (switchWork && uri.endsWith("p.png")) { switchWork = false; f.snapshots.activate(f.uri("01.novel")); } return value; };
  await assert.rejects(f.builder.build(), /superseded/u);
  f.host.read = read;
  await writeFile(join(f.dir, "01.novel"), '<iframe src="https://example.invalid/"></iframe>\n<link rel="stylesheet" href="data:text/css,p%7Bcolor:red%7D">');
  const result = await f.builder.build(); assert.equal(result.snapshot.resourceManifestComplete, false);
  assert(result.snapshot.resourceManifest!.issues.some(i => i.code === "unsupported"));
  assert(result.snapshot.resourceManifest!.issues.some(i => i.uri === "data:text/css"));
  await assert.rejects(collectResources(result.snapshot, result.document, async uri => (await read(uri, new AbortController().signal)).bytes,
    new AbortController().signal, { files: 1, bytes: 100 }), /上限/u);
});

test("in-flight cancellation and resource timeout recover; unexpected read failures are not hidden as missing", async t => {
  const f = await fixture(t), read = f.host.read.bind(f.host), abort = new AbortController();
  let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  f.host.read = async (uri, signal) => {
    if (!uri.endsWith("main.css")) return read(uri, signal);
    entered(); return new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  };
  const pending = f.builder.build({ signal: abort.signal }); await ready; abort.abort(new Error("cancel resource"));
  await assert.rejects(pending, /cancel resource/u);
  const limited = new SnapshotBuilder(f.host, 30); limited.activate(f.uri("01.novel"));
  await assert.rejects(new RenderInputBuilder(limited, { compile: async s => compileVfmManuscript(s) }).build(), /timeout/u);
  f.host.read = async (uri, signal) => { if (uri.endsWith("main.css")) throw Object.assign(new Error("denied"), { code: "EACCES" }); return read(uri, signal); };
  await assert.rejects(f.builder.build(), /denied/u);
  f.host.read = read; assert.equal((await f.builder.build()).snapshot.resourceManifestComplete, true);
});

test("Windows aliases normalize query/fragments; two manuscripts resolve local images without fetching ordinary links", async t => {
  assert.equal(resourceIdentity("file:///C:/Work/A.png?v=1#part"), resourceIdentity("file:///c:/work/a.png"));
  assert.equal(resourceIdentity("file:///work/font(1).woff2"), resourceIdentity("file:///work/font%281%29.woff2"));
  const f = await fixture(t);
  await writeFile(join(f.dir, "02.nv"), '![画像](assets/p.png)\n\n[通常リンク](not-a-resource.html)\n\n`![無効](missing.png)`');
  const result = await f.builder.build(); assert.equal(result.snapshot.resourceManifestComplete, true);
  assert(result.snapshot.resourceManifest!.dependencies.some(d => d.referrer === f.uri("02.nv") && d.uri === f.uri("assets/p.png")));
  assert(!result.snapshot.resourceManifest!.dependencies.some(d => /not-a-resource|missing/u.test(d.uri)));
});
