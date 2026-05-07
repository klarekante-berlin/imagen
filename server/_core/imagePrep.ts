import sharp from "sharp";

/**
 * Anthropic vision rejects images >5MB (base64 source).
 * We target ≤4.5MB to leave headroom for base64 inflation.
 */
const MAX_BYTES = 4_500_000;
/** Anthropic recommends ≤1568px long edge for vision; downscaling above this gives no benefit. */
const MAX_LONG_EDGE = 1568;

export interface PreparedImage {
  buffer: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  resized: boolean;
  originalBytes: number;
  finalBytes: number;
}

/**
 * Prepare an image buffer for Anthropic vision: returns the original if small enough,
 * otherwise downscales to a sane long edge and re-encodes as JPEG q=85.
 */
export async function prepareImageForVision(
  input: Buffer,
  declaredMime: string,
): Promise<PreparedImage> {
  const originalBytes = input.byteLength;
  const mediaType = pickMediaType(declaredMime);

  if (originalBytes <= MAX_BYTES) {
    return { buffer: input, mediaType, resized: false, originalBytes, finalBytes: originalBytes };
  }

  const meta = await sharp(input).metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  const targetEdge = Math.min(longest || MAX_LONG_EDGE, MAX_LONG_EDGE);

  let buf = await sharp(input)
    .rotate()
    .resize({ width: targetEdge, height: targetEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  // Belt-and-suspenders: if still too big, drop quality.
  if (buf.byteLength > MAX_BYTES) {
    buf = await sharp(input)
      .rotate()
      .resize({ width: targetEdge, height: targetEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
  }

  return {
    buffer: buf,
    mediaType: "image/jpeg",
    resized: true,
    originalBytes,
    finalBytes: buf.byteLength,
  };
}

function pickMediaType(mime: string): PreparedImage["mediaType"] {
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/gif") return "image/gif";
  return "image/png";
}

/**
 * Prepare an image for Atlas Cloud reference_images / images parameter.
 * Atlas chokes on multi-MB JSON bodies. Always downscale to ~1024px long edge
 * and re-encode as JPEG q80 — typically 80–300KB per image, regardless of
 * original size. Used for character/style refs.
 */
const ATLAS_REF_LONG_EDGE = 1024;
const ATLAS_REF_TARGET_BYTES = 500_000;

export async function prepareImageForAtlasRef(
  input: Buffer,
  declaredMime: string,
): Promise<PreparedImage> {
  void declaredMime; // we always re-encode as JPEG, mime is ignored
  const originalBytes = input.byteLength;

  let buf = await sharp(input)
    .rotate()
    .resize({ width: ATLAS_REF_LONG_EDGE, height: ATLAS_REF_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  if (buf.byteLength > ATLAS_REF_TARGET_BYTES) {
    buf = await sharp(input)
      .rotate()
      .resize({ width: ATLAS_REF_LONG_EDGE, height: ATLAS_REF_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 65, mozjpeg: true })
      .toBuffer();
  }

  return {
    buffer: buf,
    mediaType: "image/jpeg",
    resized: true,
    originalBytes,
    finalBytes: buf.byteLength,
  };
}
