import sharp from "sharp";

export type NormalizeOptions = {
  /** Longest-side ceiling in px. Default 1536 — fits gpt-image-2's edit input
   * and Anthropic vision's tile-billing sweet spot without over-resizing. */
  maxSize?: number;
  /** JPEG quality 1–100. Default 85. */
  quality?: number;
};

export type NormalizedImage = {
  buffer: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  originalBytes: number;
  finalBytes: number;
};

/**
 * Force-convert an upload to JPEG at a sane size for AI reference images.
 * - Always re-encodes to JPEG (drops alpha; Atlas's edit endpoint ignores it
 *   anyway and Claude vision charges by pixel area, not format).
 * - Resizes only when the longest side exceeds maxSize.
 * - Auto-rotates EXIF orientation so 90°-tilted phone shots land upright.
 *
 * Returns the new buffer + dimensions for the caller to persist.
 */
export async function normalizeImageForRef(
  input: Buffer,
  opts: NormalizeOptions = {},
): Promise<NormalizedImage> {
  const maxSize = opts.maxSize ?? 1536;
  const quality = opts.quality ?? 85;

  const pipeline = sharp(input, { failOn: "none" })
    .rotate() // honour EXIF orientation
    .resize({
      width: maxSize,
      height: maxSize,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mime: "image/jpeg",
    width: info.width,
    height: info.height,
    originalBytes: input.byteLength,
    finalBytes: data.byteLength,
  };
}
