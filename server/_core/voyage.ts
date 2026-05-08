/**
 * Voyage AI multimodal embeddings client (Branch B sheet-level retrieval).
 *
 * Raw `fetch` against the documented endpoint — keeps deps lean.
 * Endpoint: https://api.voyageai.com/v1/multimodalembeddings
 * Model:    voyage-multimodal-3 (1024-dim)
 *
 * Branch B uses these embeddings for SHEET-level inspiration retrieval (find
 * relevant *other* sheets given a slide's context), not panel-level crop
 * selection. Per-variant embeddings on `AssetVariant.embedding` from the
 * earlier RAG branch are not used here — only `assets.embedding` (whole-sheet).
 *
 * Request body shape (verified via Voyage docs):
 *   { inputs: [{ content: [{ type, ... }, ...] }, ...], model, input_type? }
 *
 * Response body shape:
 *   { data: [{ embedding: number[], index }], model, usage }
 */

import { storageReadLocal } from "../storage";
import { ENV } from "./env";
import { prepareImageForVision } from "./imagePrep";
import { getAssetsWithEmbedding } from "../db";
import type { Asset } from "../../drizzle/schema";
import type { AssetVariant } from "@shared/types";

export interface VoyageInput {
  image?: { mediaType: string; data: string }; // base64 (no data: prefix)
  text?: string;
}

const VOYAGE_API_URL = "https://api.voyageai.com/v1/multimodalembeddings";
const VOYAGE_MODEL = "voyage-multimodal-3";

interface VoyageContentBlock {
  type: "text" | "image_base64";
  text?: string;
  image_base64?: string;
}

interface VoyageRequestBody {
  inputs: Array<{ content: VoyageContentBlock[] }>;
  model: string;
  input_type?: "query" | "document";
}

interface VoyageResponseBody {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: unknown;
}

function buildContent(inp: VoyageInput): VoyageContentBlock[] {
  const blocks: VoyageContentBlock[] = [];
  if (inp.image) {
    blocks.push({
      type: "image_base64",
      image_base64: `data:${inp.image.mediaType};base64,${inp.image.data}`,
    });
  }
  if (inp.text) {
    blocks.push({ type: "text", text: inp.text });
  }
  return blocks;
}

async function callVoyage(body: VoyageRequestBody): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY not configured");

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Voyage API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as VoyageResponseBody;
  if (!Array.isArray(json.data)) {
    throw new Error("Voyage API: unexpected response shape (missing data[])");
  }
  // Sort by index to be safe; API spec says order matches input but harmless.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Embed a batch of multimodal inputs (image + optional text). Caller chooses
 * `input_type` — "document" for stored items, "query" for retrieval-side calls.
 * Asymmetric encoding gives Voyage retrieval its quality boost.
 */
export async function embedMultimodal(
  inputs: VoyageInput[],
  inputType: "document" | "query" = "document",
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  return callVoyage({
    inputs: inputs.map((inp) => ({ content: buildContent(inp) })),
    model: VOYAGE_MODEL,
    input_type: inputType,
  });
}

/** Embed a single text query — used by `retrieveInspirationSheets`. */
export async function embedTextAsQuery(text: string): Promise<number[]> {
  const result = await callVoyage({
    inputs: [{ content: [{ type: "text", text }] }],
    model: VOYAGE_MODEL,
    input_type: "query",
  });
  if (result.length === 0) throw new Error("Voyage API returned no embedding");
  return result[0];
}

/** Cosine similarity between two equal-length vectors. Returns 0 on degenerate input. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Sheet-level helpers (Branch B) ──────────────────────────────────────────

async function loadImageBytes(
  imageSource: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string },
): Promise<{ buffer: Buffer; mediaType: string } | null> {
  if (imageSource.type === "base64") {
    return { buffer: Buffer.from(imageSource.data, "base64"), mediaType: imageSource.mediaType };
  }
  // url variant — resolve through local storage when possible (no extra HTTP),
  // fall back to fetch() for absolute http(s) URLs.
  if (imageSource.url.startsWith("http")) {
    try {
      const res = await fetch(imageSource.url);
      if (!res.ok) return null;
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        mediaType: res.headers.get("content-type") ?? "image/jpeg",
      };
    } catch {
      return null;
    }
  }
  const key = imageSource.url.replace(/^\/manus-storage\//, "");
  if (!key) return null;
  const local = await storageReadLocal(key);
  if (!local) return null;
  return { buffer: local.buffer, mediaType: local.contentType };
}

/**
 * Embed a whole sheet (image + variant descriptions + visualDescription) as a
 * single 1024-dim vector. Returns null when VOYAGE_API_KEY is unset OR the
 * Voyage call fails — callers persist null and the slide-gen path falls back
 * to no-inspiration. Never throws.
 */
export async function embedSheet(
  imageSource: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string },
  variants: AssetVariant[],
  visualDescription: string,
): Promise<number[] | null> {
  if (!process.env.VOYAGE_API_KEY) return null;

  try {
    const bytes = await loadImageBytes(imageSource);
    if (!bytes) return null;

    // Re-prep through the vision pipeline to keep payload < 5MB and within
    // Voyage's accepted media types (image/jpeg | image/png | image/webp).
    const prepared = await prepareImageForVision(bytes.buffer, bytes.mediaType);

    const variantText =
      variants.length > 0
        ? variants.map((v) => `${v.name} (${v.axis}): ${v.description}`).join("; ")
        : "";
    const text = variantText
      ? `${visualDescription}\n\nVarianten: ${variantText}`
      : visualDescription;

    const result = await embedMultimodal(
      [
        {
          image: { mediaType: prepared.mediaType, data: prepared.buffer.toString("base64") },
          text: text || undefined,
        },
      ],
      "document",
    );
    return result[0] ?? null;
  } catch (e) {
    console.warn("[voyage.embedSheet] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Sheet-level retrieval: given a slide context query, return up to `topK`
 * other sheets ranked by cosine similarity. Returns [] when VOYAGE_API_KEY is
 * unset OR no assets have embeddings OR retrieval fails. Never throws.
 *
 * `excludeAssetIds` skips sheets already used as character / scene refs in
 * the slide so we don't waste an Atlas slot on a duplicate.
 */
export interface InspirationHit {
  asset: Asset;
  cosine: number;
}

const COSINE_THRESHOLD = 0.4;

export async function retrieveInspirationSheets(
  queryText: string,
  excludeAssetIds: number[],
  topK: number,
): Promise<InspirationHit[]> {
  if (!process.env.VOYAGE_API_KEY) return [];
  if (topK <= 0) return [];

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedTextAsQuery(queryText);
  } catch (e) {
    console.warn(
      "[voyage.retrieveInspiration] embedTextAsQuery failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }

  const candidates = await getAssetsWithEmbedding();
  const exclude = new Set(excludeAssetIds);
  const scored: InspirationHit[] = [];
  for (const a of candidates) {
    if (exclude.has(a.id)) continue;
    if (!Array.isArray(a.embedding) || a.embedding.length === 0) continue;
    const score = cosine(queryEmbedding, a.embedding);
    if (score < COSINE_THRESHOLD) continue;
    scored.push({ asset: a, cosine: score });
  }
  scored.sort((a, b) => b.cosine - a.cosine);
  // Mute when ENV happens to gate logging; harmless otherwise.
  if (scored.length > 0 && !ENV.isProduction) {
    const top = scored.slice(0, topK).map((h) => `${h.asset.name}#${h.asset.id} c=${h.cosine.toFixed(2)}`);
    console.log(`[voyage.retrieveInspiration] top: ${top.join(", ")}`);
  }
  return scored.slice(0, topK);
}
