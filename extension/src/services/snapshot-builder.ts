import { createHash } from "node:crypto";
import { parseProjectConfig, type OgenkouProjectConfig } from "../project/project-config.js";
import { BUILTIN_PUBLICATION, rawProjectPublication } from "../config/publication-editor.js";
import { resolvePublicationSettings, type PublicationSettings } from "../config/publication-settings.js";
import { immutable, request } from "./contracts.js";
import type { ResourceCollection, ResourceManifest, ResourceReader } from "./resource-collector.js";

export interface OpenText { readonly uri: string; readonly text: string; readonly version: number; readonly dirty: boolean }
export interface FileEntry { readonly uri: string; readonly directory: boolean }
export interface DiskRead { readonly uri: string; readonly bytes: Uint8Array; readonly stamp: string }
/** Generation increments for editor/watcher changes. All open buffers are captured synchronously. */
export interface SnapshotHost {
  generation(): number;
  /** Optional watcher guard for context changes, excluding manuscript body edits. */
  contextGeneration?(): number;
  openTexts(): readonly OpenText[];
  list(rootUri: string, signal: AbortSignal): Promise<readonly FileEntry[]>;
  read(uri: string, signal: AbortSignal): Promise<DiskRead>;
  unchanged(reads: readonly DiskRead[], signal: AbortSignal): Promise<boolean>;
}
export interface SourcePart {
  readonly uri: string; readonly text: string; readonly dirty: boolean; readonly editorVersion?: number;
  readonly virtualStart: number; readonly virtualEnd: number;
}
export interface ResourceSnapshot { readonly uri: string; readonly sha256: string; readonly base64: string; readonly kind: "css" | "asset";
  readonly mediaType?: string; readonly resolvedCss?: string }
