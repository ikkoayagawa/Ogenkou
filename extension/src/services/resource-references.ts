/** CSS token scanning: comments/strings are opaque; escapes are decoded before URL resolution. */
export interface CssReference { start: number; end: number; tokenStart: number; tokenEnd: number; value: string; kind: "css" | "asset" }
const unescapeCss = (value: string) => value.replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n\f])|\r\n|[\r\n\f])/giu,
  (_, hex: string | undefined, char: string | undefined) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char ?? "");
export function cssReferences(css: string): CssReference[] {
  const found: CssReference[] = [];
  let i = 0, importing = false, namespace = false;
  const spaces = () => { while (i < css.length) {
    if (/\s/u.test(css[i]!)) i++;
    else if (css.startsWith("/*", i)) { const end = css.indexOf("*/", i + 2); i = end < 0 ? css.length : end + 2; }
    else break;
  } };
  const string = () => {
    const quote = css[i++]!, start = i;
    while (i < css.length && css[i] !== quote) { if (css[i] === "\\") i++; i++; }
    const end = i; if (i < css.length) i++;
    return { start, end, value: unescapeCss(css.slice(start, end)) };
  };
  const functions: string[] = [];
  while (i < css.length) {
    spaces(); if (i >= css.length) break;
    if (css[i] === '"' || css[i] === "'") {
      const tokenStart = i, ref = string();
      if (importing || /^(?:-webkit-)?image-set$/u.test(functions.at(-1) ?? "")) {
        found.push({ ...ref, tokenStart, tokenEnd: i, kind: importing ? "css" : "asset" }); importing = false;
      }
      continue;
    }
    if (css[i] === ";" || css[i] === "{") { importing = false; namespace = false; }
    if (css[i] === ")") functions.pop();
    if (css[i] === "@") {
      const word = /^@[\w-]+/u.exec(css.slice(i));
      if (word) { importing = word[0].toLowerCase() === "@import"; namespace = word[0].toLowerCase() === "@namespace"; i += word[0].length; continue; }
    }
    const word = /^(?:[\w-]|\\(?:[\da-f]{1,6}\s?|.))+/iu.exec(css.slice(i));
    if (!word) { i++; continue; }
    const tokenStart = i, name = unescapeCss(word[0]).toLowerCase(); i += word[0].length;
    // A function token has no whitespace between its name and parenthesis.
    if (css[i] !== "(") continue;
    i++;
    if (name !== "url") { functions.push(name); continue; }
    spaces();
    let ref: { start: number; end: number; value: string };
    if (css[i] === '"' || css[i] === "'") ref = string();
    else {
      const start = i;
      while (i < css.length && css[i] !== ")") { if (css[i] === "\\") i++; i++; }
      const end = i; ref = { start, end, value: unescapeCss(css.slice(start, end).trim()) };
    }
    spaces(); if (css[i] === ")") i++;
    if (!namespace) found.push({ ...ref, tokenStart, tokenEnd: i, kind: importing ? "css" : "asset" }); importing = false;
  }
  return found;
}

/** Core's memory loader accepts url() tokens; also normalize quoted @import/image-set references. */
export function memoryCss(css: string, base: string, resolve: (uri: string, kind: "css" | "asset") => string = uri => uri): string {
  for (const ref of cssReferences(css).reverse()) {
    let url = ref.value;
    try { if (url && !url.startsWith("#")) url = resolve(new URL(url, base).href, ref.kind); } catch { continue; }
    url = url.replaceAll('"', "%22").replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
    css = css.slice(0, ref.tokenStart) + 'url("' + url + '")' + css.slice(ref.tokenEnd);
  }
  return css;
}

/** Rewriting only token contents preserves selectors, media/layer conditions and declarations. */
export function absoluteCss(css: string, base: string): string {
  const refs = cssReferences(css);
  for (const ref of refs.reverse()) {
    if (!ref.value || ref.value.startsWith("#") || ref.value.startsWith("data:")) continue;
    try {
      const url = new URL(ref.value, base).href;
      const escaped = url.replace(/["'()\s\\]/gu, char => "\\" + char.codePointAt(0)!.toString(16) + " ");
      css = css.slice(0, ref.start) + escaped + css.slice(ref.end);
    } catch { /* collector diagnoses invalid references */ }
  }
  return css;
}

/** Candidate URL boundaries follow srcset's whitespace rule, including data URL commas. */
export function srcsetReferences(value: string): { url: string; descriptor: string }[] {
  const candidates: { url: string; descriptor: string }[] = [];
  let i = 0;
  while (i < value.length) {
    while (/[\s,]/u.test(value[i] ?? "") && i < value.length) i++;
    const start = i;
    while (i < value.length && !/\s/u.test(value[i]!)) i++;
    let url = value.slice(start, i), descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/u, "");
    else {
      const begin = i; let depth = 0;
      while (i < value.length && (value[i] !== "," || depth)) {
        if (value[i] === "(") depth++; if (value[i] === ")") depth--; i++;
      }
      descriptor = value.slice(begin, i).trim();
    }
    if (url) candidates.push({ url, descriptor });
    if (value[i] === ",") i++;
  }
  return candidates;
}
