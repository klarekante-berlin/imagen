import sharp from "sharp";

/**
 * Anthropic vision rejects images >5MB (base64 source).
 * We target ≤4.5MB to leave headroom for base64 inflation.
 */
const MAX_BYTES = 4_500_000;
/** Anthropic recommends ≤1568px long edge for vision; downscaling above this gives no benefit. */
const MAX_LONG_EDGE = 1568;

/** Storage-side limits — we keep more pixels than vision but still cap. */
const STORAGE_MAX_LONG_EDGE = 2048;
/** Convert non-JPEG sources to JPEG when they exceed this size. Small icons keep their format. */
const STORAGE_CONVERT_THRESHOLD = 1_000_000;

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

/**
 * Prepare a freshly-uploaded image for permanent storage. Big PNG/WEBP/GIF
 * uploads (>1MB) are re-encoded to JPEG q90 with a 2048px long-edge cap so
 * they don't blow past Anthropic's 5MB vision limit later. JPEG sources and
 * small non-JPEG icons pass through untouched.
 */
export async function prepareImageForStorage(
  buffer: Buffer,
  declaredMime: string,
  fileName: string,
): Promise<{ buffer: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; fileName: string }> {
  const mediaType = pickMediaType(declaredMime);
  const isJpeg = mediaType === "image/jpeg";
  const shouldConvert = !isJpeg && buffer.byteLength > STORAGE_CONVERT_THRESHOLD;
  if (!shouldConvert) {
    return { buffer, mediaType, fileName };
  }

  const out = await sharp(buffer)
    .rotate()
    .resize({ width: STORAGE_MAX_LONG_EDGE, height: STORAGE_MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  const renamed = fileName.replace(/\.(png|webp|gif|jpe?g)$/i, "") + ".jpg";
  return { buffer: out, mediaType: "image/jpeg", fileName: renamed };
}

/**
 * Crop a region out of a sheet and prepare it for Atlas Cloud the same way
 * `prepareImageForAtlasRef` does (≤1024px long edge, JPEG q80). Used by the
 * variant-aware presigner so each slide gets a tight panel instead of the
 * full sheet, which carries way more visual noise than Atlas can handle.
 *
 * Throws when `bbox` is invalid (negative, zero-area, or out of bounds for
 * the source image).
 */
export async function prepareCroppedRefForAtlas(
  buffer: Buffer,
  mimeType: string,
  bbox: [number, number, number, number],
): Promise<{ buffer: Buffer; mediaType: "image/jpeg" }> {
  void mimeType; // we always re-encode as JPEG
  const [x, y, w, h] = bbox;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0
  ) {
    throw new Error(`prepareCroppedRefForAtlas: invalid bbox ${JSON.stringify(bbox)}`);
  }

  const meta = await sharp(buffer).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (srcW === 0 || srcH === 0) {
    throw new Error("prepareCroppedRefForAtlas: source image has no dimensions");
  }
  if (x + w > srcW || y + h > srcH) {
    throw new Error(
      `prepareCroppedRefForAtlas: bbox [${x},${y},${w},${h}] exceeds source ${srcW}x${srcH}`,
    );
  }

  const left = Math.round(x);
  const top = Math.round(y);
  const width = Math.round(w);
  const height = Math.round(h);

  let out = await sharp(buffer)
    .rotate()
    .extract({ left, top, width, height })
    .resize({
      width: ATLAS_REF_LONG_EDGE,
      height: ATLAS_REF_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  if (out.byteLength > ATLAS_REF_TARGET_BYTES) {
    out = await sharp(buffer)
      .rotate()
      .extract({ left, top, width, height })
      .resize({
        width: ATLAS_REF_LONG_EDGE,
        height: ATLAS_REF_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 65, mozjpeg: true })
      .toBuffer();
  }

  return { buffer: out, mediaType: "image/jpeg" };
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
