import type * as VSCode from "vscode";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { publicationValues, BUILTIN_PUBLICATION, applyPublicationValues } from "../config/publication-editor.js";
import { builtInPaperLayouts, paperLayoutKey, capturePaperLayout } from "../config/paper-layout-presets.js";
import type { DocumentStore, TextRecord } from "../services/contracts.js";
import type { PreferencesStore, PreferencesRecord, Preferences } from "../services/settings-service.js";
import type { SnapshotHost, OpenText, FileEntry, DiskRead } from "../services/snapshot-builder.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Inject API rather than importing the runtime module: Node tests/tools remain independent. */
export class VSCodeWorkspace implements DocumentStore, VSCode.Disposable {
  #generation = 0;
  #contextGeneration = 0;
  #subscriptions: VSCode.Disposable[];
  #watcher: VSCode.FileSystemWatcher;
  #closed = false;
  constructor(private readonly api: typeof VSCode, root: VSCode.Uri) {
    this.#watcher = api.workspace.createFileSystemWatcher(new api.RelativePattern(root, "**/*"));
    const bump = () => { this.#generation++; this.#contextGeneration++; };
    const textChange = (uri: VSCode.Uri) => {
      this.#generation++;
      if (!/\.(?:novel|nv)$/iu.test(uri.path)) this.#contextGeneration++;
    };
    this.#subscriptions = [api.workspace.onDidChangeTextDocument(e => textChange(e.document.uri)),
      api.workspace.onDidOpenTextDocument(d => textChange(d.uri)), api.workspace.onDidCloseTextDocument(d => textChange(d.uri)),
      this.#watcher.onDidCreate(bump), this.#watcher.onDidChange(textChange), this.#watcher.onDidDelete(bump)];
  }
  #check(signal: AbortSignal): void { signal.throwIfAborted(); if (this.#closed) throw new Error("Workspace closed"); }
  generation(): number { return this.#generation; }
  openTexts(): readonly OpenText[] {
    return this.api.workspace.textDocuments.filter(d => d.uri.scheme === "file").map(d => ({ uri: d.uri.toString(), text: d.getText(), version: d.version, dirty: d.isDirty }));
  }
  async list(rootUri: string, signal: AbortSignal): Promise<readonly FileEntry[]> {
    this.#check(signal); const root = this.api.Uri.parse(rootUri);
    const entries = await this.api.workspace.fs.readDirectory(root); this.#check(signal);
    return entries.map(([name, type]) => ({ uri: this.api.Uri.joinPath(root, name).toString(), directory: !!(type & this.api.FileType.Directory) }));
  }
  // Separate the disk read from DocumentStore.read; structural ports share the name.
  snapshotHost(): SnapshotHost {
    return { generation: () => this.generation(), contextGeneration: () => this.#contextGeneration, openTexts: () => this.openTexts(), list: (root, signal) => this.list(root, signal),
      read: (uri, signal) => this.readDisk(uri, signal), unchanged: (reads, signal) => this.unchanged(reads, signal) };
  }
  async readDisk(uri: string, signal: AbortSignal): Promise<DiskRead> {
    this.#check(signal); const bytes = await this.api.workspace.fs.readFile(this.api.Uri.parse(uri)); this.#check(signal);
    return { uri, bytes, stamp: hash(bytes) };
  }
  async unchanged(reads: readonly DiskRead[], signal: AbortSignal): Promise<boolean> {
    const result = await Promise.all(reads.map(async prior => {
      try { return (await this.readDisk(prior.uri, signal)).stamp === prior.stamp; }
      catch { this.#check(signal); return false; }
    }));
    return result.every(Boolean);
  }
  #record(doc: VSCode.TextDocument): TextRecord {
    return { uri: doc.uri.toString(), text: doc.getText(), version: String(doc.version), dirty: doc.isDirty };
  }
  #editorEol(text: string, doc: VSCode.TextDocument): string {
    return text.replace(/\r\n|\r|\n/gu, doc.eol === this.api.EndOfLine.CRLF ? "\r\n" : "\n");
  }
  async read(uri: string, signal: AbortSignal): Promise<TextRecord> {
    this.#check(signal); const document = await this.api.workspace.openTextDocument(this.api.Uri.parse(uri));
    this.#check(signal); return this.#record(document);
  }
  async create(uri: string, text: string, signal: AbortSignal): Promise<TextRecord> {
    this.#check(signal); const target = this.api.Uri.parse(uri);
    if (this.api.workspace.textDocuments.some(d => d.uri.toString() === target.toString())) throw new Error("Already exists in editor");
    this.#check(signal);
    if (target.scheme !== "file") throw new Error("作品設定の作成にはローカルフォルダーを指定してください。");
    await writeFile(target.fsPath, text, { encoding: "utf8", flag: "wx" });
    // Save only our newly created content; an intervening user edit stays dirty.
    const document = await this.api.workspace.openTextDocument(target);
    this.#check(signal);
    if (document.getText() !== this.#editorEol(text, document)) throw new Error("新規設定に編集が入りました。エディタから保存してください。");
    if (!await document.save()) throw new Error("新規設定を保存できませんでした。");
    return this.#record(document);
  }
  async compareAndSwap(base: TextRecord, text: string, signal: AbortSignal): Promise<TextRecord> {
    this.#check(signal); const document = await this.api.workspace.openTextDocument(this.api.Uri.parse(base.uri));
    this.#check(signal);
    if (String(document.version) !== base.version || document.getText() !== base.text) throw new Error("Settings conflict");
    text = this.#editorEol(text, document);
    if (text === base.text) return this.#record(document);
    let start = 0, suffix = 0;
    while (start < base.text.length && start < text.length && base.text[start] === text[start]) start++;
    while (suffix < base.text.length - start && suffix < text.length - start && base.text.at(-suffix - 1) === text.at(-suffix - 1)) suffix++;
    const edit = new this.api.WorkspaceEdit();
    edit.replace(document.uri, new this.api.Range(document.positionAt(start), document.positionAt(base.text.length - suffix)), text.slice(start, text.length - suffix));
    this.#check(signal);
    // No await between checking version and submitting. VS Code transports document versions with edits.
    if (!await this.api.workspace.applyEdit(edit)) throw new Error("設定が競合したため更新できませんでした。");
    this.#check(signal);
    if (document.getText() !== text) throw new Error("適用中に設定が編集されました。再読み込みしてください。");
    return this.#record(document); // GUI apply never saves a pre-existing file, even if originally clean.
  }
  dispose(): void { this.#closed = true; this.#generation++; this.#subscriptions.forEach(s => s.dispose()); this.#watcher.dispose(); }
}

export class VSCodePreferences implements PreferencesStore {
  #version = 0;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: VSCode.Memento) {}
  #value(): Preferences {
    const prefs = this.storage.get<Preferences>("publicationPreferences");
    const legacy = this.storage.get<Record<string, unknown>>("publicationDefaults");
    const values = prefs?.defaults ?? legacy ?? publicationValues(BUILTIN_PUBLICATION);
    const defaults = applyPublicationValues(BUILTIN_PUBLICATION, values, false);
    const resolved = publicationValues(defaults), paperLayouts = { ...builtInPaperLayouts(), ...prefs?.paperLayouts };
    const key = paperLayoutKey(defaults.layout.pageSize, defaults.writingMode);
    if (!prefs && legacy && key) paperLayouts[key] = capturePaperLayout(resolved);
    return { defaults: resolved, paperLayouts };
  }
  async read(signal: AbortSignal): Promise<PreferencesRecord> {
    signal.throwIfAborted(); return { version: String(this.#version), value: structuredClone(this.#value()) };
  }
  compareAndSwap(base: PreferencesRecord, value: Preferences, signal: AbortSignal): Promise<PreferencesRecord> {
    const operation = this.#queue.then(async () => {
      signal.throwIfAborted();
      if (base.version !== String(this.#version) || JSON.stringify(base.value) !== JSON.stringify(this.#value())) throw new Error("Defaults conflict");
      await this.storage.update("publicationPreferences", structuredClone(value)); this.#version++;
      return { version: String(this.#version), value: structuredClone(value) };
    });
    this.#queue = operation.catch(() => undefined); return operation;
  }
}
