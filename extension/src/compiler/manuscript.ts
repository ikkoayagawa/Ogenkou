import { createHash } from "node:crypto";
import type { WorkSnapshot } from "../services/snapshot-builder.js";
import { immutable } from "../services/contracts.js";
import { createPublicationCss } from "./publication-css.js";
import { cssString } from "../config/page-furniture.js";
import type { ResourceDiscovery } from "../services/resource-discovery.js";

export interface MappingRun { generatedStart: number; generatedEnd: number; sourceStart: number; sourceEnd: number; mode: "identity" | "range" }
export interface TextMapping { key: string; uri: string; text: string; kind: "text" | "ruby-base" | "ruby-reading" | "generated"; runs: MappingRun[] }
type Text = { type: "text"; mapping: TextMapping };
type Element = { type: "element"; tag: string; attrs: Record<string, string>; children: Node[] };
type Node = Text | Element;
export interface Heading { id: string; level: number; title: string; uri: string; offset: number; end: number }
export interface Diagnostic { uri: string; start: number; end: number; message: string }
export interface CompiledDocument {
  work: string; epoch: number; revision: number; html: string; css: string;
  sourceMap: { path: number[]; key: string; text: string; kind: TextMapping["kind"] }[];
  mappings: TextMapping[]; headings: Heading[]; diagnostics: Diagnostic[];
  resourceRequests: { uri: string; sourceUri: string; start: number; end: number }[];
  resourceDiscovery?: ResourceDiscovery;
}
const element = (tag: string, children: Node[] = [], attrs: Record<string, string> = {}): Element => ({ type: "element", tag, children, attrs });
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** File-local parser. This is a specified novel grammar, not a full Markdown engine. */
export function compileManuscript(snapshot: WorkSnapshot): CompiledDocument {
  const mappings: TextMapping[] = [], headings: Heading[] = [], diagnostics: Diagnostic[] = [], resourceRequests: CompiledDocument["resourceRequests"] = [];
  const body = element("body"), tocNodes: Element[] = [];
  const processing = snapshot.settings.processing;
  const serial = new Map<string, number>();
  const text = (uri: string, original: string, start: number, kind: TextMapping["kind"] = "text", literal = false): Text => {
    const index = serial.get(uri) ?? 0; serial.set(uri, index + 1);
    const mapping: TextMapping = { key: createHash("sha256").update(uri).digest("hex").slice(0, 24) + ":" + index,
      uri, text: "", kind, runs: [] };
    let offset = 0, skipLF = false;
    for (const char of original) {
      if (skipLF) { skipLF = false; continue; }
      let output = char === "\r" ? "\n" : char === "\0" ? "\uFFFD" : char;
      let length = char.length;
      if (char === "\r" && original[offset + 1] === "\n") { length = 2; skipLF = true; }
      if (!literal && processing.kanaMarks && /[\u3099\u309A\u309B\u309C]/u.test(char) && mapping.text && /[ぁ-ヿ]$/u.test(mapping.text)) {
        const previous = mapping.text.at(-1)!;
        const combined = (previous + (/[\u3099\u309B]/u.test(char) ? "\u3099" : "\u309A")).normalize("NFC");
        if (combined.length === 1) {
          const last = mapping.runs.pop()!; mapping.text = mapping.text.slice(0, -1);
          mapping.runs.push({ generatedStart: mapping.text.length, generatedEnd: mapping.text.length + 1, sourceStart: last.sourceStart, sourceEnd: start + offset + length, mode: "range" });
          mapping.text += combined; offset += length; continue;
        }
      }
      if (!literal && processing.verticalQuotes) output = char === "“" ? "〝" : char === "”" ? "〟" : output;
      const generatedStart = mapping.text.length; mapping.text += output;
      mapping.runs.push({ generatedStart, generatedEnd: mapping.text.length, sourceStart: start + offset, sourceEnd: start + offset + length,
        mode: output === char ? "identity" : "range" });
      offset += length;
    }
    // Merge adjacent identity units into ranges. Long prose is not mapped one object per character.
    const compact: MappingRun[] = [];
    for (const run of mapping.runs) {
      const prior = compact.at(-1);
      if (prior?.mode === "identity" && run.mode === "identity" && prior.sourceEnd === run.sourceStart && prior.generatedEnd === run.generatedStart) {
        prior.sourceEnd = run.sourceEnd; prior.generatedEnd = run.generatedEnd;
      } else compact.push({ ...run });
    }
    mapping.runs = compact; mappings.push(mapping); return { type: "text", mapping };
  };
  const inline = (uri: string, input: string, start: number): Node[] => {
    const nodes: Node[] = []; let cursor = 0, plainStart = 0;
    const flush = () => { if (cursor > plainStart) nodes.push(text(uri, input.slice(plainStart, cursor), start + plainStart)); };
    while (cursor < input.length) {
      const rest = input.slice(cursor); let consumed = 0; let node: Node | undefined;
      if (rest.startsWith("`")) {
        const ticks = /^`+/u.exec(rest)![0], end = input.indexOf(ticks, cursor + ticks.length);
        if (end >= 0) { consumed = end + ticks.length - cursor; node = element("code", [text(uri, input.slice(cursor + ticks.length, end), start + cursor + ticks.length, "text", true)]); }
      }
      const ruby = !node && /^[｜|]/u.test(rest) ? /^(?:｜|\|)([^《\r\n]+)《([^《》\r\n]+)》/u.exec(rest) : null;
      const bracket = !node ? /^\[\[rb:([^>\]\r\n]+)>([^\]\r\n]+)\]\]/u.exec(rest) : null;
      const hanStart = /^[\p{Script=Han}々〆ヶ]/u.test(rest) && (cursor === 0 || !/[\p{Script=Han}々〆ヶ]/u.test(input[cursor - 1]!));
      const bare = !node && !ruby && !bracket && hanStart ? /^([\p{Script=Han}々〆ヶ]+)《([^《》\r\n]+)》/u.exec(rest) : null;
      const r = ruby && processing.ruby.pipeAngle ? ruby : bracket && processing.ruby.bracket ? bracket : bare && processing.ruby.bareKanji ? bare : null;
      if (r) {
        consumed = r[0].length; const baseIndex = bracket === r ? 5 : ruby === r ? 1 : 0; const readingIndex = bracket === r ? r[0].indexOf(">") + 1 : r[0].indexOf("《") + 1;
        node = element("ruby", [text(uri, r[1]!, start + cursor + baseIndex, "ruby-base"), element("rt", [text(uri, r[2]!, start + cursor + readingIndex, "ruby-reading")])]);
      }
      const emphasis = !node ? /^《《([^\r\n]+?)》》/u.exec(rest) : null;
      const bracketEmphasis = !node ? /^\[\[emphasismark:([^\]\r\n]+)\]\]/u.exec(rest) : null;
      const em = emphasis && processing.emphasis.doubleAngle ? emphasis : bracketEmphasis && processing.emphasis.bracket ? bracketEmphasis : null;
      if (em) { consumed = em[0].length; node = element("span", [text(uri, em[1]!, start + cursor + (em === emphasis ? 2 : 15))], { class: "ogenkou-emphasis" }); }
      const disabled = !node ? ruby ?? bracket ?? bare ?? emphasis ?? bracketEmphasis : null;
      if (disabled) { consumed = disabled[0].length; node = text(uri, disabled[0], start + cursor, "text", true); }
      const image = !node ? /^!\[([^\]\r\n]*)\]\(([^\s)]+)\)/u.exec(rest) : null;
      const link = !node ? /^\[([^\]\r\n]+)\]\(([^\s)]+)\)/u.exec(rest) : null;
      if (image || link) {
        const match = (image ?? link)!; consumed = match[0].length;
        const target = match[2]!;
        let destination = "";
        try { destination = target.startsWith("#") ? target : new URL(target, uri).href; } catch { /* diagnosed below */ }
        if (!/^(?:file:|https?:|#)/u.test(destination)) {
          diagnostics.push({ uri, start: start + cursor, end: start + cursor + consumed, message: "未対応のリンク／画像URLです。" });
          node = text(uri, match[0], start + cursor, "text", true);
        } else if (image) {
          resourceRequests.push({ uri: destination, sourceUri: uri, start: start + cursor, end: start + cursor + consumed });
          node = element("img", [], { src: destination, alt: match[1]! });
        } else node = element("a", [text(uri, match[1]!, start + cursor + 1)], { href: destination });
      }
      const digits = !node && processing.automaticTcy ? /^\d{1,2}(?!\d)/u.exec(rest) : null;
      if (digits && (cursor === 0 || !/\d/u.test(input[cursor - 1]!))) {
        consumed = digits[0].length; node = element("span", [text(uri, digits[0], start + cursor)], { class: "ogenkou-tcy" });
      }
      const dash = !node && processing.connectedDashes ? /^[—―]{2,}/u.exec(rest) : null;
      if (dash) { consumed = dash[0].length; node = element("span", [text(uri, dash[0], start + cursor)], { class: "connected-dashes" }); }
      if (node) { flush(); nodes.push(node); cursor += consumed; plainStart = cursor; }
      else cursor += hanStart ? /^[\p{Script=Han}々〆ヶ]+/u.exec(rest)![0].length : 1;
    }
    flush(); return nodes;
  };
  for (const source of snapshot.sources) {
    const uri = source.uri, input = source.text;
    let headingOrdinal = 0;
    const lines = [...input.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)].filter(match => match[0].length);
    let fence: { marker: string; start: number; body: string; contentStart: number } | undefined;
    let paragraph: Element | undefined;
    for (const line of lines) {
      const raw = line[1]!, offset = line.index!;
      const value = offset === 0 ? raw.replace(/^\uFEFF/u, "") : raw;
      const start = offset + raw.length - value.length;
      if (fence) {
        if (new RegExp("^" + fence.marker[0] + "{" + fence.marker.length + ",}\\s*$", "u").test(value)) {
          body.children.push(element("pre", [element("code", [text(uri, fence.body, fence.contentStart, "text", true)])])); fence = undefined;
        } else fence.body += line[0];
        continue;
      }
      const marker = /^(?:`{3,}|~{3,})(?:[^`~]*)$/u.exec(value);
      if (marker) { fence = { marker: /^[`~]+/u.exec(value)![0], start, contentStart: offset + line[0].length, body: "" }; paragraph = undefined; continue; }
      if (value === "[[toc]]") { const toc = element("nav", [], { class: "ogenkou-toc" }); body.children.push(toc); tocNodes.push(toc); paragraph = undefined; continue; }
      const heading = /^(#{1,5})[ \t]+(.+)$/u.exec(value);
      if (heading) {
        const level = heading[1]!.length, title = heading[2]!;
        const id = "h-" + createHash("sha256").update(uri).digest("hex").slice(0, 16) + "-" + headingOrdinal++;
        const titleStart = start + value.length - title.length;
        const children = inline(uri, title, titleStart);
        const plain = (nodes: Node[]): string => nodes.map(n => n.type === "text" ? n.mapping.text : n.tag === "rt" ? "" : plain(n.children)).join("");
        const displayTitle = plain(children);
        headings.push({ id, level, title: displayTitle, uri, offset: titleStart, end: start + value.length });
        body.children.push(element("h" + level, children, { id, "data-running-head": displayTitle })); paragraph = undefined; continue;
      }
      if (!value.length) {
        if (processing.preserveEmptyLines) body.children.push(element("p", [element("br")], { class: "source-blank-line" }));
        paragraph = undefined; continue;
      }
      let content = value, contentStart = start;
      if (!processing.preserveLineIndent || (!paragraph && snapshot.settings.layout.paragraphIndent !== "source")) {
        const leading = /^[ \t　]*/u.exec(content)![0].length; content = content.slice(leading); contentStart += leading;
      }
      if (!paragraph) { paragraph = element("p"); body.children.push(paragraph); }
      else if (processing.hardLineBreaks) paragraph.children.push(element("br"));
      paragraph.children.push(...inline(uri, content, contentStart));
    }
    if (fence) {
      diagnostics.push({ uri, start: fence.start, end: input.length, message: "コードフェンスが閉じられていません。このファイル末尾までコードとして扱います。" });
      body.children.push(element("pre", [element("code", [text(uri, fence.body, fence.contentStart, "text", true)])]));
    }
    if (body.children.length && source !== snapshot.sources.at(-1)) body.children.push(element("p", [element("br")], { class: "source-blank-line" }));
  }
  for (const toc of tocNodes) toc.children = [element("ol", headings.map(h => {
    const label = text(h.uri, h.title, h.offset, "generated", true);
    label.mapping.runs = [{ generatedStart: 0, generatedEnd: h.title.length, sourceStart: h.offset, sourceEnd: h.end, mode: "range" }];
    return element("li", [element("a", [element("span", [label], {class:"ogenkou-toc-label"}), element("span", [], {class:"ogenkou-toc-page", "data-target":"#"+h.id})], { href: "#" + h.id })], { class: "ogenkou-toc-entry", "data-section-level": String(h.level) });
  }), { class: "ogenkou-toc-list" })];

  // HTML parsers merge adjacent TextNodes. Merge our model before deriving childNodes paths.
  const coalesce = (node: Element) => {
    const merged: Node[] = [];
    for (const child of node.children) {
      if (child.type === "element") coalesce(child);
      const previous = merged.at(-1);
      if (previous?.type === "text" && child.type === "text" && previous.mapping.uri === child.mapping.uri && previous.mapping.kind === child.mapping.kind) {
        const shift = previous.mapping.text.length;
        previous.mapping.text += child.mapping.text;
        previous.mapping.runs.push(...child.mapping.runs.map(run => ({ ...run, generatedStart: run.generatedStart + shift, generatedEnd: run.generatedEnd + shift })));
      } else if (child.type !== "text" || child.mapping.text.length) merged.push(child);
    }
    node.children = merged;
  };
  coalesce(body);
  const sourceMap: CompiledDocument["sourceMap"] = [], finalMappings: TextMapping[] = [];
  const serialize = (node: Node, path: number[]): string => {
    if (node.type === "text") {
      sourceMap.push({ path, key: node.mapping.key, text: node.mapping.text, kind: node.mapping.kind }); finalMappings.push(node.mapping);
      return escape(node.mapping.text);
    }
    const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
    const content = node.children.map((child, index) => serialize(child, [...path, index])).join("");
    return `<${node.tag}${attrs}>${content}${["br", "img"].includes(node.tag) ? "" : `</${node.tag}>`}`;
  };
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + escape(snapshot.config.title ?? "") + '</title></head>' + serialize(body, [1]) + '</html>';
  const css = createPublicationCss({ settings: snapshot.settings }) + '\ncode,pre { white-space: pre-wrap; text-indent: 0; }\np { white-space: pre-wrap; }\n'
    + `.ogenkou-emphasis { text-emphasis: ${cssString(processing.emphasis.mark)}; }\n`;
  return immutable({ work: snapshot.work, epoch: snapshot.epoch, revision: snapshot.revision, html, css, sourceMap, mappings: finalMappings, headings, diagnostics, resourceRequests });
}

export function resolveGeneratedPosition(compiled: CompiledDocument, key: string, offset: number) {
  const map = compiled.mappings.find(mapping => mapping.key === key);
  if (!map || !Number.isSafeInteger(offset) || offset < 0 || offset > map.text.length) return undefined;
  const run = map.runs.find(r => offset >= r.generatedStart && offset < r.generatedEnd) ?? (offset === map.text.length ? map.runs.at(-1) : undefined);
  return run ? { revision: compiled.revision, uri: map.uri, start: run.mode === "identity" ? run.sourceStart + offset - run.generatedStart : run.sourceStart,
    end: run.mode === "identity" ? run.sourceStart + offset - run.generatedStart : run.sourceEnd, approximate: run.mode !== "identity" || map.kind === "generated" } : undefined;
}
