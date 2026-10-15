import { PUBLICATION_FIELDS } from "../config/publication-editor.js";
import type { SettingsView } from "./settings-service.js";

type DraftState = { base?: SettingsView; changes: Map<string, unknown>; phase: "ready" | "loading" | "saving" | "conflict" | "error"; message?: string };
/** Domain state behind the old settings panel. Closing a panel does not discard its draft. */
export class SettingsDraft {
  #states = new Map<string, DraftState>();
  #selection?: { work: string; target: "project" | "defaults" };
  #request = 0;
  #key(work: string, target: string): string { return JSON.stringify([work, target]); }
  #state(): DraftState {
    if (!this.#selection) throw new Error("設定の編集対象がありません。");
    const key = this.#key(this.#selection.work, this.#selection.target);
    let state = this.#states.get(key);
    if (!state) { state = { changes: new Map(), phase: "ready" }; this.#states.set(key, state); }
    return state;
  }
  select(work: string, target: "project" | "defaults"): void {
    if (this.#selection?.work === work && this.#selection.target !== target && this.#state().changes.size)
      throw new Error("未適用の変更を適用するか、破棄してください。");
    this.#selection = { work, target }; this.#request++;
  }
  begin(kind: "loading" | "saving"): number { this.#state().phase = kind; return ++this.#request; }
  receive(id: number, view: SettingsView, discard = false): boolean {
    if (id !== this.#request || view.work !== this.#selection?.work || view.target !== this.#selection.target) return false;
    const state = this.#state();
    if (state.changes.size && !discard) {
      state.phase = "conflict"; state.message = "設定が変更されました。draftを保持しています。"; return true;
    }
    state.base = view; state.changes.clear(); state.phase = "ready"; state.message = undefined; return true;
  }
  fail(id: number, message: string): boolean {
    if (id !== this.#request) return false;
    const state = this.#state(); state.phase = "error"; state.message = message; return true;
  }
  invalidate(): void {
    const state = this.#state(); this.#request++; state.phase = "conflict";
    state.message = "設定ファイルが変更されました。再読み込みが必要です。";
  }
  change(key: string, value: unknown): void {
    const state = this.#state();
    if (!state.base || state.phase === "loading" || state.phase === "saving") throw new Error("設定の読込み／適用を待ってください。");
    if (!PUBLICATION_FIELDS.some(field => field.key === key)) throw new Error("未対応の設定項目です。");
    if (JSON.stringify(state.base.values[key]) === JSON.stringify(value)) state.changes.delete(key);
    else state.changes.set(key, structuredClone(value));
  }
  view() {
    const state = this.#state();
    return { base: state.base, changes: Object.fromEntries([...state.changes].map(([k, v]) => [k, structuredClone(v)])),
      dirty: state.changes.size > 0, phase: state.phase, message: state.message };
  }
  close(): void { this.#states.clear(); this.#selection = undefined; this.#request++; }
}
