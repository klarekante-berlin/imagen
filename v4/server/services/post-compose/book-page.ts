import sharp from "sharp";
import type { SectionKind } from "../../../shared/types/enums";
import { PAGE_HEIGHT, PAGE_WIDTH, getLayout } from "./layouts";

export type ComposeBookPageInput = {
  /** Atlas illustration output (any size; gets cover-resized to fit). */
  illustrationBuffer: Buffer;
  /** Body text rendered into the layout — frame.caption usually. */
  pageText: string;
  sectionKind: SectionKind;
  pageNumber: number | null;
  chapterTitle: string | null;
  bookTitle: string;
  /** Optional ToC chapter list (used by the toc layout). */
  chapters?: string[];
};

/**
 * Composes a finished 1024x1536 book page: resizes the Atlas illustration
 * into the layout's image band, paints a white panel for text, and overlays
 * an SVG with the page text rendered in the section-appropriate template.
 *
 * Returns JPEG q88.
 */
export async function composeBookPage(input: ComposeBookPageInput): Promise<Buffer> {
  const layout = getLayout(input.sectionKind);
  const illustrationHeight = layout.fullBleed
    ? PAGE_HEIGHT
    : layout.illustrationHeight;

  // Resize the illustration to fit the band (cover-fit, center cropping).
  const illustration = await sharp(input.illustrationBuffer, { failOn: "none" })
    .rotate()
    .resize({
      width: PAGE_WIDTH,
      height: illustrationHeight,
      fit: "cover",
      position: "attention",
    })
    .png()
    .toBuffer();

  const overlay = layout.buildOverlay({
    pageText: input.pageText,
    pageNumber: input.pageNumber,
    chapterTitle: input.chapterTitle,
    bookTitle: input.bookTitle,
    chapters: input.chapters,
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">${overlay}</svg>`;

  // Base canvas: white. For full-bleed layouts the illustration covers it
  // entirely; for split layouts the white shows through under the text panel.
  const base = sharp({
    create: {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });

  const composites: sharp.OverlayOptions[] = [
    { input: illustration, top: 0, left: 0 },
    { input: Buffer.from(svg), top: 0, left: 0 },
  ];

  return base
    .composite(composites)
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
