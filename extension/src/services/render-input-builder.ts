import type { CompiledDocument } from "../compiler/manuscript.js";
import { SnapshotBuilder, type WorkSnapshot } from "./snapshot-builder.js";
import { collectResources } from "./resource-collector.js";
import { immutable } from "./contracts.js";

export interface SnapshotCompiler { compile(snapshot: WorkSnapshot, signal?: AbortSignal): Promise<CompiledDocument> }
export interface RenderInput { readonly snapshot: WorkSnapshot; readonly document: CompiledDocument }
/** Compile a coherent captured body through later body edits; discover/validate
 * configuration and resources before stamping the final revision. */
export class RenderInputBuilder {
  constructor(private readonly snapshots: SnapshotBuilder, private readonly compiler: SnapshotCompiler) {}
  async build(options: { signal?: AbortSignal; assetUris?: readonly string[] } = {}): Promise<RenderInput> {
    let compiled: CompiledDocument | undefined;
    const snapshot = await this.snapshots.build({ ...options, prepareResources: async (candidate, read, signal) => {
      compiled = await this.compiler.compile(candidate, signal);
      if (compiled.work !== candidate.work || compiled.epoch !== candidate.epoch || compiled.revision !== candidate.revision)
        throw new Error("Compiler result does not match input");
      return collectResources(candidate, compiled, read, signal);
    } });
    if (!compiled) throw new Error("Compiler result missing");
    if (!Object.isFrozen(compiled)) immutable(compiled);
    // Nested mapping objects are already frozen by CompilerService. Avoid traversing the large graph twice.
    const document = Object.freeze({ ...compiled, revision: snapshot.revision });
    return Object.freeze({ snapshot, document });
  }
}
