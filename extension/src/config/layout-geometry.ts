/** Shared arithmetic for generated CSS and the settings draft; no DOM or font measurement. */
export function calculateLayoutGeometry(values: Record<string, unknown>, paper: { width?: number; height?: number }) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const length = (value: string, reference: number): number | undefined => {
    const match = /^(\d+(?:\.\d+)?|\.\d+)(mm|cm|in|pt|px|%)?$/i.exec(value);
    if (!match || (!match[2] && Number(match[1]) !== 0)) return undefined;
    const factors: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96, "%": reference / 100 };
    return Number(match[1]) * (match[2] ? factors[match[2].toLowerCase()]! : 1);
  };
  const width = paper.width;
  const height = paper.height;
  if (width !== undefined && height !== undefined && (width <= 0 || height <= 0)) return { margins: undefined, warnings, errors: ["用紙寸法は0より大きい値にしてください。"] };
  if (!width || !height) return { margins: undefined, warnings: ["用紙寸法を解決できないため、版面の事前計算はできません。auto余白は12%を使います。"], errors };
  const font = length(String(values["layout.fontSize"]), width);
  if (font !== undefined && font <= 0) return { margins: undefined, warnings, errors: ["文字サイズは0より大きい値にしてください。"] };
  const columns = Number(values["layout.columnCount"] ?? 1);
  const gap = Number(values["layout.columnGap"] ?? 5);
  const lineHeight = Number(values["layout.lineHeight"]);
  const vertical = values.writingMode === "vertical";
  const inline = font === undefined ? undefined : font * Number(values["layout.charactersPerLine"]) * columns + gap * (columns - 1);
  const block = font === undefined ? undefined : font * lineHeight * Number(values["layout.linesPerPage"]);
  const configured = String(values["layout.pageMargin"]).trim();
  let margins: number[] | undefined;
  if (configured === "auto") {
    if (font === undefined || inline === undefined || block === undefined) warnings.push("この文字単位は事前計算できません。auto余白は12%を使います。");
    else {
      const top = Math.max(5, (height - (vertical ? inline : block)) / 2);
      const side = Math.max(5, (width - (vertical ? block : inline)) / 2);
      margins = [top, side, top, side].map(value => Number(value.toFixed(2)));
      if ((vertical ? inline : block) > height - 10 + .01 || (vertical ? block : inline) > width - 10 + .01) warnings.push("指定した文字数・行数は用紙に収まりません。auto余白は最低5mmを確保するため、実際の文字数・行数は指定より少なくなります。");
    }
  } else {
    const lengths = configured.split(/\s+/).map(token => length(token, width));
    if (lengths.length >= 1 && lengths.length <= 4 && lengths.every(value => value !== undefined)) {
      const [top, right = top, bottom = top, left = right] = lengths as number[];
      margins = [top!, right!, bottom!, left!];
    } else warnings.push("相対単位の余白はフォントなどに依存するため、事前計算できません。");
  }
  if (margins) {
    const usableWidth = width - margins[1]! - margins[3]!;
    const usableHeight = height - margins[0]! - margins[2]!;
    const perColumn = ((vertical ? usableHeight : usableWidth) - gap * (columns - 1)) / columns;
    if (usableWidth <= 0 || usableHeight <= 0 || perColumn <= 0) errors.push("余白または段間隔が大きすぎて本文の版面を確保できません。");
    if(configured !== "auto" && inline !== undefined && block !== undefined && ((vertical ? inline : block) > usableHeight + .01 || (vertical ? block : inline) > usableWidth + .01))warnings.push("指定した文字数・行数はカスタム余白の本文領域に収まりません。カスタムでは指定余白を優先し、実際の文字数・行数はフォント・禁則・ルビ等で決まります。");
    for (const region of ["top", "bottom"]) {
      const visible = ["Left", "Right"].some(side => values["layout." + region + side + "Align"] !== "none" && String(values["layout." + region + side + "Text"] ?? "").length > 0);
      const size = length(String(values["layout." + region + "FontSize"]), width);
      if (visible && size !== undefined && Number(values["layout." + region + "Distance"]) + size * 1.2 > margins[region === "top" ? 0 : 2]! + .01) warnings.push((region === "top" ? "上部" : "下部") + "の柱・ノンブルが本文に重なる可能性があります。余白または紙端からの距離・文字サイズを調整してください。");
    }
  }
  return { margins, warnings, errors };
}
