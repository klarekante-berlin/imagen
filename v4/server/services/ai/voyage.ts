import { VoyageAIClient } from "voyageai";

const MODEL = "voyage-multimodal-3";
const DIMS = 1024;

// Not cached at module scope — tsx-watch reloads on .ts edits but not .env,
// so a cached client would keep an old key after rotation. Constructor cost
// is negligible.
function client(): VoyageAIClient {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY missing");
  return new VoyageAIClient({ apiKey });
}

function f32ToBuffer(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

export function bufferToF32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export type EmbedContent =
  | { type: "text"; text: string }
  | { type: "image_base64"; imageBase64: string };

export async function embedMultimodal(contents: EmbedContent[]): Promise<Buffer> {
  if (contents.length === 0) throw new Error("embedMultimodal: empty content");
  const resp = await client().multimodalEmbed({
    inputs: [{ content: contents as never }],
    model: MODEL,
  });
  const vec = resp.data?.[0]?.embedding;
  if (!vec || vec.length !== DIMS) {
    throw new Error(`Unexpected embedding dims: ${vec?.length}`);
  }
  return f32ToBuffer(vec);
}

export async function embedText(text: string): Promise<Buffer> {
  return embedMultimodal([{ type: "text", text }]);
}

export async function embedImageWithText(
  imageBase64: string,
  text: string | null,
): Promise<Buffer> {
  const items: EmbedContent[] = [
    { type: "image_base64", imageBase64: `data:image/jpeg;base64,${imageBase64}` },
  ];
  if (text && text.trim().length > 0) items.push({ type: "text", text });
  return embedMultimodal(items);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const VOYAGE_DIMS = DIMS;
