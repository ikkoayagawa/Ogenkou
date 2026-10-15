import { calculateLayoutGeometry } from "../config/layout-geometry.js";
import { furnitureLayout, furnitureContent, cssString } from "../config/page-furniture.js";
import { decodePaperSize, PAPER_PRESETS } from "../config/paper-size.js";
import type { PublicationSettings } from "../config/publication-settings.js";
type ResolvedPreviewSource = { settings: PublicationSettings };

export function createPublicationCss(source: Pick<ResolvedPreviewSource, "settings">): string {
  const { layout, writingMode } = source.settings;
  const decoded = decodePaperSize(layout.pageSize, PAPER_PRESETS);
  const size = decoded.width && decoded.height ? `${decoded.width}mm ${decoded.height}mm` : layout.pageSize.replace(",", " ");
  // Keep Core's logical layout viewport tied to paper, not Webview chrome.
  // The actual display viewport still controls fitting, zoom and navigation.
  const paper = decodePaperSize(layout.pageSize, PAPER_PRESETS);
  const margin = publicationMargins(source);
  const family = layout.fontFamily.map((name) => /\s/u.test(name) && !/^['"]/u.test(name) ? `"${name}"` : name).join(", ");
  const indent = layout.paragraphIndent === "source" ? "0" : layout.paragraphIndent;
  const pageNumber = layout.pageNumber ? "counter(page)" : "none";
  const running = layout.runningHead ? "string(chapter-title)" : "none";
  const tocMode = source.settings.processing.tocWritingMode ?? "inherit";
  const tocVertical = tocMode === "inherit" ? writingMode === "vertical" : tocMode === "vertical";
  const geometry = calculateLayoutGeometry({writingMode, ...Object.fromEntries(Object.entries(layout).map(([key,value])=>["layout."+key,value]))}, paper);
  const tocWidth = paper.width && geometry.margins ? `${paper.width-geometry.margins[1]!-geometry.margins[3]!}mm` : "100%";
  const chapterBreak = writingMode === "vertical" ? "recto" : "page";
  return `@charset "UTF-8";
${paper.width && paper.height ? `@-epubx-viewport { width: ${paper.width}mm; height: ${paper.height}mm; }\n` : ""}
@page { size: ${size}; margin: ${margin};
  @top-center { content: none; }
  @bottom-center { content: none; }
}
${createMirrorMarginCss(source)}${layout.furnitureMode === "custom" ? createFurnitureCss(source) : `@page :left {
  @top-left-corner { content: ${pageNumber}; writing-mode: horizontal-tb; font-family: ${family}; font-size: 7pt; line-height: 1.2; white-space: nowrap; text-align: left; vertical-align: top; box-sizing: border-box; padding: 3mm 0 0 5mm; }
  @top-right-corner { content: ${running}; writing-mode: horizontal-tb; font-family: ${family}; font-size: 7pt; line-height: 1.2; white-space: nowrap; overflow: visible; text-align: right; vertical-align: top; box-sizing: border-box; padding: 3mm 5mm 0 0; }
}
@page :right {
  @top-left-corner { content: ${running}; writing-mode: horizontal-tb; font-family: ${family}; font-size: 7pt; line-height: 1.2; white-space: nowrap; overflow: visible; text-align: left; vertical-align: top; box-sizing: border-box; padding: 3mm 0 0 5mm; }
  @top-right-corner { content: ${pageNumber}; writing-mode: horizontal-tb; font-family: ${family}; font-size: 7pt; line-height: 1.2; white-space: nowrap; text-align: right; vertical-align: top; box-sizing: border-box; padding: 3mm 5mm 0 0; }
}
`}:root { writing-mode: ${writingMode === "vertical" ? "vertical-rl" : "horizontal-tb"}; color: #111; background: #fff;${(layout.columnCount ?? 1) > 1 ? ` column-count: ${layout.columnCount}; column-gap: ${layout.columnGap ?? 5}mm;` : ""} }
body { font-family: ${family}; font-size: ${layout.fontSize}; line-height: ${layout.lineHeight}; text-spacing: auto; text-align: justify; orphans: 1; widows: 1; }
h1 { string-set: chapter-title attr(data-running-head); break-before: ${chapterBreak}; }
${layout.furnitureMode !== "custom" ? "" : Array.from({ length: 5 }, (_, i) => `h${i + 1} { string-set: ${i === 0 ? "chapter-title attr(data-running-head), " : ""}ogenkou-h${i + 1} attr(data-running-head); }`).join("\n")}
h1 { font-size: 1.6em; margin-block-end: 3em; }
h2 { break-before: page; font-size: 1.15em; margin-block-end: 2em; }
h1, h2 { break-after: avoid; }
@page ogenkou-title { margin: 0; --vivliostyle-page-content-writing-mode: horizontal-tb; --vivliostyle-page-content-column-count: 1;
${["top-left-corner","top-left","top-center","top-right","top-right-corner","bottom-left-corner","bottom-left","bottom-center","bottom-right","bottom-right-corner"].map(box=>`  @${box} { content: none; }`).join("\n")}
}
.ogenkou-title-page { page: ogenkou-title; break-before: page; break-after: page; box-sizing: border-box; writing-mode: horizontal-tb; width: ${paper.width ?? 105}mm; height: ${(paper.height ?? 148)-.1}mm; margin: 0; padding: ${(paper.height ?? 148)/2}mm 0 0; text-align: center; column-span: all; }
.ogenkou-title-content { display: inline-block; vertical-align: top; width: 80%; margin: 0; transform: translateY(-50%); text-align: center; }
.ogenkou-title-text { font-size: 1.8em; font-weight: normal; text-align: center; text-indent: 0; }
.ogenkou-title-author { margin-top: 2em; text-align: center; text-indent: 0; }
@page ogenkou-toc { --vivliostyle-page-content-writing-mode: ${tocVertical ? "vertical-rl" : "horizontal-tb"}; --vivliostyle-page-content-column-count: 1; }
.ogenkou-toc { page: ogenkou-toc; break-before: left; width: ${tocWidth}; break-after: page; column-span: all; writing-mode: ${tocVertical ? "vertical-rl" : "horizontal-tb"}; line-height: ${source.settings.processing.tocLineHeight ?? 2}; }
.ogenkou-toc-title { break-before: auto; string-set: none; }
.ogenkou-toc-list { margin: 0; padding: 0; list-style: none; }
.ogenkou-toc-entry { margin: 0; padding: 0; }
.ogenkou-toc-entry[data-section-level="2"] { margin-inline-start: 1em; }
.ogenkou-toc-entry[data-section-level="3"] { margin-inline-start: 2em; }
.ogenkou-toc-entry > a { color: inherit; text-decoration: none; display: block; padding-inline-end: 2em; }
.ogenkou-toc-page { display: inline-block; inline-size: 2em; margin-inline-end: -2em; text-align: end; }
.ogenkou-toc-label::after { content: leader("…"); }
.ogenkou-toc-page::after { content: target-counter(attr(data-target), page); -webkit-text-combine: ${tocVertical ? "horizontal" : "none"}; text-combine-upright: ${tocVertical ? "all" : "none"}; white-space: nowrap; }
.ogenkou-preview-grid-table { display: block; width: 100%; }
.ogenkou-preview-grid-table > thead,
.ogenkou-preview-grid-table > tbody { display: block; }
.ogenkou-preview-grid-table > :is(thead, tbody) > tr {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
}
.ogenkou-preview-grid-table > :is(thead, tbody) > tr > :is(th, td) { display: block; }
p { text-indent: ${indent}; margin-block: 0; hanging-punctuation: allow-end; text-spacing-trim: space-start allow-end ideograph-alpha ideograph-numeric; }
.ogenkou-tcy { -webkit-text-combine: horizontal; text-combine-upright: all; text-orientation: upright; }
.connected-dashes { display: inline-block; text-combine-upright: none; letter-spacing: 0; white-space: nowrap; -webkit-text-fill-color: transparent; background-image: linear-gradient(currentColor, currentColor); background-repeat: no-repeat; background-position: center; background-size: ${writingMode === "vertical" ? ".03em 100%" : "100% .03em"}; }
.ogenkou-emphasis { text-emphasis: filled sesame; }
.source-blank-line { margin: 0; text-indent: 0; }
.kana-mark { display: inline-block; position: relative; width: 1em; height: 1em; line-height: 1; text-indent: 0; white-space: nowrap; }
.kana-mark-source { position: absolute; width: 0; height: 0; overflow: hidden; }
.kana-mark::after { content: "\u309b"; position: absolute; writing-mode: horizontal-tb; text-orientation: mixed; text-combine-upright: none; font-family: inherit; font-size: 1em; line-height: 1; width: 1em; height: 1em; top: -.12em; right: -.65em; }
.kana-mark-semi::after { content: "\u309c"; }
`;
}

function publicationMargins(source: Pick<ResolvedPreviewSource, "settings">): string {
  const configured = source.settings.layout.pageMargin.trim();
  if (configured !== "auto") return configured;
  const values = { writingMode: source.settings.writingMode, ...Object.fromEntries(Object.entries(source.settings.layout).map(([key, value]) => ["layout." + key, value])) };
  const geometry = calculateLayoutGeometry(values, decodePaperSize(source.settings.layout.pageSize, PAPER_PRESETS));
  if (!geometry.margins) return "12%";
  const [top, right] = geometry.margins;
  return `${top!.toFixed(2)}mm ${right!.toFixed(2)}mm`;
}

function createMirrorMarginCss(source: Pick<ResolvedPreviewSource, "settings">): string {
  if (!source.settings.layout.mirrorMargins || source.settings.layout.pageMargin === "auto") return "";
  const parts = publicationMargins(source).split(/\s+/u);
  const [top, inner = top, bottom = top, outer = inner] = parts;
  return `@page :left { margin: ${top} ${inner} ${bottom} ${outer}; }\n@page :right { margin: ${top} ${outer} ${bottom} ${inner}; }\n`;
}

function createFurnitureCss(source: Pick<ResolvedPreviewSource, "settings">): string {
  const layout = furnitureLayout(source.settings.layout);
  const paperWidth = decodePaperSize(layout.pageSize, PAPER_PRESETS).width;
  const margins = publicationMargins(source).split(/\s+/u);
  const physicalMargin = (value: string) => paperWidth !== undefined && value.endsWith("%") ? `${paperWidth * parseFloat(value) / 100}mm` : value;
  const rightMargin = physicalMargin(margins[1] ?? margins[0]!);
  const leftMargin = physicalMargin(margins[3] ?? margins[1] ?? margins[0]!);
  const names = ["top-left-corner", "top-left", "top-center", "top-right", "top-right-corner", "bottom-left-corner", "bottom-left", "bottom-center", "bottom-right", "bottom-right-corner"];
  let css = "@page { " + names.map((name) => "@" + name + " { content: none; }").join(" ") + " }\n";
  for (const region of ["top", "bottom"] as const) {
    const configuredFamily = layout[(region + "FontFamily") as "topFontFamily" | "bottomFontFamily"];
    const family = (configuredFamily.length ? configuredFamily : source.settings.layout.fontFamily).map((name) => /^(serif|sans-serif|monospace|system-ui|cursive|fantasy)$/u.test(name) ? name : cssString(name)).join(", ");
    const size = layout[(region + "FontSize") as "topFontSize" | "bottomFontSize"];
    const distance = layout[(region + "Distance") as "topDistance" | "bottomDistance"];
    for (const side of ["Left", "Right"] as const) {
      const align = layout[(region + side + "Align") as "topLeftAlign" | "topRightAlign" | "bottomLeftAlign" | "bottomRightAlign"];
      if (align === "none") continue;
      const text = layout[(region + side + "Text") as "topLeftText" | "topRightText" | "bottomLeftText" | "bottomRightText"];
      const box = region + "-center";
      // Extend the central box to the physical paper edges. Corner boxes can
      // clip right-aligned strings in PDF even when overflow is visible.
      const width = paperWidth === undefined ? " width: 100%;" : ` width: ${paperWidth}mm; margin-left: calc(0px - ${source.settings.layout.mirrorMargins && side === "Right" ? rightMargin : leftMargin}); margin-right: calc(0px - ${source.settings.layout.mirrorMargins && side === "Right" ? leftMargin : rightMargin});`;
      const padding = region === "top" ? `${distance}mm 5mm 0 5mm` : `0 5mm ${distance}mm 5mm`;
      css += "@page :" + side.toLowerCase() + " { @" + box + " { content: " + furnitureContent(text)
        + "; writing-mode: horizontal-tb; font-family: " + family + "; font-size: " + size
        + "; line-height: 1.2; white-space: nowrap; overflow: visible; text-align: " + align
        + "; vertical-align: " + (region === "top" ? "top" : "bottom") + "; box-sizing: border-box;" + width + " padding: " + padding + "; } }\n";
    }
  }
  return css;
}
