export interface TextRecord {
  readonly uri: string;
  readonly text: string;
  readonly version: string;
  readonly dirty: boolean;
}

/** Implementations must compare AND apply in one serialized editor transaction.
 * Never save unrelated dirty edits. Honor abort before committing a mutation.
 */
export interface DocumentStore {
  read(uri: string, signal: AbortSignal): Promise<TextRecord>;
  create(uri: string, text: string, signal: AbortSignal): Promise<TextRecord>;
  compareAndSwap(base: TextRecord, text: string, signal: AbortSignal): Promise<TextRecord>;
}

export function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) immutable(item);
    Object.freeze(value);
  }
  return value;
}

/** Bound host operations as well as Core jobs. A cancelled request never blocks the next one. */
export async function request<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number,
  parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error("Cancelled"));
  if (parent?.aborted) abort();
  parent?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    timer = setTimeout(() => controller.abort(new Error("Host request timeout")), timeoutMs);
    controller.signal.throwIfAborted();
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}
