import { Worker } from "node:worker_threads";
import type { WorkSnapshot } from "../services/snapshot-builder.js";
import { performance } from "node:perf_hooks";
import type { CompiledDocument } from "./manuscript.js";
type Job = { id: number; snapshot: WorkSnapshot; signal?: AbortSignal; abort?: () => void;
  resolve: (result: CompiledDocument) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
/** Freeze a large result in small event-loop turns instead of monopolizing the host. */
async function freezeResult(value: CompiledDocument, current: () => boolean): Promise<CompiledDocument> {
  const stack: object[] = [value];
  while (stack.length) {
    const start = performance.now();
    while (stack.length && performance.now() - start < 6) {
      const object = stack.pop()!;
      for (const child of Object.values(object)) if (child && typeof child === "object") stack.push(child);
      Object.freeze(object);
    }
    if (!current()) throw new Error("Compiler input cancelled");
    if (stack.length) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return value;
}

/** One reusable compiler worker, one running input, and only the latest pending input. */
export class CompilerService {
  #worker?: Worker; #running?: Job; #pending?: Job; #serial = 0; #closed = false;
  constructor(private readonly timeoutMs = 15000) {}
  compile(snapshot: WorkSnapshot, signal?: AbortSignal): Promise<CompiledDocument> {
    if (this.#closed) return Promise.reject(new Error("Compiler closed"));
    if (signal?.aborted) return Promise.reject(new Error("Compiler cancelled"));
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.#serial, snapshot, signal, resolve, reject };
      job.abort = () => {
        if (job === this.#running) this.#finish(undefined, new Error("Compiler cancelled"), true);
        else if (job === this.#pending) { this.#pending = undefined; this.#reject(job, new Error("Compiler cancelled")); }
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      if (this.#running) {
        if (this.#pending) this.#reject(this.#pending, new Error("Compiler input superseded"));
        this.#pending = job;
      } else this.#start(job);
    });
  }
  #clean(job: Job): void {
    if (job.timer) clearTimeout(job.timer);
    if (job.abort) job.signal?.removeEventListener("abort", job.abort);
  }
  #reject(job: Job, error: Error): void { this.#clean(job); job.reject(error); }
  #start(job: Job): void {
    this.#running = job;
    if (!this.#worker) {
      const worker = new Worker(new URL("./compiler-worker.js", import.meta.url)); this.#worker = worker;
      worker.on("message", async ({ id, packet, chunks, error }: { id: number; packet?: ArrayBuffer; chunks?: Record<string, ArrayBuffer[]>; error?: string }) => {
        const current = () => worker === this.#worker && id === this.#running?.id;
        if (!current()) return;
        try {
          if (error || !packet) throw new Error(error ?? "Empty compiler result");
          const result = JSON.parse(new TextDecoder().decode(packet)) as CompiledDocument;
          const arrays = result as unknown as Record<string, unknown[]>;
          let turnStart = performance.now();
          for (const [key, buffers] of Object.entries(chunks ?? {})) {
            for (const buffer of buffers) {
              arrays[key]!.push(...JSON.parse(new TextDecoder().decode(buffer)));
              if (performance.now() - turnStart >= 6) {
                await new Promise<void>(resolve => setImmediate(resolve)); turnStart = performance.now();
                if (!current()) throw new Error("Compiler input cancelled");
              }
            }
          }
          await freezeResult(result, current);
          if (current()) this.#finish(result);
        } catch (failure) { if (current()) this.#finish(undefined, failure as Error); }
      });
      worker.on("error", error => { if (worker === this.#worker) this.#finish(undefined, error, true); });
      worker.on("exit", code => { if (worker === this.#worker) this.#finish(undefined, new Error("Compiler worker exited: " + code), true); });
    }
    job.timer = setTimeout(() => this.#finish(undefined, new Error("Compiler timeout"), true), this.timeoutMs);
    try {
      // Resource bytes and assembled content aren't consumed by the parser; don't clone them twice.
      this.#worker.postMessage({ id: job.id, snapshot: { ...job.snapshot, content: "", configText: "", resources: [] } });
    } catch (error) { this.#finish(undefined, error as Error, true); }
  }
  #finish(result?: CompiledDocument, error?: Error, stop = false): void {
    const job = this.#running; this.#running = undefined;
    if (stop && this.#worker) { const worker = this.#worker; this.#worker = undefined; void worker.terminate(); }
    if (job) {
      this.#clean(job);
      if (error || !result) job.reject(error ?? new Error("Empty compiler result")); else job.resolve(result);
    }
    const pending = this.#pending; this.#pending = undefined;
    if (pending && !this.#closed) this.#start(pending);
  }
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#pending) this.#reject(this.#pending, new Error("Compiler closed")); this.#pending = undefined;
    if (this.#running) this.#reject(this.#running, new Error("Compiler closed")); this.#running = undefined;
    const worker = this.#worker; this.#worker = undefined; if (worker) await worker.terminate();
  }
}
