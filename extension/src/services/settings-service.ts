import { randomUUID } from "node:crypto";
import { BUILTIN_PUBLICATION, editProjectPublication, publicationValues, rawProjectPublication,
  applyPublicationValues } from "../config/publication-editor.js";
import { calculateLayoutGeometry } from "../config/layout-geometry.js";
import { decodePaperSize, PAPER_PRESETS } from "../config/paper-size.js";
import { builtInPaperLayouts, capturePaperLayout, paperLayoutKey, type PaperLayoutPresets } from "../config/paper-layout-presets.js";
import type { PublicationSettings } from "../config/publication-settings.js";
import { parseProjectConfig } from "../project/project-config.js";
import { immutable, request, type DocumentStore, type TextRecord } from "./contracts.js";

export interface Preferences {
  readonly defaults: Record<string, unknown>;
  readonly paperLayouts: PaperLayoutPresets;
}
export interface PreferencesRecord { readonly version: string; readonly value: Preferences }
export interface PreferencesStore {
  read(signal: AbortSignal): Promise<PreferencesRecord>;
  compareAndSwap(base: PreferencesRecord, value: Preferences, signal: AbortSignal): Promise<PreferencesRecord>;
}
export interface SettingsView {
  readonly target: "project" | "defaults";
  readonly work: string; readonly epoch: number; readonly token: string;
  readonly values: Record<string, unknown>; readonly defaults: Record<string, unknown>;
  readonly paperLayouts: PaperLayoutPresets;
  readonly resetPaperLayouts: PaperLayoutPresets;
  readonly legacy: boolean;
}
type Opened = { view: SettingsView; document?: TextRecord; preferences: PreferencesRecord; busy: boolean };

/** Host-neutral service: no Viewer or Webview references; tokens bind writes to one work and base. */
export class SettingsService {
  #epoch = 0;
  #active?: { work: string; uri: string };
  #opened = new Map<string, Opened>();
  #readSerial = 0;
  #latestRead = new Map<string, number>();
  constructor(private readonly documents: DocumentStore, private readonly preferences: PreferencesStore,
    private readonly timeoutMs = 15000) {}

