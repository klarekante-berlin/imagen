/**
 * Voyage AI multimodal embeddings client (Branch B variant selector).
 *
 * Raw `fetch` against the documented endpoint — keeps deps lean.
 * Endpoint: https://api.voyageai.com/v1/multimodalembeddings
 * Model:    voyage-multimodal-3 (1024-dim)
 *
 * Request body shape (verified via Voyage docs):
 *   { inputs: [{ content: [{ type, ... }, ...] }, ...], model, input_type? }
 *
 * Response body shape:
 *   { data: [{ embedding: number[], index }], model, usage }
 */

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
 * Embed a batch of multimodal inputs (image + optional text). Document-side
 * — used at variant-detection / backfill time.
 */
export async function embedMultimodal(inputs: VoyageInput[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  return callVoyage({
    inputs: inputs.map((inp) => ({ content: buildContent(inp) })),
    model: VOYAGE_MODEL,
    input_type: "document",
  });
}

/**
 * Embed a single text query — used at slide-gen time to score variants.
 * Different `input_type` from document side; Voyage recommends asymmetric
 * encoding for retrieval quality.
 */
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
