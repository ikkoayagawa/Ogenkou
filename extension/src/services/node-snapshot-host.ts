import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { DiskRead, FileEntry, OpenText, SnapshotHost } from "./snapshot-builder.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Local-disk reader for tests/tools. The VS Code adapter will supply buffers and watcher generation. */
export class NodeSnapshotHost implements SnapshotHost {
  constructor(private readonly buffers: () => readonly OpenText[] = () => [],
    private readonly counter: () => number = () => 0) {}
  generation(): number { return this.counter(); }
  openTexts(): readonly OpenText[] { return this.buffers(); }
  async list(rootUri: string, signal: AbortSignal): Promise<readonly FileEntry[]> {
    signal.throwIfAborted();
    return (await readdir(new URL(rootUri), { withFileTypes: true })).map(entry => ({
      uri: new URL(encodeURIComponent(entry.name) + (entry.isDirectory() ? "/" : ""), rootUri).href,
      directory: entry.isDirectory(),
    }));
  }
  async read(uri: string, signal: AbortSignal): Promise<DiskRead> {
    const bytes = await readFile(new URL(uri), { signal });
    return { uri, bytes, stamp: hash(bytes) };
  }
  async unchanged(reads: readonly DiskRead[], signal: AbortSignal): Promise<boolean> {
    const current = await Promise.all(reads.map(async previous => {
      try { return (await this.read(previous.uri, signal)).stamp === previous.stamp; }
      catch (error) { signal.throwIfAborted(); return false; }
    }));
    return current.every(Boolean);
  }
}
