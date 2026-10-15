import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { SnapshotBuilder } from "../src/services/snapshot-builder.js";
import { NodeSnapshotHost } from "../src/services/node-snapshot-host.js";

const output = [];
for (const size of [40000, 80000, 160000, 320000]) {
  const directory = await mkdtemp(join(tmpdir(), "ogenkou-snapshot-bench-"));
  try {
    const root = pathToFileURL(directory + "/").href;
    await writeFile(join(directory, "ogenkou.jsonc"), '{"settingsVersion":1}');
    const text = "日本語原稿😀\n".repeat(Math.ceil(size / 8)).slice(0, size);
    await writeFile(join(directory, "01.novel"), text);
    const builder = new SnapshotBuilder(new NodeSnapshotHost()); builder.activate(new URL("01.novel", root).href);
    const times = [];
    for (let i = 0; i < 9; i++) {
      const start = performance.now(), snapshot = await builder.build();
      const time = performance.now() - start;
      if (snapshot.sources[0]?.text !== text || snapshot.revision !== 1) throw new Error("Benchmark snapshot mismatch");
      if (i > 0) times.push(time);
    }
    times.sort((a, b) => a - b);
    output.push({ utf16Units: size, samples: times.length, medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const report = JSON.stringify({ scope: "Local disk snapshot capture, coherence re-read, settings decode and hash; excludes HTML/Core/UI",
  node: process.version, platform: process.platform, results: output }, null, 2);
if (process.argv[2]) {
  await (await import("node:fs/promises")).mkdir(dirname(process.argv[2]), { recursive: true });
  await writeFile(process.argv[2], report + "\n");
}
console.log(report);
