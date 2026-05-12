/** Approximate average character width in px for the default sans-serif at a
 * given font-size. Tuned empirically for sharp's librsvg rendering. */
function avgCharWidthPx(fontSize: number): number {
  return fontSize * 0.55;
}

export function wrapTextToLines(
  text: string,
  maxWidthPx: number,
  fontSize: number,
  maxLines = Infinity,
): string[] {
  const charsPerLine = Math.max(1, Math.floor(maxWidthPx / avgCharWidthPx(fontSize)));
  const paragraphs = text.split(/\n+/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > charsPerLine) {
        if (current) lines.push(current);
        if (word.length > charsPerLine) {
          // Hard-break very long tokens.
          let remaining = word;
          while (remaining.length > charsPerLine) {
            lines.push(remaining.slice(0, charsPerLine));
            remaining = remaining.slice(charsPerLine);
          }
          current = remaining;
        } else {
          current = word;
        }
      } else {
        current = candidate;
      }
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    }
    if (current) lines.push(current);
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }
  return lines;
}

/** Escape XML special chars in a text node. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Multi-line SVG <text> rooted at (x,y) with line-height = fontSize * 1.35. */
export function svgMultilineText(
  lines: string[],
  opts: {
    x: number;
    y: number;
    fontSize: number;
    fontFamily?: string;
    fontWeight?: number | "bold" | "normal";
    color?: string;
    anchor?: "start" | "middle" | "end";
  },
): string {
  const lineHeight = opts.fontSize * 1.35;
  const fontFamily = opts.fontFamily ?? "system-ui, -apple-system, 'Segoe UI', sans-serif";
  const weight = opts.fontWeight ?? "normal";
  const color = opts.color ?? "#1F2937";
  const anchor = opts.anchor ?? "start";
  const tspans = lines
    .map((ln, i) => {
      const dy = i === 0 ? 0 : lineHeight;
      return `<tspan x="${opts.x}" dy="${dy}">${xmlEscape(ln)}</tspan>`;
    })
    .join("");
  return `<text x="${opts.x}" y="${opts.y}" font-family="${fontFamily}" font-size="${opts.fontSize}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`;
}