  activate(work: string, configUri: string): void {
    this.#epoch++; this.#active = { work, uri: configUri }; this.#opened.clear(); this.#latestRead.clear();
  }
  close(): void { this.#epoch++; this.#active = undefined; this.#opened.clear(); this.#latestRead.clear(); }
  #check(work: string, epoch: number): void {
    if (this.#active?.work !== work || this.#epoch !== epoch) throw new Error("作品が切り替わりました。設定を再読み込みしてください。");
  }

  async read(target: "project" | "defaults", signal?: AbortSignal): Promise<SettingsView> {
    if (!this.#active) throw new Error("作品が開かれていません。");
    const { work, uri } = this.#active, epoch = this.#epoch;
    const readId = ++this.#readSerial; this.#latestRead.set(target, readId);
    return request(async abort => {
      const prefs = await this.preferences.read(abort);
      abort.throwIfAborted();
      const defaults = applyPublicationValues(BUILTIN_PUBLICATION, prefs.value.defaults, false);
      const document = target === "project" ? await this.documents.read(uri, abort) : undefined;
      abort.throwIfAborted();
      this.#check(work, epoch);
      if (this.#latestRead.get(target) !== readId) throw new Error("Settings read superseded");
      const legacy = !!document && parseProjectConfig(document.text).settingsVersion !== 1;
      const values = publicationValues(document ? rawProjectPublication(legacy ? defaults : BUILTIN_PUBLICATION, document.text) : defaults);
      const view = immutable({ target, work, epoch, token: randomUUID(), values,
        defaults: publicationValues(target === "project" ? defaults : BUILTIN_PUBLICATION),
        paperLayouts: { ...builtInPaperLayouts(), ...structuredClone(prefs.value.paperLayouts) },
        resetPaperLayouts: target === "project" ? { ...builtInPaperLayouts(), ...structuredClone(prefs.value.paperLayouts) } : builtInPaperLayouts(), legacy });
      for (const [token, previous] of this.#opened) {
        if (previous.view.target === target) this.#opened.delete(token);
      }
      this.#opened.set(view.token, { view, document, preferences: structuredClone(prefs), busy: false });
      return view;
    }, this.timeoutMs, signal);
  }

  async save(view: SettingsView, changes: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const opened = this.#opened.get(view.token);
    if (!opened || opened.view.work !== view.work || opened.view.target !== view.target || opened.view.epoch !== view.epoch)
      throw new Error("設定を再読み込みしてから適用してください。");
    this.#check(view.work, view.epoch);
    if (opened.busy) throw new Error("設定を適用中です。");
    // Validate against the trusted base, never against values supplied back from a Webview.
    if (view.target === "defaults" && Object.keys(changes).some(key=>key.startsWith("publication."))) throw new Error("タイトル・著者は作品ごとに設定してください。");
    const base = applyPublicationValues(BUILTIN_PUBLICATION, opened.view.values, false);
    const changed = applyPublicationValues(base, changes);
    const geometry = calculateLayoutGeometry(publicationValues(changed), decodePaperSize(changed.layout.pageSize, PAPER_PRESETS));
    if (geometry.errors.length) throw new Error(geometry.errors.join(" "));
    opened.busy = true;
    try {
      await request(async abort => {
        this.#check(view.work, view.epoch);
        if (view.target === "project") {
          if (opened.view.legacy) throw new Error("旧設定は先に「作品設定を固定化」を実行してください。");
          const text = editProjectPublication(opened.document!.text, changes);
          await this.documents.compareAndSwap(opened.document!, text, abort);
        } else {
          const key = paperLayoutKey(changed.layout.pageSize, changed.writingMode);
          const paperLayouts = structuredClone(opened.preferences.value.paperLayouts);
          if (key) paperLayouts[key] = capturePaperLayout(publicationValues(changed));
          await this.preferences.compareAndSwap(opened.preferences, { defaults: publicationValues(changed), paperLayouts }, abort);
        }
        this.#check(view.work, view.epoch);
      }, this.timeoutMs, signal);
      this.#opened.delete(view.token);
    } finally { opened.busy = false; }
  }

  /** Explicit operation: opening a legacy project alone never writes or freezes it. */
  async freezeLegacy(view: SettingsView, signal?: AbortSignal): Promise<void> {
    const opened = this.#opened.get(view.token);
    if (!opened?.document || opened.view.target !== "project" || !opened.view.legacy || opened.busy)
      throw new Error("旧作品設定を再読み込みしてください。");
    this.#check(opened.view.work, opened.view.epoch);
    opened.busy = true;
    try {
      await request(async abort => {
        this.#check(opened.view.work, opened.view.epoch);
        await this.documents.compareAndSwap(opened.document!, editProjectPublication(opened.document!.text, opened.view.values, true), abort);
        this.#check(opened.view.work, opened.view.epoch);
      }, this.timeoutMs, signal);
      this.#opened.delete(view.token);
    } finally { opened.busy = false; }
  }

  async initializeNew(signal?: AbortSignal): Promise<TextRecord> {
    if (!this.#active) throw new Error("作品が開かれていません。");
    const { work, uri } = this.#active, epoch = this.#epoch;
    return request(async abort => {
      const prefs = await this.preferences.read(abort);
      abort.throwIfAborted();
      const defaults: PublicationSettings = applyPublicationValues(BUILTIN_PUBLICATION, prefs.value.defaults, false);
      this.#check(work, epoch);
      const result = await this.documents.create(uri, editProjectPublication("{}", publicationValues(defaults), true) + "\n", abort);
      this.#check(work, epoch);
      return result;
    }, this.timeoutMs, signal);
  }
}
