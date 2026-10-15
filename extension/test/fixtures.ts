import { BUILTIN_PUBLICATION, publicationValues } from "../src/config/publication-editor.js";
import { builtInPaperLayouts } from "../src/config/paper-layout-presets.js";
import type { DocumentStore, TextRecord } from "../src/services/contracts.js";
import type { Preferences, PreferencesRecord, PreferencesStore } from "../src/services/settings-service.js";

export class EditorStore implements DocumentStore {
  records = new Map<string, TextRecord>();
  saved: string[] = [];
  set(uri: string, text: string, dirty = false): TextRecord {
    const result = { uri, text, dirty, version: String(Number(this.records.get(uri)?.version ?? 0) + 1) };
    this.records.set(uri, result); return { ...result };
  }
  async read(uri: string, signal: AbortSignal): Promise<TextRecord> {
    signal.throwIfAborted(); const record = this.records.get(uri);
    if (!record) throw new Error("Missing document"); return { ...record };
  }
  async create(uri: string, text: string, signal: AbortSignal): Promise<TextRecord> {
    signal.throwIfAborted(); if (this.records.has(uri)) throw new Error("Already exists");
    const record = this.set(uri, text); this.saved.push(uri); return record;
  }
  async compareAndSwap(base: TextRecord, text: string, signal: AbortSignal): Promise<TextRecord> {
    signal.throwIfAborted(); const current = this.records.get(base.uri);
    if (current?.version !== base.version || current.text !== base.text) throw new Error("Settings conflict");
    if (text === base.text) return { ...current };
    const updated = this.set(base.uri, text, base.dirty);
    if (!base.dirty) this.saved.push(base.uri);
    return updated;
  }
}
export class PreferencesMemory implements PreferencesStore {
  record: PreferencesRecord = { version: "1", value: { defaults: publicationValues(BUILTIN_PUBLICATION), paperLayouts: builtInPaperLayouts() } };
  async read(signal: AbortSignal): Promise<PreferencesRecord> { signal.throwIfAborted(); return structuredClone(this.record); }
  async compareAndSwap(base: PreferencesRecord, value: Preferences, signal: AbortSignal): Promise<PreferencesRecord> {
    signal.throwIfAborted(); if (base.version !== this.record.version) throw new Error("Defaults conflict");
    this.record = { version: String(Number(base.version) + 1), value: structuredClone(value) };
    return structuredClone(this.record);
  }
}
