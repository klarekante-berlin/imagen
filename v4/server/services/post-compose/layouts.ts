import type { SectionKind } from "../../../shared/types/enums";
import { svgMultilineText, wrapTextToLines, xmlEscape } from "./svg-helpers";

/** Page is 1024x1536 portrait. All layouts produce SVG overlays that compose
 * on top of the base canvas (white) + the illustration. */

export type LayoutInput = {
  pageText: string;
  pageNumber: number | null;
  chapterTitle: string | null;
  bookTitle: string;
  /** Used only by the toc layout. */
  chapters?: string[];
};

export type Layout = {
  /** How tall the illustration band should be. The rest of 1536px goes to text. */
  illustrationHeight: number;
  /** When true, the illustration occupies the full 1024x1536 and the SVG sits
   * on top of it (cover, endpage). Otherwise the illustration is placed at
   * y=0 and the SVG fills the bottom band. */
  fullBleed?: boolean;
  /** Produce the SVG string overlaid on top of the composed image. */
  buildOverlay: (input: LayoutInput) => string;
};

const W = 1024;
const H = 1536;
const PAD_X = 64;
const TEXT_WIDTH = W - PAD_X * 2;

function pageFooter(pageNumber: number | null): string {
  if (pageNumber === null) return "";
  return svgMultilineText([`— ${pageNumber} —`], {
    x: W / 2,
    y: H - 28,
    fontSize: 16,
    color: "#9CA3AF",
    anchor: "middle",
  });
}

function chapterChip(chapterTitle: string | null, yTop: number): string {
  if (!chapterTitle) return "";
  return svgMultilineText([chapterTitle], {
    x: PAD_X,
    y: yTop + 28,
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "bold",
  });
}

/** body / image_anchor / recap / chapter_opener / custom — same shape. */
const bodyLayout: Layout = {
  illustrationHeight: 920,
  buildOverlay: ({ pageText, pageNumber, chapterTitle }) => {
    const panelY = 920;
    const panelH = H - panelY;
    const textTop = panelY + 56;
    const lines = wrapTextToLines(pageText, TEXT_WIDTH, 22, 18);
    const panel = `<rect x="0" y="${panelY}" width="${W}" height="${panelH}" fill="#FFFFFF"/>`;
    const text = svgMultilineText(lines, {
      x: PAD_X,
      y: textTop,
      fontSize: 22,
      color: "#1F2937",
    });
    return `${panel}${chapterChip(chapterTitle, panelY)}${text}${pageFooter(pageNumber)}`;
  },
};

const coverLayout: Layout = {
  illustrationHeight: H,
  fullBleed: true,
  buildOverlay: ({ bookTitle }) => {
    const titleLines = wrapTextToLines(bookTitle, TEXT_WIDTH, 64, 3);
    const titleH = 64 * 1.35 * titleLines.length;
    const titleY = 140;
    // Dark vignette band behind title for legibility on busy covers.
    const band = `<rect x="0" y="${titleY - 84}" width="${W}" height="${titleH + 60}" fill="rgba(15, 23, 42, 0.55)"/>`;
    const title = svgMultilineText(titleLines, {
      x: W / 2,
      y: titleY,
      fontSize: 64,
      fontWeight: "bold",
      color: "#FFFFFF",
      anchor: "middle",
    });
    return `${band}${title}`;
  },
};

const tocLayout: Layout = {
  illustrationHeight: 460,
  buildOverlay: ({ chapters }) => {
    const panelY = 460;
    const panelH = H - panelY;
    const panel = `<rect x="0" y="${panelY}" width="${W}" height="${panelH}" fill="#FFFFFF"/>`;
    const title = svgMultilineText(["Inhalt"], {
      x: PAD_X,
      y: panelY + 64,
      fontSize: 36,
      fontWeight: "bold",
      color: "#1F2937",
    });
    const list = (chapters ?? []).slice(0, 20).map((c, i) => {
      const y = panelY + 140 + i * 44;
      const number = String(i + 1).padStart(2, "0");
      return `<text x="${PAD_X}" y="${y}" font-family="system-ui, sans-serif" font-size="22" fill="#374151" xml:space="preserve">${xmlEscape(number)}  ${xmlEscape(c)}</text>`;
    });
    return `${panel}${title}${list.join("")}`;
  },
};