export interface WorkSnapshot {
  readonly work: string; readonly epoch: number; readonly revision: number; readonly fingerprint: string;
  readonly content: string; readonly sources: readonly SourcePart[];
  readonly boundaries: readonly { start: number; end: number }[];
  readonly configText: string; readonly config: OgenkouProjectConfig;
  readonly rawSettings: PublicationSettings; readonly settings: PublicationSettings;
  readonly resources: readonly ResourceSnapshot[];
  /** True only after recursive collection succeeds without unresolved dependencies. */
  readonly resourceManifestComplete: boolean;
  readonly resourceManifest?: ResourceManifest;
}
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Locale-independent natural ordering, including integers above Number.MAX_SAFE_INTEGER. */
export function naturalCompare(a: string, b: string): number {
  const left = a.match(/\d+|\D+/gu) ?? [], right = b.match(/\d+|\D+/gu) ?? [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!, y = right[i]!;
    const comparison = /^\d+$/u.test(x) && /^\d+$/u.test(y)
      ? (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0)
      : ordinal(x.toLowerCase(), y.toLowerCase());
    if (comparison) return comparison;
  }
  return left.length - right.length || ordinal(a, b);
}
function rootOf(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== "file:") throw new Error("ローカルファイルの原稿を指定してください。");
  if (!/\.(?:novel|nv)$/iu.test(decodeURIComponent(url.pathname))) throw new Error(".novel／.nv の原稿を指定してください。");
  return new URL(".", url).href;
}
function identity(uri: string): string {
  const url = new URL(uri);
  // Windows drive/UNC paths are case-insensitive; POSIX test paths are not.
  return url.protocol === "file:" && (url.hostname || /^\/[a-z]:\//iu.test(url.pathname))
    ? "file:" + url.hostname.toLowerCase() + decodeURIComponent(url.pathname).toLowerCase() : url.href;
}
function directChild(uri: string, root: string): boolean { return identity(new URL(".", uri).href) === identity(root); }
const memberKey = (files: readonly FileEntry[]) => JSON.stringify(files.map(f => [f.uri, f.directory]).sort());

export class SnapshotBuilder {
  #active?: { root: string; epoch: number; defaults: PublicationSettings };
  #epoch = 0; #revision = 0; #fingerprint?: string; #latestBuild = 0;
  constructor(private readonly host: SnapshotHost, private readonly timeoutMs = 15000) {}
  activate(manuscriptUri: string, defaults: PublicationSettings = BUILTIN_PUBLICATION): void {
    this.#active = { root: rootOf(manuscriptUri), epoch: ++this.#epoch, defaults: structuredClone(defaults) };
    this.#revision = 0; this.#fingerprint = undefined; this.#latestBuild++;
  }
  close(): void { this.#active = undefined; this.#epoch++; this.#latestBuild++; }
  async build(options: { signal?: AbortSignal; assetUris?: readonly string[];
    prepareResources?: (snapshot: WorkSnapshot, read: ResourceReader, signal: AbortSignal) => Promise<ResourceCollection> } = {}): Promise<WorkSnapshot> {
    if (!this.#active) throw new Error("作品が開かれていません。");
    const active = this.#active, build = ++this.#latestBuild;
    const check = () => {
      if (active !== this.#active || build !== this.#latestBuild) throw new Error("Snapshot superseded");
    };
    return request(async signal => {
      for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted(); check();
        const generation = this.host.generation();
        const open = new Map(this.host.openTexts().map(doc => [identity(doc.uri), { ...doc }]));
        const reads: DiskRead[] = [];
        const textReads = new Map<string, { uri: string; text: string; buffered: boolean }>();
        const missing = new Set<string>();
        const entries = await this.host.list(active.root, signal);
        const read = async (uri: string, text: boolean): Promise<string | Uint8Array> => {
          const buffer = open.get(identity(uri));
          if (text && buffer) { textReads.set(identity(uri), { uri, text: buffer.text, buffered: true }); return buffer.text; }
          let file: DiskRead;
          try { file = await this.host.read(uri, signal); }
          catch (error) {
            if (["ENOENT", "ENOTDIR", "FileNotFound"].includes((error as { code?: string }).code ?? "")) missing.add(uri);
            throw error;
          }
          reads.push(file);
          if (text) { const value = decoder.decode(file.bytes); textReads.set(identity(uri), { uri, text: value, buffered: false }); return value; }
          return file.bytes.slice();
        };
        const isManuscript = (uri: string) => directChild(uri, active.root) && /\.(?:novel|nv)$/iu.test(decodeURIComponent(new URL(uri).pathname));
        const unique = new Map(entries.filter(f => !f.directory && isManuscript(f.uri)).map(f => [identity(f.uri), f.uri]));
        for (const buffer of open.values()) if (isManuscript(buffer.uri) && !unique.has(identity(buffer.uri))) unique.set(identity(buffer.uri), buffer.uri);
        const uris = [...unique.values()].sort((a, b) => naturalCompare(decodeURIComponent(a), decodeURIComponent(b)));
        const configUri = new URL("ogenkou.jsonc", active.root).href;
        if (!open.has(identity(configUri)) && !entries.some(f => !f.directory && identity(f.uri) === identity(configUri)))
          throw new Error("作品設定がありません。先に新規設定を初期化してください。");
        const configText = await read(configUri, true) as string;
        const config = parseProjectConfig(configText);
        const rawSettings = rawProjectPublication(config.settingsVersion === 1 ? BUILTIN_PUBLICATION : active.defaults, configText);
        const settings = resolvePublicationSettings(rawSettings, {});
        const parts = await Promise.all(uris.map(async uri => ({ uri, text: await read(uri, true) as string,
          dirty: open.get(identity(uri))?.dirty ?? false, editorVersion: open.get(identity(uri))?.version })));
        let content = "";
        const sources: SourcePart[] = [], boundaries: { start: number; end: number }[] = [];
        for (const part of parts) {
          if (sources.length) {
            const start = content.length; content += "\n\n";
            boundaries.push({ start, end: content.length });
          }
          const virtualStart = content.length; content += part.text;
          sources.push({ ...part, virtualStart, virtualEnd: content.length });
        }
        const resourceKinds = new Map<string, "css" | "asset">();
        for (const css of [...config.theme, config.style, config.userStyle].filter((value): value is string => !!value)) {
          const uri = new URL(css, active.root).href;
          if (!uri.startsWith("file:") && !options.prepareResources) throw new Error("外部CSSの取得は未接続です: " + uri);
          resourceKinds.set(uri, "css");
        }
        for (const uri of options.assetUris ?? []) resourceKinds.set(new URL(uri, active.root).href, resourceKinds.get(new URL(uri, active.root).href) ?? "asset");
        let resources = options.prepareResources ? [] : await Promise.all([...resourceKinds].sort(([a], [b]) => ordinal(a, b)).map(async ([uri, kind]) => {
          const value = await read(uri, kind === "css");
          const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
          return { uri, kind, sha256: digest(bytes), base64: Buffer.from(bytes).toString("base64") };
        }));
        let resourceManifest: ResourceManifest | undefined;
        if (options.prepareResources) {
          // Capture a coherent manuscript before expensive conversion. Later body edits
          // belong to the next job; they must not starve this captured revision.
          const capturedEntries = await this.host.list(active.root, signal);
          const capturedStable = await this.host.unchanged(reads, signal);
          signal.throwIfAborted(); check();
          if (generation !== this.host.generation() || memberKey(entries) !== memberKey(capturedEntries) || !capturedStable) continue;
          // The provisional revision never escapes: stamp after resource validation.
          const provisional: WorkSnapshot = immutable({ work: active.root, epoch: active.epoch, revision: 0, fingerprint: "",
            content, sources, boundaries, configText, config, rawSettings, settings,
            resources: [...resourceKinds].map(([uri, kind]) => ({ uri, kind, sha256: "", base64: "" })), resourceManifestComplete: false });
          const collected = await options.prepareResources(provisional, read, signal);
          resources = collected.resources; resourceManifest = collected.manifest;
        }
        const validationGeneration = this.host.contextGeneration?.();
        const afterEntries = await this.host.list(active.root, signal);
        const stable = await this.host.unchanged(options.prepareResources ? reads.filter(r => !isManuscript(r.uri)) : reads, signal);
        // Configuration and resource buffers remain guarded even though manuscript
        // buffers may advance. Closing/saving an unchanged buffer is also safe.
        const currentOpen = new Map(this.host.openTexts().map(doc => [identity(doc.uri), doc]));
        let buffersStable = true;
        for (const [key, prior] of textReads) {
          if (options.prepareResources && isManuscript(prior.uri)) continue;
          const current = currentOpen.get(key);
          if (current) { if (current.text !== prior.text) buffersStable = false; }
          else if (prior.buffered) {
            try { if (decoder.decode((await this.host.read(prior.uri, signal)).bytes) !== prior.text) buffersStable = false; }
            catch (error) { signal.throwIfAborted(); buffersStable = false; }
          }
        }
        let missingStable = true;
        for (const uri of missing) {
          try { await this.host.read(uri, signal); missingStable = false; }
          catch (error) {
            signal.throwIfAborted();
            if (!["ENOENT", "ENOTDIR", "FileNotFound"].includes((error as { code?: string }).code ?? "")) throw error;
          }
        }
        signal.throwIfAborted(); check();
        if ((!options.prepareResources && generation !== this.host.generation()) ||
          (validationGeneration !== undefined && validationGeneration !== this.host.contextGeneration?.()) ||
          memberKey(entries) !== memberKey(afterEntries) || !stable || !buffersStable || !missingStable) continue;
        const fingerprint = digest(JSON.stringify({ sources: sources.map(s => [s.uri, s.text]), configText,
          settings: rawSettings, resources: resources.map(r => [r.uri, r.kind, r.sha256]), resourceManifest }));
        if (fingerprint !== this.#fingerprint) { this.#revision++; this.#fingerprint = fingerprint; }
        return immutable({ work: active.root, epoch: active.epoch, revision: this.#revision, fingerprint,
          content, sources, boundaries, configText, config, rawSettings, settings, resources,
          ...(resourceManifest ? { resourceManifest } : {}), resourceManifestComplete: resourceManifest?.complete ?? false });
      }
      throw new Error("入力が変化しました。最新内容でsnapshotを再試行してください。");
    }, this.timeoutMs, options.signal);
  }
}

/** Synthetic file boundaries deliberately have no manuscript location. */
export function sourceAt(snapshot: WorkSnapshot, offset: number): { uri: string; offset: number } | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined;
  const source = snapshot.sources.find(s => offset >= s.virtualStart && offset < s.virtualEnd)
    ?? (offset === snapshot.content.length ? snapshot.sources.at(-1) : undefined);
  return source ? { uri: source.uri, offset: offset - source.virtualStart } : undefined;
}
