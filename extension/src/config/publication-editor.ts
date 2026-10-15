import { applyEdits, modify } from "jsonc-parser";
import { parseProjectConfig } from "../project/project-config.js";
import type { PublicationSettings } from "./publication-settings.js";
import { DEFAULT_FURNITURE, furnitureLayout, validateFurnitureText, parseFurniture } from "./page-furniture.js";

export const BUILTIN_PUBLICATION: PublicationSettings = {
  publication: {title: "", author: ""},
  writingMode: "vertical",
  layout: { ...DEFAULT_FURNITURE, runningHeadMaxLength: "14", columnCount: 1, columnGap: 5, pageSize: "A6", pageMargin: "auto", mirrorMargins: true, fontFamily: ["Yu Mincho", "serif"], fontSize: "9pt", lineHeight: 1.75, charactersPerLine: 40, linesPerPage: 16, paragraphIndent: "source", runningHead: true, pageNumber: true },
  processing: { titlePage: true, toc: true, tocDepth: 3, tocWritingMode: "inherit", tocLineHeight: 2, hardLineBreaks: true, preserveEmptyLines: true, preserveLineIndent: true,
    ruby: { pipeAngle: true, bareKanji: true, bracket: true },
    emphasis: { doubleAngle: true, bracket: true, mark: "﹅" },
    connectedDashes: true, verticalQuotes: true, automaticTcy: true, kanaMarks: true },
};

export interface PublicationField {
  readonly hidden?: boolean;
  readonly key: string;
  readonly label: string;
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export const PUBLICATION_FIELDS: readonly PublicationField[] = [
  { key: "publication.title", label: "作品タイトル" },
  { key: "publication.author", label: "著者" },
  { key: "processing.titlePage", label: "タイトルページを生成する" },
  { key: "layout.runningHeadMaxLength", label: "柱の見出しの最大文字数（空欄の場合省略しない）" },
  { key: "processing.toc", label: "目次を生成する" },
  { key: "processing.tocDepth", label: "目次に含める見出しの深さ", options: ["1", "2", "3", "4", "5", "6"], min: 1, max: 6, integer: true },
  { key: "processing.tocWritingMode", label: "目次の組方向", options: ["inherit", "horizontal", "vertical"] },
  { key: "processing.tocLineHeight", label: "目次の行送り（文字サイズの倍率）", min: 1, max: 4 },
  { key: "layout.pageSize", label: "用紙サイズ" },
  { key: "layout.columnCount", label: "段数", options: ["1", "2", "3", "4"], min: 1, max: 4, integer: true },
  { key: "layout.columnGap", label: "段間隔（mm）", min: 0, max: 50 },
  { key: "layout.charactersPerLine", label: "一段の一行の文字数", min: 5, max: 100, integer: true },
  { key: "layout.linesPerPage", label: "一段の行数", min: 5, max: 80, integer: true },
  { key: "layout.fontSize", label: "文字サイズ（pt）" },
  { key: "layout.lineHeight", label: "行送り（文字サイズの倍率）", min: 1, max: 4 },
  { key: "layout.pageMargin", label: "余白" },
  { hidden: true, key: "layout.mirrorMargins", label: "ノド・小口の余白を反転する" },
  { key: "layout.fontFamily", label: "フォントの優先順（カンマ区切り）" },
  { key: "writingMode", label: "組方向", options: ["vertical", "horizontal"] },
  { hidden: true, key: "layout.runningHead", label: "柱を表示" },
  { hidden: true, key: "layout.pageNumber", label: "ノンブルを表示" },
  { hidden: true, key: "layout.furnitureMode", label: "上部・下部の形式", options: ["legacy", "custom"] },
  { key: "layout.topFontFamily", label: "フォントの優先順（カンマ区切り）" },
  { key: "layout.topFontSize", label: "上部の文字サイズ（pt）" },
  { key: "layout.topDistance", label: "上部の紙端からの距離（mm）", min: 0, max: 50 },
  { key: "layout.topLeftAlign", label: "左ページの配置", options: ["left", "center", "right", "none"] },
  { key: "layout.topLeftText", label: "左ページの表記" },
  { key: "layout.topRightAlign", label: "右ページの配置", options: ["left", "center", "right", "none"] },
  { key: "layout.topRightText", label: "右ページの表記" },
  { key: "layout.bottomFontFamily", label: "フォントの優先順（カンマ区切り）" },
  { key: "layout.bottomFontSize", label: "下部の文字サイズ（pt）" },
  { key: "layout.bottomDistance", label: "下部の紙端からの距離（mm）", min: 0, max: 50 },
  { key: "layout.bottomLeftAlign", label: "左ページの配置", options: ["left", "center", "right", "none"] },
  { key: "layout.bottomLeftText", label: "左ページの表記" },
  { key: "layout.bottomRightAlign", label: "右ページの配置", options: ["left", "center", "right", "none"] },
  { key: "layout.bottomRightText", label: "右ページの表記" },
  { key: "processing.hardLineBreaks", label: "原稿の改行を保持する" },
  { key: "processing.preserveEmptyLines", label: "空行を保持する" },
  { key: "processing.preserveLineIndent", label: "行頭の字下げを保持する" },
  { key: "layout.paragraphIndent", label: "段落字下げ", options: ["source", "1em", "none"] },
  { key: "processing.ruby.pipeAngle", label: "\"｜親文字《読み》\"をルビに変換する" },
  { key: "processing.ruby.bareKanji", label: "\"漢字《読み》\"をルビに変換する" },
  { key: "processing.ruby.bracket", label: "\"[[rb:親文字>読み]]\"をルビに変換する" },
  { key: "processing.emphasis.doubleAngle", label: "\"《《本文》》\"を傍点に変換する" },
  { key: "processing.emphasis.bracket", label: "\"[[emphasismark:本文]]\"を傍点に変換する" },
  { key: "processing.emphasis.mark", label: "傍点の記号" },
  { key: "processing.connectedDashes", label: "連続するダッシュを連結する" },
  { key: "processing.verticalQuotes", label: "縦書きの引用符を調整する" },
  { key: "processing.automaticTcy", label: "縦中横を自動で適用する（縦書きのみ）" },
  { key: "processing.kanaMarks", label: "かな・カナへの濁点、半濁点を合成する（縦書きのみ）" },
];

export function publicationValues(settings: PublicationSettings): Record<string, unknown> {
  settings = { ...settings, publication: settings.publication ?? {title: "", author: ""}, processing: { ...settings.processing, titlePage: settings.processing.titlePage ?? true, tocWritingMode: settings.processing.tocWritingMode ?? "inherit", tocLineHeight: settings.processing.tocLineHeight ?? 2, tocDepth: settings.processing.tocDepth ?? 3 } };
  settings = { ...settings, layout: furnitureLayout({ ...settings.layout, runningHeadMaxLength: settings.layout.runningHeadMaxLength ?? "14", columnCount: settings.layout.columnCount ?? 1, columnGap: settings.layout.columnGap ?? 5, mirrorMargins: settings.layout.mirrorMargins ?? false }) };
  return Object.fromEntries(PUBLICATION_FIELDS.map(({ key }) => [key,
    key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], settings)]));
}

