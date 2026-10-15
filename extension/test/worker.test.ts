import { test } from "node:test";
import assert from "node:assert/strict";
import { CompilerService } from "../src/compiler/compiler-service.js";
import type { WorkSnapshot } from "../src/services/snapshot-builder.js";
import { BUILTIN_PUBLICATION } from "../src/config/publication-editor.js";
import { compileVfmManuscript } from "../src/compiler/vfm-manuscript.js";
function input(revision: number, size = 2000): WorkSnapshot {
  const text = "本文漢字《よみ》\n".repeat(Math.ceil(size / 10)).slice(0, size);
  return { work: "file:///work/", epoch: 1, revision, fingerprint: String(revision), content: text, boundaries: [],
    sources: [{ uri: "file:///work/01.novel", text, virtualStart: 0, virtualEnd: text.length, dirty: true }],
    configText: "{}", config: { theme: [], quickPreview: true, overrides: {} }, rawSettings: BUILTIN_PUBLICATION,
    settings: BUILTIN_PUBLICATION, resources: [], resourceManifestComplete: false };
}
test("worker finishes running input and consumes only latest pending input", async () => {
  const service = new CompilerService();
  try {
    const first = service.compile(input(1)), skipped = service.compile(input(2));
    const rejected = assert.rejects(skipped, /superseded/u);
    const latest = service.compile(input(3));
    const result = await first; assert.equal(result.revision, 1);
    assert.deepEqual(result, compileVfmManuscript(input(1))); assert(Object.isFrozen(result.mappings[0]!.runs));
    await rejected; assert.equal((await latest).revision, 3);
  } finally { await service.close(); }
});
test("running cancellation stops worker and queued input still completes", async () => {
  const service = new CompilerService(); const controller = new AbortController();
  try {
    const pending = service.compile(input(1, 160000), controller.signal), latest = service.compile(input(2));
    const rejected = assert.rejects(pending, /cancelled/u); controller.abort(); await rejected;
    assert.equal((await latest).revision, 2);
  } finally { await service.close(); }
});
test("timeout, post failure, and closure settle jobs without a permanent wait", async () => {
  const timed = new CompilerService(1); await assert.rejects(timed.compile(input(1)), /timeout/u); await timed.close();
  const service = new CompilerService();
  const bad = { ...input(1), unsupported: () => {} };
  await assert.rejects(service.compile(bad));
  assert.equal((await service.compile(input(2))).revision, 2);
  const running = service.compile(input(3)), queued = service.compile(input(4));
  const waits = [assert.rejects(running, /closed/u), assert.rejects(queued, /closed/u)];
  await service.close(); await Promise.all(waits); await assert.rejects(service.compile(input(5)), /closed/u);
});
