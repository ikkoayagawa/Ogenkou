/** Decode CSS shorthand lengths without changing existing relative-unit settings. */
export function decodePageMargins(value: string): number[] | undefined {
  if (value.trim() === "auto") return undefined;
  const factors: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 1 || tokens.length > 4) return undefined;
  const values: number[] = [];
  for (const token of tokens) {
    const match = /^(\d+(?:\.\d+)?|\.\d+)(mm|cm|in|pt|px)?$/i.exec(token);
    if (!match || (!match[2] && Number(match[1]) !== 0)) return undefined;
    values.push(Number((Number(match[1]) * (match[2] ? factors[match[2].toLowerCase()]! : 1)).toFixed(3)));
  }
  const top = values[0]!;
  const right = values[1] ?? top;
  const bottom = values[2] ?? top;
  const left = values[3] ?? right;
  return [top, right, bottom, left];
}
