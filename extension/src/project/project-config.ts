import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parseFurniture } from "../config/page-furniture.js";
import type { ParagraphIndent, PublicationOverrides, WritingMode } from "../config/publication-settings.js";

export interface OgenkouProjectConfig {
  readonly settingsVersion?: 1;
  readonly title?: string;
  readonly author?: string;
  readonly language?: string;
  readonly readingProgression?: "ltr" | "rtl";
  readonly theme: readonly string[];
  readonly style?: string;
  readonly userStyle?: string;
  readonly pageSize?: string;
  readonly quickPreview: boolean;
  readonly overrides: PublicationOverrides;
}

const DEFAULT_CONFIG: OgenkouProjectConfig = {
  theme: [],
  quickPreview: true,
  overrides: {},
};

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`作品設定 ${key} は文字列で指定してください。`);
  }
  return value;
}

function asObject(value: unknown, key: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`作品設定 ${key} はオブジェクトで指定してください。`);
  }
  return value as Record<string, unknown>;
}

function themes(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error("作品設定 theme は文字列または文字列の配列で指定してください。");
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`作品設定 ${key} は boolean で指定してください。`);
  return value;
}

function optionalNumber(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`作品設定 ${key} は数値で指定してください。`);
  }
  return value;
}

function parseOverrides(value: unknown): PublicationOverrides {
  const root = asObject(value, "overrides");
  const layout = asObject(root.layout, "overrides.layout");
  const processing = asObject(root.processing, "overrides.processing");
  if (processing.tocDepth !== undefined && (typeof processing.tocDepth !== "number" || !Number.isInteger(processing.tocDepth) || processing.tocDepth < 1 || processing.tocDepth > 6)) throw new Error("目次の深さは1〜6の整数で指定してください。");
  if (processing.tocWritingMode !== undefined && !["inherit", "horizontal", "vertical"].includes(String(processing.tocWritingMode))) throw new Error("目次の組方向が不正です。");
  if (processing.tocLineHeight !== undefined && (typeof processing.tocLineHeight !== "number" || !Number.isFinite(processing.tocLineHeight) || processing.tocLineHeight<1 || processing.tocLineHeight>4)) throw new Error("目次の行送りは1〜4で指定してください。");
  const writingMode = root.writingMode;
  if (writingMode !== undefined && writingMode !== "vertical" && writingMode !== "horizontal") {
    throw new Error("作品設定 overrides.writingMode は vertical または horizontal で指定してください。");
  }
  const paragraphIndent = layout.paragraphIndent;
  if (layout.columnCount !== undefined && (typeof layout.columnCount !== "number" || !Number.isInteger(layout.columnCount) || layout.columnCount < 1 || layout.columnCount > 4)) throw new Error("段数は1〜4の整数で指定してください。");
  if (layout.columnGap !== undefined && (typeof layout.columnGap !== "number" || !Number.isFinite(layout.columnGap) || layout.columnGap < 0 || layout.columnGap > 50)) throw new Error("段間隔は0〜50mmで指定してください。");
  if (paragraphIndent !== undefined && !["source", "1em", "none"].includes(String(paragraphIndent))) {
    throw new Error("作品設定 overrides.layout.paragraphIndent は source、1em、none のいずれかです。");
  }
  const fontFamily = layout.fontFamily;
  if (fontFamily !== undefined && (!Array.isArray(fontFamily) || !fontFamily.every((item) => typeof item === "string"))) {
    throw new Error("作品設定 overrides.layout.fontFamily は文字列の配列で指定してください。");
  }
  const layoutOverrides = defined({
      ...parseFurniture(layout),
      runningHeadMaxLength: optionalString(layout.runningHeadMaxLength, "overrides.layout.runningHeadMaxLength"),
      columnCount: optionalNumber(layout.columnCount, "overrides.layout.columnCount"),
      columnGap: optionalNumber(layout.columnGap, "overrides.layout.columnGap"),
      pageSize: optionalString(layout.pageSize, "overrides.layout.pageSize"),
      pageMargin: optionalString(layout.pageMargin, "overrides.layout.pageMargin"),
      mirrorMargins: optionalBoolean(layout.mirrorMargins, "overrides.layout.mirrorMargins"),
      fontFamily: fontFamily as string[] | undefined,
      fontSize: optionalString(layout.fontSize, "overrides.layout.fontSize"),
      lineHeight: optionalNumber(layout.lineHeight, "overrides.layout.lineHeight"),
      charactersPerLine: optionalNumber(layout.charactersPerLine, "overrides.layout.charactersPerLine"),
      linesPerPage: optionalNumber(layout.linesPerPage, "overrides.layout.linesPerPage"),
      paragraphIndent: paragraphIndent as ParagraphIndent | undefined,
      runningHead: optionalBoolean(layout.runningHead, "overrides.layout.runningHead"),
      pageNumber: optionalBoolean(layout.pageNumber, "overrides.layout.pageNumber"),
    });
  const maxHead = optionalString(layout.runningHeadMaxLength, "overrides.layout.runningHeadMaxLength");
  if (maxHead !== undefined && maxHead !== "" && (!/^\d+$/.test(maxHead) || Number(maxHead)<1 || Number(maxHead)>1000)) throw new Error("見出しの最大文字数は1〜1000、または空欄で指定してください。");
  const processingOverrides = defined({
      tocWritingMode: processing.tocWritingMode as "inherit" | "horizontal" | "vertical" | undefined,
      tocLineHeight: optionalNumber(processing.tocLineHeight, "overrides.processing.tocLineHeight"),
      titlePage: optionalBoolean(processing.titlePage, "overrides.processing.titlePage"),
      hardLineBreaks: optionalBoolean(processing.hardLineBreaks, "overrides.processing.hardLineBreaks"),
      preserveEmptyLines: optionalBoolean(processing.preserveEmptyLines, "overrides.processing.preserveEmptyLines"),
      preserveLineIndent: optionalBoolean(processing.preserveLineIndent, "overrides.processing.preserveLineIndent"),
      ruby: (() => {
        const pipeAngle = optionalBoolean(processing.pipeAngleRuby, "overrides.processing.pipeAngleRuby");
        const bareKanji = optionalBoolean(processing.bareKanjiRuby, "overrides.processing.bareKanjiRuby");
        const result: { pipeAngle?: boolean; bareKanji?: boolean; bracket?: boolean } = {};
        const bracket = optionalBoolean(processing.bracketRuby, "overrides.processing.bracketRuby");
        if (bracket !== undefined) result.bracket = bracket;
        if (pipeAngle !== undefined) result.pipeAngle = pipeAngle;
        if (bareKanji !== undefined) result.bareKanji = bareKanji;
        return Object.keys(result).length > 0 ? result : undefined;
      })(),
      emphasis: (() => {
        const doubleAngle = optionalBoolean(processing.doubleAngleEmphasis, "overrides.processing.doubleAngleEmphasis");
        const bracket = optionalBoolean(processing.bracketEmphasis, "overrides.processing.bracketEmphasis");
        const mark = optionalString(processing.emphasisMark, "overrides.processing.emphasisMark");
        const result = defined({ doubleAngle, bracket, mark });
        return Object.keys(result).length ? result : undefined;
      })(),
      connectedDashes: optionalBoolean(processing.connectedDashes, "overrides.processing.connectedDashes"),
      toc: optionalBoolean(processing.toc, "overrides.processing.toc"),
      tocDepth: optionalNumber(processing.tocDepth, "overrides.processing.tocDepth"),
      verticalQuotes: optionalBoolean(processing.verticalQuotes, "overrides.processing.verticalQuotes"),
      automaticTcy: optionalBoolean(processing.automaticTcy, "overrides.processing.automaticTcy"),
      kanaMarks: optionalBoolean(processing.kanaMarks, "overrides.processing.kanaMarks"),
    });
  return defined({
    writingMode: writingMode as WritingMode | undefined,
    layout: Object.keys(layoutOverrides).length > 0 ? layoutOverrides : undefined,
    processing: Object.keys(processingOverrides).length > 0 ? processingOverrides : undefined,
  });
}

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function parseProjectConfig(text: string): OgenkouProjectConfig {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(text.replace(/^\uFEFF/u, ""), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const first = errors[0];
    if (first === undefined) {
      throw new Error("作品設定を解析できませんでした。");
    }
    throw new Error(
      `作品設定を解析できません: ${printParseErrorCode(first.error)} (offset ${first.offset})`,
    );
  }
  const root = asObject(parsed, "root");
  if (root.settingsVersion !== undefined && root.settingsVersion !== 1) throw new Error("未対応の作品設定バージョンです。");
  const publication = asObject(root.publication, "publication");
  const title = optionalString(publication.title, "publication.title");
  const titleAlias = optionalString(root.title, "title");
  if (title !== undefined && titleAlias !== undefined && title !== titleAlias) {
    throw new Error("publication.title と title が異なります。作品タイトルを統一してください。");
  }
  const page = asObject(root.page, "page");
  const preview = asObject(root.preview, "preview");

  const readingProgression = publication.readingProgression;
  if (
    readingProgression !== undefined &&
    readingProgression !== "ltr" &&
    readingProgression !== "rtl"
  ) {
    throw new Error("作品設定 publication.readingProgression は ltr または rtl で指定してください。");
  }
  const quickPreview = preview.quick;
  if (quickPreview !== undefined && typeof quickPreview !== "boolean") {
    throw new Error("作品設定 preview.quick はbooleanで指定してください。");
  }

  return {
    ...DEFAULT_CONFIG,
    settingsVersion: root.settingsVersion === 1 ? 1 : undefined,
    title: title ?? titleAlias,
    author: optionalString(publication.author, "publication.author"),
    language: optionalString(publication.language, "publication.language"),
    readingProgression,
    theme: themes(root.theme),
    style: optionalString(root.style, "style"),
    userStyle: optionalString(root.userStyle, "userStyle"),
    pageSize: optionalString(page.size, "page.size"),
    quickPreview: quickPreview ?? DEFAULT_CONFIG.quickPreview,
    overrides: parseOverrides(root.overrides),
  };
}

export function defaultProjectConfig(): OgenkouProjectConfig {
  return DEFAULT_CONFIG;
}
