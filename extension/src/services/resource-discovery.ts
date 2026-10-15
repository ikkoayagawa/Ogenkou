import { cssReferences, srcsetReferences } from "./resource-references.js";
export type ResourceNode = { tagName?: string; nodeName?: string; value?: string;
  attrs?: { name: string; value: string; prefix?: string }[]; childNodes?: ResourceNode[]; content?: ResourceNode };
export interface ResourceDiscovery {
  references: { value: string; base: string; kind: "css" | "asset" }[];
  unsupported: { base: string; tag: string }[];
}
/** Reuse the compiler's parsed DOM in its Worker, rather than reparsing the full novel in the host. */
export function discoverHtmlResources(root: ResourceNode, base: string): ResourceDiscovery {
  const result: ResourceDiscovery = { references: [], unsupported: [] };
  const add = (value: string, kind: "css" | "asset" = "asset") => result.references.push({ value, base, kind });
  const css = (value: string) => { for (const ref of cssReferences(value)) add(ref.value, ref.kind); };
  const emptyAttrs: Record<string, string> = {};
  const visit = (node: ResourceNode) => {
    if (!node.tagName && !node.childNodes && !node.content) return;
    const attrs = node.attrs?.length ? Object.fromEntries(node.attrs.map(a => [(a.prefix ? a.prefix + ":" : "") + a.name, a.value])) : emptyAttrs;
    const tag = node.tagName ?? "";
    if (["base", "iframe", "script", "object", "embed"].includes(tag)) result.unsupported.push({ base, tag });
    if (tag === "use" && [attrs.href, attrs["xlink:href"]].some(value => value && !value.startsWith("#")))
      result.unsupported.push({ base, tag: "external SVG use" });
    if (["img", "source", "video", "audio", "input", "image", "use", "feimage"].includes(tag.toLowerCase())) {
      for (const name of ["src", "poster", "href", "xlink:href"]) if (attrs[name]) add(attrs[name]);
      for (const name of ["srcset", "imagesrcset"]) if (attrs[name]) for (const ref of srcsetReferences(attrs[name])) {
        if (ref.url.startsWith("data:")) result.unsupported.push({ base, tag: "data URL in srcset" });
        add(ref.url);
      }
    }
    if (tag === "link" && /(?:^|\s)stylesheet(?:\s|$)/iu.test(attrs.rel ?? "") && attrs.href) add(attrs.href, "css");
    if (attrs.style) css(attrs.style);
    for (const name of ["fill", "stroke", "filter", "clip-path", "mask", "cursor", "marker-start", "marker-mid", "marker-end"]) if (attrs[name]) css(attrs[name]);
    if (tag === "style") css((node.childNodes ?? []).map(c => c.value ?? "").join(""));
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(root); return result;
}
