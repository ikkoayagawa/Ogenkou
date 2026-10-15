/** JIS dimensions from https://www.ddc.co.jp/words/archives/20050805202351.html */
export const PAPER_PRESETS = [
  { name: "A3", width: 297, height: 420 }, { name: "A4", width: 210, height: 297 },
  { name: "A5", width: 148, height: 210 }, { name: "A6", width: 105, height: 148 },
  { name: "B3", width: 364, height: 515 }, { name: "B4", width: 257, height: 364 },
  { name: "B5", width: 182, height: 257 }, { name: "B6", width: 128, height: 182 },
] as const;

/** Self-contained so the same decoder can run in the Webview without a second implementation. */
export function decodePaperSize(value: string, presets: readonly { name: string; width: number; height: number }[]): { preset: string; width?: number; height?: number } {
  const named: Record<string, readonly [number, number]> = {
    A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
    B0: [1000, 1414], B1: [707, 1000], B2: [500, 707], B3: [353, 500], B4: [250, 353], B5: [176, 250], B6: [125, 176],
    "JIS-B3": [364, 515], "JIS-B4": [257, 364], "JIS-B5": [182, 257], "JIS-B6": [128, 182], LETTER: [215.9, 279.4], LEGAL: [215.9, 355.6],
  };
  const parts = value.trim().split(/\s+/);
  let dimensions = named[parts[0]!.toUpperCase()];
  if (dimensions && parts[1]?.toLowerCase() === "landscape") dimensions = [dimensions[1], dimensions[0]];
  if (!dimensions) {
    const match = /^(\d+(?:\.\d+)?)(mm|cm|in|pt|px)\s*[, ]\s*(\d+(?:\.\d+)?)(mm|cm|in|pt|px)$/i.exec(value.trim());
    if (match) {
      const factors: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };
      dimensions = [Number(match[1]) * factors[match[2]!.toLowerCase()]!, Number(match[3]) * factors[match[4]!.toLowerCase()]!];
    }
  }
  if (!dimensions) return { preset: "custom" };
  const preset = presets.find((entry) => Math.abs(entry.width - dimensions![0]) < .001 && Math.abs(entry.height - dimensions![1]) < .001);
  return { preset: preset?.name ?? "custom", width: Number(dimensions[0].toFixed(3)), height: Number(dimensions[1].toFixed(3)) };
}
