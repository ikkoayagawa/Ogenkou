import type { RenderInput } from "./render-input-builder.js";
import { memoryCss } from "./resource-references.js";
import { resourceIdentity } from "./resource-collector.js";
import { parse, parseFragment, serialize } from "parse5";

export interface CoreMemoryResource { url: string; mediaType?: string; content: string | ArrayBuffer }
/** Adapt captured bytes; never reread the filesystem when handing a revision to Core. */
export function createCoreMemoryInput(input: RenderInput) {
  if (input.document.work !== input.snapshot.work || input.document.epoch !== input.snapshot.epoch || input.document.revision !== input.snapshot.revision)
    throw new Error("原稿・変換結果の世代が一致しません。");
  if (!input.snapshot.resourceManifestComplete) throw new Error("資源が揃っていません。manifestの診断を確認してください。");
  const resources = new Map(input.snapshot.resources.map(resource => [resourceIdentity(resource.uri), resource]));
  const prepared = new Map<string, string | ArrayBuffer>(), resolving = new Set<string>();
  type Node = { tagName?: string; value?: string; attrs?: { name: string; value: string; prefix?: string }[]; childNodes?: Node[] };
  const dataUrl = (value: string, base: string): string => {
    if (!value || value.startsWith("#") || value.startsWith("data:")) return value;
    const url = new URL(value, base), fragment = url.hash, key = resourceIdentity(url.href);
    if (!resources.has(key)) return value;
    if (resolving.has(key)) return "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
    let content = prepare(key);
    if (resources.get(key)!.kind === "css" && typeof content === "string") content = memoryCss(content, resources.get(key)!.uri, uri => dataUrl(uri, resources.get(key)!.uri));
    const bytes = Buffer.from(typeof content === "string" ? content : new Uint8Array(content));
    return "data:" + (resources.get(key)!.mediaType ?? "application/octet-stream") + ";base64," + bytes.toString("base64") + fragment;
  };
  const rewriteSvg = (node: Node, base: string) => {
    for (const attr of node.attrs ?? []) {
      if (["href", "src"].includes(attr.name) && ["image", "use", "feimage"].includes(node.tagName?.toLowerCase() ?? "")) attr.value = dataUrl(attr.value, base);
      if (["style", "fill", "stroke", "filter", "clip-path", "mask", "cursor", "marker-start", "marker-mid", "marker-end"].includes(attr.name))
        attr.value = memoryCss(attr.value, base, uri => dataUrl(uri, base));
    }
    if (node.tagName === "style") for (const child of node.childNodes ?? []) if (child.value !== undefined) child.value = memoryCss(child.value, base, uri => dataUrl(uri, base));
    for (const child of node.childNodes ?? []) rewriteSvg(child, base);
  };
  const prepare = (key: string): string | ArrayBuffer => {
    if (prepared.has(key)) return prepared.get(key)!;
    const resource = resources.get(key)!; resolving.add(key);
    let content: string | ArrayBuffer;
    if (resource.kind === "css") {
      content = memoryCss(Buffer.from(resource.base64, "base64").toString("utf8"), resource.uri, (uri, kind) => {
        if (kind !== "css" || !uri.startsWith("file:")) return uri;
        const target = resourceIdentity(uri);
        // CSS imports of an ancestor are ignored by browsers; make that edge self-contained too.
        if (resolving.has(target)) return "data:text/css,";
        if (resources.has(target)) prepare(target);
        return uri;
      });
    } else if (resource.mediaType === "image/svg+xml" && input.snapshot.resourceManifest!.dependencies.some(d => d.referrer === resource.uri && d.uri.startsWith("file:"))) {
      // An SVG loaded as an image cannot fetch sibling file URLs. Embed its captured dependencies.
      const svg = parseFragment(Buffer.from(resource.base64, "base64").toString("utf8"));
      rewriteSvg(svg as Node, resource.uri); content = serialize(svg);
      if (content.length > 128 * 1024 * 1024) throw new Error("SVG資源の展開容量が上限を超えました。");
    } else content = Uint8Array.from(Buffer.from(resource.base64, "base64")).buffer;
    resolving.delete(key); prepared.set(key, content); return content;
  };
  // Start cycle handling at the configured root stylesheet, rather than URI sort order.
  for (const uri of input.snapshot.resourceManifest!.stylesheetUris) {
    const key = resourceIdentity(uri); if (resources.has(key)) prepare(key);
  }
  const aliases = new Map<string, string>();
  for (const resource of input.snapshot.resources) aliases.set(resource.uri, resourceIdentity(resource.uri));
  for (const dependency of input.snapshot.resourceManifest!.dependencies) {
    if (!dependency.uri.startsWith("file:")) continue;
    const url = new URL(dependency.uri); url.hash = "";
    aliases.set(url.href, resourceIdentity(url.href));
  }
  // CSS's canonical url() spelling percent-encodes quotes/parentheses; bind both spellings.
  for (const [url, key] of [...aliases]) aliases.set(url.replaceAll('"', "%22").replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29"), key);
  const memoryResources: CoreMemoryResource[] = [...aliases].map(([url, key]) => ({ url, mediaType: resources.get(key)!.mediaType, content: prepare(key) }));
  const generatedCssUrl = "https://ogenkou.invalid/generated/" + input.snapshot.epoch + "/" + input.snapshot.revision + "/" + input.snapshot.fingerprint + "/publication.css";
  memoryResources.push({ url: generatedCssUrl, mediaType: "text/css", content: memoryCss(input.document.css, input.snapshot.work) });
  // Document links are materialized by Core; option-level URLs bypass its memory resource table.
  const escape = (url: string) => url.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const links = [generatedCssUrl, ...input.snapshot.resourceManifest!.stylesheetUris].map(url => '<link rel="stylesheet" href="' + escape(url) + '">').join("");
  let html = input.document.html.replace("</head>", links + "</head>");
  if (/<svg(?:\s|>)/iu.test(html)) {
    const dom = parse(html);
    const inlineSvg = (node: Node) => { if (node.tagName === "svg") rewriteSvg(node, input.snapshot.work); else for (const child of node.childNodes ?? []) inlineSvg(child); };
    inlineSvg(dom as Node); html = serialize(dom);
  }
  return {
    source: { url: new URL("publication.html", input.snapshot.work).href, html, revision: input.document.revision,
      sourceMap: input.document.sourceMap, resources: memoryResources },
    options: { authorStyleSheet: [] },
  };
}
