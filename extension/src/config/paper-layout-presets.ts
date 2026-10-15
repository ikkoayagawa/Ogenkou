import { DEFAULT_FURNITURE } from "./page-furniture.js";
import { PAPER_PRESETS, decodePaperSize } from "./paper-size.js";
import type { WritingMode } from "./publication-settings.js";

export type PaperLayoutPresets = Record<string, Record<string, unknown>>;
export const PAPER_LAYOUT_KEYS = ["layout.runningHeadMaxLength","layout.columnCount", "layout.columnGap", "layout.fontSize", "layout.lineHeight", "layout.charactersPerLine", "layout.linesPerPage", "layout.furnitureMode", ...Object.keys(DEFAULT_FURNITURE).filter(key => key !== "furnitureMode").map(key => "layout." + key)];
export function capturePaperLayout(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PAPER_LAYOUT_KEYS.map(key => [key, structuredClone(values[key])]));
}
export function paperLayoutKey(pageSize: string, writingMode: WritingMode): string | undefined {
  const decoded=decodePaperSize(pageSize,PAPER_PRESETS);const paper = decoded.preset!=="custom"?decoded.preset:PAPER_PRESETS.find(p=>p.width===decoded.height&&p.height===decoded.width)?.name??"custom";
  return paper === "custom" ? undefined : `${writingMode}:${paper}`;
}
/** Editable starting points, not an industry standard; A6 retains the existing body layout. */
export function builtInPaperLayouts(): PaperLayoutPresets {
  // paper: columns, gap(mm), font(pt), characters/column, lines/column
  const layouts: Record<string, readonly number[]> = {
    A3: [2, 8, 11, 48, 40], A4: [2, 6, 10.5, 34, 28], A5: [2, 5, 9, 26, 22], A6: [1, 5, 9, 40, 16],
    B3: [3, 8, 11, 40, 48], B4: [2, 6, 10.5, 40, 34], B5: [2, 5, 9, 32, 26], B6: [1, 5, 9, 46, 18],
  };
  const result: PaperLayoutPresets = {};
  for (const paper of PAPER_PRESETS) for (const mode of ["vertical", "horizontal"] as const) {
    const [count, gap, size, chars, lines] = layouts[paper.name]!;
    const font = size! * 25.4 / 72;
    result[`${mode}:${paper.name}`] = {
      "layout.runningHeadMaxLength": "14", "layout.columnCount": count, "layout.columnGap": gap, "layout.fontSize": size + "pt", "layout.lineHeight": 1.75,
      "layout.charactersPerLine": mode === "vertical" ? chars : Math.floor(((paper.width - 20) - gap! * (count! - 1)) / count! / font),
      "layout.linesPerPage": mode === "vertical" ? lines : Math.floor((paper.height - 25) / (font * 1.75)),
      ...Object.fromEntries(Object.entries({ ...DEFAULT_FURNITURE, topFontFamily: [], bottomFontFamily: [] }).map(([key, value]) => ["layout." + key, structuredClone(value)])),
    };
  }
  return result;
}