const quizLayout: Layout = {
  illustrationHeight: 768,
  buildOverlay: ({ pageText, pageNumber, chapterTitle }) => {
    const panelY = 768;
    const panelH = H - panelY;
    const panel = `<rect x="0" y="${panelY}" width="${W}" height="${panelH}" fill="#FFFFFF"/>`;
    // Split pageText: first non-empty line is the question; remaining lines
    // that start with a/b/c/1./2./3. become answers.
    const rawLines = pageText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const question = rawLines[0] ?? "";
    const answers = rawLines.slice(1).filter((l) => /^[abc1-9][).:\s]/i.test(l));
    const qLines = wrapTextToLines(question, TEXT_WIDTH, 24, 3);
    const qSvg = svgMultilineText(qLines, {
      x: PAD_X,
      y: panelY + 56,
      fontSize: 24,
      fontWeight: "bold",
    });
    const answerSvgs = answers.slice(0, 4).map((a, i) => {
      const y = panelY + 56 + qLines.length * 24 * 1.35 + 56 + i * 90;
      const ansLines = wrapTextToLines(a, TEXT_WIDTH - 80, 20, 2);
      const lineH = 20 * 1.35;
      const bg = `<rect x="${PAD_X}" y="${y - 28}" width="${TEXT_WIDTH}" height="${lineH * ansLines.length + 28}" rx="12" fill="#F3F4F6"/>`;
      const text = svgMultilineText(ansLines, {
        x: PAD_X + 24,
        y: y,
        fontSize: 20,
        color: "#1F2937",
      });
      return `${bg}${text}`;
    });
    return `${panel}${chapterChip(chapterTitle, panelY)}${qSvg}${answerSvgs.join("")}${pageFooter(pageNumber)}`;
  },
};

const glossaryLayout: Layout = {
  illustrationHeight: 460,
  buildOverlay: ({ pageText, pageNumber }) => {
    const panelY = 460;
    const panelH = H - panelY;
    const panel = `<rect x="0" y="${panelY}" width="${W}" height="${panelH}" fill="#FFFFFF"/>`;
    const title = svgMultilineText(["Wörterkiste"], {
      x: PAD_X,
      y: panelY + 64,
      fontSize: 32,
      fontWeight: "bold",
    });
    // Each entry: "- term — definition"
    const entries = pageText
      .split(/\n+/)
      .map((s) => s.replace(/^\s*[-•*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
    const items = entries.map((entry, i) => {
      const y = panelY + 140 + i * 110;
      const [term, ...rest] = entry.split(/[—–-]/);
      const def = rest.join("—").trim();
      const termSvg = svgMultilineText([term?.trim() ?? ""], {
        x: PAD_X,
        y,
        fontSize: 22,
        fontWeight: "bold",
        color: "#1F2937",
      });
      const defLines = wrapTextToLines(def, TEXT_WIDTH, 18, 2);
      const defSvg = svgMultilineText(defLines, {
        x: PAD_X,
        y: y + 32,
        fontSize: 18,
        color: "#4B5563",
      });
      return `${termSvg}${defSvg}`;
    });
    return `${panel}${title}${items.join("")}${pageFooter(pageNumber)}`;
  },
};

const endpageLayout: Layout = {
  illustrationHeight: H,
  fullBleed: true,
  buildOverlay: ({ pageText, bookTitle }) => {
    const lines = wrapTextToLines(pageText || "Danke fürs Lesen!", TEXT_WIDTH, 32, 4);
    const lineH = 32 * 1.35;
    const totalH = lineH * lines.length + 48;
    const yTop = H - totalH - 80;
    const band = `<rect x="0" y="${yTop - 32}" width="${W}" height="${totalH + 64}" fill="rgba(255, 255, 255, 0.92)"/>`;
    const text = svgMultilineText(lines, {
      x: W / 2,
      y: yTop + 16,
      fontSize: 32,
      anchor: "middle",
    });
    const footer = svgMultilineText([bookTitle], {
      x: W / 2,
      y: H - 32,
      fontSize: 14,
      color: "#9CA3AF",
      anchor: "middle",
    });
    return `${band}${text}${footer}`;
  },
};

const LAYOUTS: Record<SectionKind, Layout> = {
  cover: coverLayout,
  toc: tocLayout,
  chapter_opener: bodyLayout,
  recap: bodyLayout,
  image_anchor: bodyLayout,
  body: bodyLayout,
  denkfalle: bodyLayout,
  quiz: quizLayout,
  experiment: bodyLayout,
  glossary: glossaryLayout,
  endpage: endpageLayout,
  custom: bodyLayout,
};

export function getLayout(kind: SectionKind): Layout {
  return LAYOUTS[kind] ?? bodyLayout;
}

export const PAGE_WIDTH = W;
export const PAGE_HEIGHT = H;
