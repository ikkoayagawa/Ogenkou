import { parentPort } from "node:worker_threads";
import { compileVfmManuscript } from "./vfm-manuscript.js";
import type { WorkSnapshot } from "../services/snapshot-builder.js";
parentPort!.on("message", ({ id, snapshot }: { id: number; snapshot: WorkSnapshot }) => {
  try {
    const result = compileVfmManuscript(snapshot);
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
    const keys = ["mappings", "sourceMap", "headings", "diagnostics", "resourceRequests"] as const;
    const chunks: Record<string, ArrayBuffer[]> = {}, metadata = { ...result };
    for (const key of keys) {
      const values = result[key]; chunks[key] = [];
      for (let i = 0; i < values.length; i += 256) chunks[key].push(encode(values.slice(i, i + 256)));
      metadata[key] = [];
    }
    const packet = encode(metadata);
    parentPort!.postMessage({ id, packet, chunks }, [packet, ...Object.values(chunks).flat()]);
  }
  catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
