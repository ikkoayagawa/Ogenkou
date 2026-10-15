// AGPL-3.0-only. Pure Japanese transforms copied from Ogenkou runtime/processors/document.mjs.
import type { PublicationSettings } from "../config/publication-settings.js";
type LegacyNode = {type:"text";value:string} | {type:"element";tagName:string;properties:Record<string,unknown>;children:LegacyNode[]};
const text = (value: string | undefined): LegacyNode => ({type: "text", value: value ?? ""});
const element = (tagName: string, className: string | string[] | undefined, children: LegacyNode[], extraProperties: Record<string,unknown> = {}): LegacyNode => ({type: "element", tagName, properties: {...(className ? {className: Array.isArray(className) ? className : [className]} : {}), ...extraProperties}, children});
export function applyNotationToText(value: string, settings: PublicationSettings["processing"]): LegacyNode[] {
  const result: LegacyNode[] = [];
  let offset = 0;
  // Pattern groups:
  // 1: [[rb:base>ruby]]  2: base  3: ruby
  // 4: [[emphasismark:text>mark]] or [[emphasismark:text]]  5: text  6: mark (optional)
  // 7: 《《emphasis》》  8: text
  // 9: ｜base《ruby》 (縦線あり)  10: base  11: ruby
  // 12: kanji base《ruby》 (縦線なし)  13: base  14: ruby
  // 15: connected dashes
  // 16: tcy digits/punctuation
  const pattern = /(\[\[rb:([^\r\n>]+?)>([^\r\n\]]+?)\]\])|(\[\[emphasismark:([^\r\n>\]]+?)(?:>([^\r\n\]]*))?\]\])|(《《([^\r\n]+?)》》)|([｜|]([^｜|《》\r\n]+)《([^《》\r\n]+)》)|([\p{Script=Han}々〆ヵヶ]+)《([^《》\r\n]+)》|[―—]{2,}|[0-9０-９]{1,2}|[!?！？]{2}/gu;
  for (const match of value.matchAll(pattern)) {
    if (match.index > offset) result.push(text(value.slice(offset, match.index)));
    if (match[1] !== undefined && settings.ruby?.bracket) {
      // [[rb:base>ruby]]
      result.push(element("ruby", undefined, [text(match[2]), element("rt", undefined, [text(match[3])])]));
    } else if (match[4] !== undefined && settings.emphasis?.bracket) {
      // [[emphasismark:text>mark]] or [[emphasismark:text]]
      const mark = (match[6] !== undefined && match[6] !== "") ? match[6] : (settings.emphasis?.mark ?? "﹅");
      result.push(element("span", "ogenkou-emphasis", [text(match[5])], { style: `text-emphasis-style: '${mark}'` }));
    } else if (match[7] !== undefined && settings.emphasis?.doubleAngle) {
      // 《《emphasis》》
      const mark = settings.emphasis?.mark ?? "﹅";
      result.push(element("span", "ogenkou-emphasis", [text(match[8])], { style: `text-emphasis-style: '${mark}'` }));
    } else if (match[9] !== undefined && settings.ruby?.pipeAngle) {
      // ｜base《ruby》
      result.push(element("ruby", undefined, [text(match[10]), element("rt", undefined, [text(match[11])])]));
    } else if (match[12] !== undefined && settings.ruby?.bareKanji) {
      // kanji《ruby》
      result.push(element("ruby", undefined, [text(match[12]), element("rt", undefined, [text(match[13])])]));
    } else if (settings.connectedDashes && /^[―—]{2,}$/u.test(match[0])) {
      result.push(element("span", "connected-dashes", [text(match[0])]));
    } else if (settings.automaticTcy && /^(?:[0-9０-９]{1,2}|[!?！？]{2})$/u.test(match[0])) {
      const normalized = match[0]
        .replace(/[０-９]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
        .replaceAll("！", "!")
        .replaceAll("？", "?");
      result.push(element("span", "ogenkou-tcy", [text(normalized)]));
    } else result.push(text(match[0]));
    offset = match.index + match[0].length;
  }
  if (offset === 0) return [text(value)];
  if (offset < value.length) result.push(text(value.slice(offset)));
  return result;
}

export function applyVerticalTypographyToText(input: string, settings: PublicationSettings["processing"]): LegacyNode[] {
  const value = settings.verticalQuotes ? input.replace(/“/gu, "〝").replace(/”/gu, "〟") : input;
  if (!settings.kanaMarks) return [text(value)];
  const result: LegacyNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(/([ぁ-ゖァ-ヺ])([\u3099-\u309c\uff9e\uff9f])/gu)) {
    if (match.index > offset) result.push(text(value.slice(offset, match.index)));
    const semiVoiced = /[\u309a\u309c\uff9f]/u.test(match[2]!);
    const pair = match[1]! + (semiVoiced ? "\u309a" : "\u3099");
    // Use native shaping for ordinary voiced kana. Other combinations have
    // no glyph anchor in common Japanese fonts, so overlay the actual kana
    // mark in the inherited font rather than drawing a Latin quotation mark.
    if (pair.normalize("NFC").length === 1) result.push(text(pair));
    else result.push(element("span", ["kana-mark", ...(semiVoiced ? ["kana-mark-semi"] : [])], [
      text(match[1]), element("span", "kana-mark-source", [text(match[2])]),
    ]));
    offset = match.index + match[0].length;
  }
  if (offset < value.length) result.push(text(value.slice(offset)));
  return result.length ? result : [text(value)];
}
