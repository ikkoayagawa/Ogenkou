export type WritingMode = "vertical" | "horizontal";
export type ParagraphIndent = "source" | "1em" | "none";
import type { PageFurniture } from "./page-furniture.js";

export interface PublicationSettings {
  readonly publication?: { readonly title: string; readonly author: string };
  readonly writingMode: WritingMode;
  readonly layout: PageFurniture & {
    readonly runningHeadMaxLength?: string;
    readonly columnCount?: number;
    readonly columnGap?: number;
    readonly pageSize: string;
    readonly pageMargin: string;
    readonly mirrorMargins?: boolean;
    readonly fontFamily: readonly string[];
    readonly fontSize: string;
    readonly lineHeight: number;
    readonly charactersPerLine: number;
    readonly linesPerPage: number;
    readonly paragraphIndent: ParagraphIndent;
    readonly runningHead: boolean;
    readonly pageNumber: boolean;
  };
  readonly processing: {
    readonly titlePage?: boolean;
    readonly toc?: boolean;
    readonly tocDepth?: number;
    readonly tocWritingMode?: "inherit" | "horizontal" | "vertical";
    readonly tocLineHeight?: number;
    readonly hardLineBreaks: boolean;
    readonly preserveEmptyLines: boolean;
    readonly preserveLineIndent: boolean;
    readonly ruby: {
      readonly pipeAngle: boolean;
      readonly bareKanji: boolean;
      readonly bracket: boolean;
    };
    readonly emphasis: {
      readonly doubleAngle: boolean;
      readonly bracket: boolean;
      readonly mark: string;
    };
    readonly connectedDashes: boolean;
    readonly verticalQuotes: boolean;
    readonly automaticTcy: boolean;
    readonly kanaMarks: boolean;
  };
}

export interface PublicationOverrides {
  readonly writingMode?: WritingMode;
  readonly layout?: Partial<PublicationSettings["layout"]>;
  readonly processing?: Partial<Omit<PublicationSettings["processing"], "ruby" | "emphasis">> & {
    readonly ruby?: Partial<PublicationSettings["processing"]["ruby"]>;
    readonly emphasis?: Partial<PublicationSettings["processing"]["emphasis"]>;
  };
}

export function resolvePublicationSettings(
  defaults: PublicationSettings,
  overrides: PublicationOverrides,
): PublicationSettings {
  const writingMode = overrides.writingMode ?? defaults.writingMode;
  const op = overrides.processing ?? {};
  const processing: PublicationSettings["processing"] = {
    ...defaults.processing,
    ...op,
    ruby: { ...defaults.processing.ruby, ...(op.ruby ?? {}) },
    emphasis: { ...defaults.processing.emphasis, ...(op.emphasis ?? {}) },
  };
  return {
    publication: defaults.publication,
    writingMode,
    layout: { ...defaults.layout, ...overrides.layout },
    processing: {
      ...processing,
      verticalQuotes: writingMode === "vertical" && processing.verticalQuotes,
      automaticTcy: writingMode === "vertical" && processing.automaticTcy,
      kanaMarks: writingMode === "vertical" && processing.kanaMarks,
    },
  };
}
