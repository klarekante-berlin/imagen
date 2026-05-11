/**
 * Imagen V3 – Embedding Service (Voyage AI multimodal-3.5)
 *
 * Responsibilities:
 *  - embedAsset(asset)         → generate + store 1024-dim embedding for an asset
 *  - embedText(text)           → generate 1024-dim embedding for a text query
 *  - findAssetsByEmbedding()   → semantic vector search via Turso vector_top_k
 *  - ensureEmbedding(assetId)  → idempotent: skip if embedding already exists
 *
 * Model: voyage-multimodal-3.5
 *  - 1024 dimensions
 *  - Shared text+image embedding space (no modality gap)
 *  - Input: interleaved [{type:"image_base64",value:...},{type:"text",value:...}]
 *
 * Cost awareness:
 *  - Images are billed per pixel. A 1024×1024 PNG ≈ $0.0006.
 *  - Text is billed per token. A 200-token description ≈ $0.000024.
 *  - embedAsset() sends BOTH image + text description in one call for richer embeddings.
 *  - findAssetsByEmbedding() sends text only (cheap, ~$0.00001 per query).
 *
 * Vector search:
 *  - Turso supports vector_top_k() via raw SQL (libSQL extension).
 *  - Index: CREATE INDEX assets_embedding_idx ON assets(libsql_vector_idx(embedding))
 *  - This index is created in migration 0001_add_vector_index.sql
 *
 * Usage:
 *  import { embedAsset, findAssetsByEmbedding } from './embeddingService';
 */

import fs from "fs";
import path from "path";
import { VoyageAIClient } from "voyageai";
import { getDb, getLibSQLClient } from "./db";
import { assets } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import type { Asset } from "../drizzle/schema";

// ─── Constants ────────────────────────────────────────────────────────────────
const VOYAGE_MODEL = "voyage-multimodal-3";
const EMBEDDING_DIMS = 1024;
const STORAGE_DIR = path.resolve("./storage-data");

// ─── Client ───────────────────────────────────────────────────────────────────
function getVoyageClient(): VoyageAIClient {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set in environment");
  return new VoyageAIClient({ apiKey });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Float32Array embedding to a Buffer for SQLite blob storage.
 * Turso's vector_top_k() expects raw IEEE-754 float32 bytes.
 */
function float32ToBuffer(embedding: number[]): Buffer {
  const arr = new Float32Array(embedding);
  return Buffer.from(arr.buffer);
}

/**
 * Convert a stored Buffer back to a Float32Array.
 */
export function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * Load an asset image as base64 string.
 * Tries local storage-data/ first, falls back to HTTP fetch.
 */
async function loadImageAsBase64(imageUrl: string, imageKey: string): Promise<string | null> {
  // Try local file first (avoids network round-trip)
  const localPath = path.join(STORAGE_DIR, imageKey);
  if (fs.existsSync(localPath)) {
    const buf = fs.readFileSync(localPath);
    return buf.toString("base64");
  }

  // Fallback: HTTP fetch (for production / Turso cloud)
  try {
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:5173";
    const fullUrl = imageUrl.startsWith("http") ? imageUrl : `${baseUrl}${imageUrl}`;
    const res = await fetch(fullUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Generate a multimodal embedding for an asset.
 * Sends both the image (base64) and the text description in one request
 * for a richer, more grounded embedding.
 *
 * Returns the embedding as a Buffer (raw float32 bytes) ready for DB storage.
 * Returns null if the image cannot be loaded (e.g. missing file).
 */
export async function generateAssetEmbedding(asset: Asset): Promise<Buffer | null> {
  const client = getVoyageClient();

  // Build multimodal input: image + text description
  // Voyage AI expects: { content: [{ type, text? | imageBase64? | imageUrl? }] }
  const contentItems: Array<{ type: string; text?: string; imageBase64?: string }> = [];

  // 1. Image (primary signal)
  const imageBase64 = await loadImageAsBase64(asset.imageUrl ?? "", asset.imageKey);
  if (imageBase64) {
    // Voyage expects data URL format: data:image/jpeg;base64,<data>
    contentItems.push({
      type: "image_base64",
      imageBase64: `data:image/jpeg;base64,${imageBase64}`,
    });
  }

  // 2. Text context (enriches the embedding with semantic labels)
  const textParts: string[] = [];
  if (asset.name) textParts.push(asset.name);
  if (asset.category) textParts.push(`category: ${asset.category}`);
  if (asset.visualDescription) textParts.push(asset.visualDescription);
  if (asset.tags?.length) textParts.push(`tags: ${asset.tags.join(", ")}`);
  if (asset.pose) textParts.push(`pose: ${asset.pose}`);
  if (asset.outfit) textParts.push(`outfit: ${asset.outfit}`);
  if (asset.setting) textParts.push(`setting: ${asset.setting}`);
  if (asset.mood) textParts.push(`mood: ${asset.mood}`);
  if (textParts.length > 0) {
    contentItems.push({ type: "text", text: textParts.join(". ") });
  }

  if (contentItems.length === 0) {
    console.warn(`[EmbeddingService] Asset ${asset.id} has no image or text — skipping`);
    return null;
  }

  const response = await client.multimodalEmbed({
    inputs: [{ content: contentItems }],
    model: VOYAGE_MODEL,
  });

  const embedding = response.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `[EmbeddingService] Unexpected embedding dims: got ${embedding?.length}, expected ${EMBEDDING_DIMS}`
    );
  }

  return float32ToBuffer(embedding);
}

/**
 * Generate a text-only embedding for a search query.
 * Used by findAssetsByEmbedding() to convert a scene description into a vector.
 */
export async function generateTextEmbedding(text: string): Promise<Buffer> {
  const client = getVoyageClient();

  const response = await client.multimodalEmbed({
    inputs: [{ content: [{ type: "text", text }] }],
    model: VOYAGE_MODEL,
  });

  const embedding = response.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `[EmbeddingService] Unexpected embedding dims: got ${embedding?.length}, expected ${EMBEDDING_DIMS}`
    );
  }

  return float32ToBuffer(embedding);
}

