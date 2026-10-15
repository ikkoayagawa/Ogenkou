import { createHash } from "node:crypto";
import { parse, parseFragment } from "parse5";
import type { CompiledDocument } from "../compiler/manuscript.js";
import type { WorkSnapshot, ResourceSnapshot } from "./snapshot-builder.js";
import { cssReferences, absoluteCss } from "./resource-references.js";
import { discoverHtmlResources, type ResourceDiscovery, type ResourceNode } from "./resource-discovery.js";

export type ResourceReader = (uri: string, text: boolean) => Promise<string | Uint8Array>;
export interface ResourceIssue { uri: string; referrer: string; code: "missing" | "external" | "invalid" | "unsupported"; message: string }
export interface ResourceManifest {
  complete: boolean;
  stylesheetUris: string[];
  dependencies: { referrer: string; uri: string; kind: "css" | "asset" }[];
  issues: ResourceIssue[];
}
export interface ResourceCollection { resources: ResourceSnapshot[]; manifest: ResourceManifest }
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function resourceIdentity(uri: string): string {
  const url = new URL(uri); url.hash = ""; url.search = "";
  if (url.protocol !== "file:") return url.href;
  const path = decodeURIComponent(url.pathname);
  return url.hostname || /^\/[a-z]:\//iu.test(url.pathname)
    ? "file:" + url.hostname.toLowerCase() + path.toLowerCase() : "file:" + path;
}
function mediaType(uri: string): string {
  const ext = new URL(uri).pathname.split(".").at(-1)!.toLowerCase();
  return ({ css: "text/css", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", woff: "font/woff", woff2: "font/woff2", otf: "font/otf", ttf: "font/ttf" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

/** No network access. Each read belongs to SnapshotBuilder's captured-buffer transaction. */
export async function collectResources(snapshot: WorkSnapshot, document: CompiledDocument, read: ResourceReader,
  signal: AbortSignal, limits = { files: 2048, bytes: 128 * 1024 * 1024 }): Promise<ResourceCollection> {
  const resources = new Map<string, ResourceSnapshot>();
  const loaded = new Map<string, string | Uint8Array>();
  const seen = new Set<string>(), scanned = new Set<string>();
  const manifest: ResourceManifest = { complete: true, stylesheetUris: [], dependencies: [], issues: [] };
  const queue: { uri: string; kind: "css" | "asset"; referrer: string }[] = [];
  let total = 0;
  const reported = new Set<string>();
  const issue = (uri: string, referrer: string, code: ResourceIssue["code"], message: string) => {
    manifest.complete = false;
    const key = code + ":" + uri;
    if (!reported.has(key)) { reported.add(key); manifest.issues.push({ uri, referrer, code, message }); }
  };
  const enqueue = (value: string, base: string, kind: "css" | "asset") => {
    if (!value || value.startsWith("#")) return;
    let uri: string;
    try { uri = new URL(value, base).href; } catch { issue(value, base, "invalid", "資源URLを解決できません。"); return; }
    if (uri.startsWith("data:")) {
      if (kind === "css") issue("data:text/css", base, "unsupported", "埋込みCSS内の資源収集は未対応です。");
      // Raster/font data URLs are self-contained; nested SVG data URLs need explicit support.
      if (/^data:image\/svg\+xml/iu.test(uri)) issue("data:image/svg+xml", base, "unsupported", "埋込みSVG内の資源収集は未対応です。");
      return;
    }
    manifest.dependencies.push({ referrer: base, uri, kind });
    if (!uri.startsWith("file:")) { issue(uri, base, "external", "ローカルに固定できない資源です。"); return; }
    const key = resourceIdentity(uri) + ":" + kind;
    if (seen.has(key)) return;
    seen.add(key); queue.push({ uri, kind, referrer: base });
    if (seen.size > limits.files) throw new Error("資源数が収集上限を超えました。");
  };
  const css = (text: string, base: string) => { for (const ref of cssReferences(text)) enqueue(ref.value, base, ref.kind); };
  const discovered = (discovery: ResourceDiscovery) => {
    for (const ref of discovery.references) enqueue(ref.value, ref.base, ref.kind);
    for (const ref of discovery.unsupported) issue(ref.base, ref.base, "unsupported", "資源収集・Core接続が未対応です: " + ref.tag);
  };
  for (const value of [...snapshot.config.theme, snapshot.config.style, snapshot.config.userStyle].filter((v): v is string => !!v)) {
    const uri = new URL(value, snapshot.work).href; manifest.stylesheetUris.push(uri); enqueue(uri, snapshot.work, "css");
  }
  for (const resource of snapshot.resources) enqueue(resource.uri, snapshot.work, resource.kind);
  for (const ref of document.resourceRequests) enqueue(ref.uri, ref.sourceUri, "asset");
  css(document.css, snapshot.work);
  discovered(document.resourceDiscovery ?? discoverHtmlResources(parse(document.html) as ResourceNode, snapshot.work));
  for (let i = 0; i < queue.length; i++) {
    signal.throwIfAborted();
    const { uri, kind, referrer } = queue[i]!, canonical = new URL(uri); canonical.hash = ""; canonical.search = "";
    const key = resourceIdentity(uri), mime = kind === "css" ? "text/css" : mediaType(uri);
    const text = kind === "css" || mime === "text/css" || mime === "image/svg+xml";
    let value: string | Uint8Array;
    try {
      const readKey = key + ":" + text;
      if (loaded.has(readKey)) value = loaded.get(readKey)!;
      else { value = await read(canonical.href, text); loaded.set(readKey, value); }
    }
    catch (error) {
      signal.throwIfAborted();
      const code = (error as { code?: string }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "FileNotFound") throw error;
      issue(uri, referrer, "missing", "参照先の資源がありません。"); continue;
    }
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    if (!resources.has(key)) { total += bytes.byteLength; if (total > limits.bytes) throw new Error("資源容量が収集上限を超えました。"); }
    const decoded = text ? typeof value === "string" ? value : new TextDecoder("utf-8", { fatal: true }).decode(value) : undefined;
    if (resources.get(key)?.kind !== "css") resources.set(key, { uri: canonical.href, kind, sha256: hash(bytes), base64: Buffer.from(bytes).toString("base64"), mediaType: mime,
      ...(kind === "css" ? { resolvedCss: absoluteCss(decoded!, canonical.href) } : {}) });
    const scanKey = key + ":" + kind;
    if (decoded !== undefined && !scanned.has(scanKey)) {
      scanned.add(scanKey);
      if (kind === "css") css(decoded, canonical.href);
      else discovered(discoverHtmlResources(parseFragment(decoded) as ResourceNode, canonical.href));
    }
  }
  signal.throwIfAborted();
  return { resources: [...resources.values()].sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0), manifest };
}

/** Logical URLs may have a query or SVG fragment; these select the same captured file bytes. */
export function findResource(snapshot: WorkSnapshot, uri: string): ResourceSnapshot | undefined {
  const key = resourceIdentity(uri);
  return snapshot.resources.find(resource => resourceIdentity(resource.uri) === key);
}
