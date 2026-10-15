export type FurnitureAlignment = "left" | "center" | "right" | "none";
export interface PageFurniture {
  readonly furnitureMode?: "legacy" | "custom";
  readonly topFontFamily?: readonly string[];
  readonly topFontSize?: string;
  readonly topDistance?: number;
  readonly topLeftAlign?: FurnitureAlignment;
  readonly topLeftText?: string;
  readonly topRightAlign?: FurnitureAlignment;
  readonly topRightText?: string;
  readonly bottomFontFamily?: readonly string[];
  readonly bottomFontSize?: string;
  readonly bottomDistance?: number;
  readonly bottomLeftAlign?: FurnitureAlignment;
  readonly bottomLeftText?: string;
  readonly bottomRightAlign?: FurnitureAlignment;
  readonly bottomRightText?: string;
}
export const DEFAULT_FURNITURE = {
  furnitureMode: "custom", topFontFamily: [], topFontSize: "7pt", topDistance: 3,
  topLeftAlign: "left", topLeftText: "$page$　$title$", topRightAlign: "right", topRightText: "$page$",
  bottomFontFamily: [], bottomFontSize: "7pt", bottomDistance: 3,
  bottomLeftAlign: "none", bottomLeftText: "$page$", bottomRightAlign: "none", bottomRightText: "$page$",
} as const;

/** Split legacy boxes stay active until the user edits their replacement. */
export function furnitureLayout<T extends PageFurniture & { fontFamily: readonly string[]; runningHead: boolean; pageNumber: boolean }>(layout: T): Omit<T, keyof PageFurniture> & Required<PageFurniture> {
  const mode = layout.furnitureMode ?? "legacy";
  const number = layout.pageNumber ? "$page$" : "";
  const head = layout.runningHead ? "$h1$" : "";
  return { ...DEFAULT_FURNITURE, ...layout,
    ...(mode === "legacy" ? { topFontFamily: layout.fontFamily, bottomFontFamily: layout.fontFamily,
      topLeftText: [number, head].filter(Boolean).join("　"), topRightText: [head, number].filter(Boolean).join("　") } : {}),
    furnitureMode: mode } as Omit<T, keyof PageFurniture> & Required<PageFurniture>;
}
export function validateFurnitureText(text: string): void {
  if (text.length > 256 || /[\r\n\u0000-\u001f]/u.test(text)) throw new Error("上部・下部の表記は256文字以内の一行で指定してください。");
  for (const token of text.match(/\$[^$]*\$/gu) ?? []) {
    if (!/^\$(?:page|title|h[1-5])\$$/u.test(token)) throw new Error(`未対応の置換記号です: ${token}`);
  }
}
export function parseFurniture(value: Record<string, unknown>): PageFurniture {
  const result: Record<string, unknown> = {};
  for (const [key, sample] of Object.entries(DEFAULT_FURNITURE)) {
    const item = value[key];
    if (item === undefined) continue;
    if (Array.isArray(sample)) {
      if (!Array.isArray(item) || item.length > 32 || !item.every((name) => typeof name === "string" && name.trim() && name.length <= 256)) throw new Error(`${key}はフォント名の配列で指定してください。`);
    } else if (typeof item !== typeof sample) throw new Error(`${key}の型が不正です。`);
    if (key.endsWith("Align") && !["left", "center", "right", "none"].includes(String(item))) throw new Error(`${key}の配置が不正です。`);
    if (key === "furnitureMode" && item !== "legacy" && item !== "custom") throw new Error("上部・下部の形式が不正です。");
    if (key.endsWith("Text")) validateFurnitureText(item as string);
    if (key.endsWith("Distance") && (!Number.isFinite(item) || Number(item) < 0 || Number(item) > 50)) throw new Error("紙端からの距離は0〜50mmで指定してください。");
    if (key.endsWith("FontSize") && (!/^(?:\d+(?:\.\d+)?|\.\d+)pt$/iu.test(String(item)) || parseFloat(String(item)) <= 0 || parseFloat(String(item)) > 100)) throw new Error("上部・下部の文字サイズは0より大きい100pt以下で指定してください。");
    result[key] = item;
  }
  return result as PageFurniture;
}
export function cssString(text: string): string {
  return '"' + text.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/[\r\n\f]/gu, "\\a ") + '"';
}
export function furnitureContent(text: string): string {
  validateFurnitureText(text);
  const parts: string[] = [];
  let offset = 0;
  for (const token of text.matchAll(/\$(page|title|h[1-5])\$/gu)) {
    if (token.index > offset) parts.push(cssString(text.slice(offset, token.index)));
    parts.push(token[1] === "page" ? "counter(page)" : token[1] === "title" ? "env(doc-title)" : `string(ogenkou-${token[1]}, first)`);
    offset = token.index + token[0].length;
  }
  if (offset < text.length) parts.push(cssString(text.slice(offset)));
  return parts.join(" ") || "none";
}