export function validatePublicationValues(value: unknown, strict = true): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("設定値が不正です。");
  for (const [key, item] of Object.entries(value)) {
    const field = PUBLICATION_FIELDS.find((field) => field.key === key);
    if (!field) throw new Error("未対応の設定項目です。");
    if (/^layout\.(?:top|bottom|furnitureMode)/.test(key)) parseFurniture({ [key.slice(7)]: item });
    const sample = publicationValues(BUILTIN_PUBLICATION)[key];
    if (Array.isArray(sample)) {
      if (!Array.isArray(item) || (!item.length && !/(?:top|bottom)FontFamily$/.test(key)) || item.length > 32 || !item.every((entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 256)) throw new Error(`${field.label}を指定してください。`);
    } else if (typeof item !== typeof sample) throw new Error(`${field.label}の値が不正です。`);
    if (field.options && !field.options.includes(String(item))) throw new Error(`${field.label}の選択肢が不正です。`);
    if (typeof item === "number" && (!Number.isFinite(item) || (strict && (item < field.min! || item > field.max! || (field.integer && !Number.isInteger(item)))))) throw new Error(`${field.label}は${field.min}〜${field.max}で指定してください。`);
    if (key === "layout.runningHeadMaxLength") { if (typeof item !== "string" || (item !== "" && (!/^\d+$/.test(item) || Number(item) < 1 || Number(item) > 1000))) throw new Error("見出しの最大文字数は1〜1000、または空欄で指定してください。"); continue; }
    if (key.startsWith("publication.")) { if (typeof item !== "string" || item.length>512 || /[\r\n\u0000-\u001f]/u.test(item)) throw new Error("タイトル・著者は512文字以内の一行で指定してください。"); continue; }
    const template = /(?:top|bottom)(?:Left|Right)Text$/.test(key);
    if (template && typeof item === "string") { validateFurnitureText(item); continue; }
    if (typeof item === "string" && (!item.trim() || item.length > 512 || /[;{}\r\n]/.test(item))) throw new Error(`${field.label}の値が不正です。`);
    if (strict && (key === "layout.fontSize" || /(?:top|bottom)FontSize$/.test(key)) && typeof item === "string" && (!/^(?:\d+(?:\.\d+)?|\.\d+)pt$/i.test(item.trim()) || parseFloat(item)<=0 || parseFloat(item)>100)) throw new Error("文字サイズは 9pt のようにptで指定してください。");
    if (strict && key === "layout.pageSize" && typeof item === "string" && !/^(?:A[0-6]|B[0-6]|JIS-B[3-6]|letter|legal)(?:\s+(?:portrait|landscape))?$|^(?:\d+(?:\.\d+)?)(?:mm|cm|in|pt|px)\s*[, ]\s*(?:\d+(?:\.\d+)?)(?:mm|cm|in|pt|px)$/i.test(item.trim())) throw new Error("用紙サイズは A5 または 115mm,167mm などで指定してください。");
    if (strict && key === "layout.pageMargin" && typeof item === "string" && item.trim() !== "auto" && !/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:mm|cm|in|pt|px|em|rem|%))(?:\s+(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:mm|cm|in|pt|px|em|rem|%))){0,3}$/i.test(item.trim())) throw new Error("余白は auto または 15mm 12mm などで指定してください。");
  }
}