/**
 * Embed an asset and persist the embedding to the DB.
 * Idempotent: if the asset already has an embedding, skip unless force=true.
 */
export async function embedAsset(
  assetId: number,
  options: { force?: boolean } = {}
): Promise<{ skipped: boolean; assetId: number }> {
  const db = getDb();
  const rows = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  const asset = rows[0];
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  // Skip if already embedded (unless force)
  if (asset.embedding && !options.force) {
    return { skipped: true, assetId };
  }

  const embeddingBuf = await generateAssetEmbedding(asset);
  if (!embeddingBuf) {
    console.warn(`[EmbeddingService] Could not generate embedding for asset ${assetId} — image unavailable`);
    return { skipped: true, assetId };
  }

  await db.update(assets).set({ embedding: embeddingBuf }).where(eq(assets.id, assetId));
  return { skipped: false, assetId };
}

/**
 * Semantic vector search: find the top-k assets most similar to a text query.
 *
 * Uses Turso's libSQL vector extension (vector_top_k).
 * Falls back to category-filtered SQL if the vector index is not available.
 *
 * @param query       Natural language description (e.g. "Toni sitzt im Regen")
 * @param topK        Number of results to return (default: 10)
 * @param categories  Optional filter: only return assets in these categories
 */
export async function findAssetsByEmbedding(
  query: string,
  topK = 10,
  categories?: string[]
): Promise<Asset[]> {
  const db = getDb();

  let queryEmbedding: Buffer;
  try {
    queryEmbedding = await generateTextEmbedding(query);
  } catch (err) {
    console.error("[EmbeddingService] Failed to generate query embedding:", err);
    return [];
  }

  // Convert buffer to comma-separated float string for Turso vector_top_k
  const floatArr = bufferToFloat32(queryEmbedding);
  const vectorLiteral = `[${Array.from(floatArr).join(",")}]`;

  try {
    // Turso vector_top_k syntax:
    // SELECT * FROM vector_top_k('assets_embedding_idx', vector32('[...]'), k)
    // Returns rowid + distance. We join back to assets.
    const client = getLibSQLClient();

    let sql: string;
    let args: string[];

    if (categories && categories.length > 0) {
      const placeholders = categories.map(() => "?").join(", ");
      sql = `
        SELECT a.*
        FROM vector_top_k('assets_embedding_idx', vector32(?), ?) AS v
        JOIN assets a ON a.id = v.id
        WHERE a.category IN (${placeholders})
        ORDER BY v.distance ASC
        LIMIT ?
      `;
      args = [vectorLiteral, String(topK * 2), ...categories, String(topK)];
    } else {
      sql = `
        SELECT a.*
        FROM vector_top_k('assets_embedding_idx', vector32(?), ?) AS v
        JOIN assets a ON a.id = v.id
        ORDER BY v.distance ASC
        LIMIT ?
      `;
      args = [vectorLiteral, String(topK * 2), String(topK)];
    }

    const result = await client.execute({ sql, args });
    return result.rows as unknown as Asset[];
  } catch (err) {
    // Vector index not yet available (e.g. fresh DB without migration 0001)
    // Fall back to category-filtered SQL query
    console.warn(
      "[EmbeddingService] vector_top_k failed (index not ready?), falling back to category filter:",
      (err as Error).message
    );

    if (categories && categories.length > 0) {
      return db
        .select()
        .from(assets)
        .where(inArray(assets.category as any, categories))
        .limit(topK) as unknown as Promise<Asset[]>;
    }
    return db.select().from(assets).limit(topK);
  }
}

/**
 * Backfill embeddings for all assets that don't have one yet.
 * Processes in batches to avoid rate limits.
 * Safe to run multiple times (idempotent).
 *
 * @param batchSize  Assets per batch (default: 5 to respect Voyage rate limits)
 * @param delayMs    Delay between batches in ms (default: 1000)
 */
export async function backfillEmbeddings(
  batchSize = 5,
  delayMs = 1000
): Promise<{ total: number; embedded: number; skipped: number; errors: number }> {
  const db = getDb();
  const allAssets = await db.select().from(assets);
  const toEmbed = allAssets.filter((a) => !a.embedding);

  console.log(`[EmbeddingService] Backfill: ${toEmbed.length} assets need embeddings`);

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (asset) => {
        try {
          const result = await embedAsset(asset.id);
          if (result.skipped) skipped++;
          else embedded++;
        } catch (err) {
          errors++;
          console.error(`[EmbeddingService] Failed to embed asset ${asset.id}:`, err);
        }
      })
    );

    if (i + batchSize < toEmbed.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(
    `[EmbeddingService] Backfill complete: ${embedded} embedded, ${skipped} skipped, ${errors} errors`
  );
  return { total: toEmbed.length, embedded, skipped, errors };
}