export function applyPublicationValues(base: PublicationSettings, values: Record<string, unknown>, strict = true): PublicationSettings {
  validatePublicationValues(values, strict);
  const result = structuredClone({ ...base, publication: base.publication ?? {title:"",author:""}, layout: furnitureLayout(base.layout) });
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split(".");
    const last = parts.pop()!;
    const parent = parts.reduce<unknown>((object, part) => (object as Record<string, unknown>)[part], result) as Record<string, unknown>;
    parent[last] = structuredClone(value);
  }
  return Object.keys(values).some((key) => /^layout\.(top|bottom)/.test(key))
    ? { ...result, layout: { ...result.layout, furnitureMode: "custom" } } : result;
}

const PROCESSING_KEYS: Record<string, string> = {
  "ruby.pipeAngle": "pipeAngleRuby", "ruby.bareKanji": "bareKanjiRuby", "ruby.bracket": "bracketRuby",
  "emphasis.doubleAngle": "doubleAngleEmphasis", "emphasis.bracket": "bracketEmphasis", "emphasis.mark": "emphasisMark",
};

export function editProjectPublication(text: string, values: Record<string, unknown>, freeze = false): string {
  const project = parseProjectConfig(text); // Refuse malformed JSONC before attempting edits.
  validatePublicationValues(values, !freeze);
  const set = (path: string[], value: unknown) => {
    text = applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" } }));
  };
  if (!freeze && project.overrides.layout?.furnitureMode !== "custom"
    && Object.keys(values).some((key) => /^layout\.(top|bottom)/.test(key))) {
    // Copy every visible suggestion before switching a legacy split layout;
    // ordinary body-font edits may have changed those suggestions meanwhile.
    const suggestions = publicationValues(rawProjectPublication(BUILTIN_PUBLICATION, text));
    for (const [key, value] of Object.entries(suggestions)) {
      if (/^layout\.(top|bottom)/.test(key)) set(["overrides", ...key.split(".")], value);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("publication.")) { if (freeze && value === "" && (key === "publication.title" ? project.title : project.author) === undefined) continue; set(key.split("."),value); if (key === "publication.title") set(["title"],undefined); continue; }
    const mapped = key.startsWith("processing.") ? ["processing", PROCESSING_KEYS[key.slice(11)] ?? key.slice(11)] : key.split(".");
    set(["overrides", ...mapped], value);
    if (key === "layout.pageSize" && project.pageSize !== undefined) set(["page", "size"], undefined);
  }
  if (!freeze && Object.keys(values).some((key) => /^layout\.(top|bottom)/.test(key))) set(["overrides", "layout", "furnitureMode"], "custom");
  if (freeze) set(["settingsVersion"], 1);
  return text;
}

/** Preserve dormant vertical options when freezing a horizontal publication. */
export function rawProjectPublication(base: PublicationSettings, text: string): PublicationSettings {
  const project = parseProjectConfig(text);
  const op = project.overrides.processing;
  return {
    publication: {title:project.title ?? "", author:project.author ?? ""},
    writingMode: project.overrides.writingMode ?? base.writingMode,
    layout: furnitureLayout({ ...base.layout, ...project.overrides.layout, columnCount: project.overrides.layout?.columnCount ?? 1, columnGap: project.overrides.layout?.columnGap ?? 5, mirrorMargins: project.overrides.layout?.mirrorMargins ?? false, furnitureMode: project.overrides.layout?.furnitureMode ?? "legacy", ...(project.pageSize ? { pageSize: project.pageSize } : {}) }),
    processing: { ...base.processing, ...op, ruby: { ...base.processing.ruby, ...op?.ruby }, emphasis: { ...base.processing.emphasis, ...op?.emphasis } },
  };
}
