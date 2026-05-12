import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assetVariants,
  type AssetVariant,
  type InsertAssetVariant,
} from "../../../drizzle/schema";
import type { AssetVariantKind } from "../../../shared/types/enums";
import { bufferToF32, cosineSimilarity } from "../ai/voyage";

export async function listVariantsForAsset(parentAssetId: string): Promise<AssetVariant[]> {
  return db
    .select()
    .from(assetVariants)
    .where(eq(assetVariants.parentAssetId, parentAssetId));
}

export async function getVariant(id: string): Promise<AssetVariant | undefined> {
  const [row] = await db
    .select()
    .from(assetVariants)
    .where(eq(assetVariants.id, id))
    .limit(1);
  return row;
}

export async function createVariant(input: InsertAssetVariant): Promise<AssetVariant> {
  const [row] = await db.insert(assetVariants).values(input).returning();
  return row;
}

export async function setVariantEmbedding(id: string, embedding: Buffer): Promise<void> {
  await db
    .update(assetVariants)
    .set({ embedding })
    .where(eq(assetVariants.id, id));
}

export async function deleteVariant(id: string): Promise<void> {
  await db.delete(assetVariants).where(eq(assetVariants.id, id));
}

export async function deleteVariantsForAsset(parentAssetId: string): Promise<void> {
  await db.delete(assetVariants).where(eq(assetVariants.parentAssetId, parentAssetId));
}

export async function listAllVariants(filters?: {
  kinds?: AssetVariantKind[];
  parentAssetIds?: string[];
}): Promise<AssetVariant[]> {
  const wheres = [] as ReturnType<typeof eq>[];
  if (filters?.kinds && filters.kinds.length > 0) {
    wheres.push(inArray(assetVariants.kind, filters.kinds));
  }
  if (filters?.parentAssetIds && filters.parentAssetIds.length > 0) {
    wheres.push(inArray(assetVariants.parentAssetId, filters.parentAssetIds));
  }
  const query = wheres.length > 0
    ? db.select().from(assetVariants).where(and(...wheres))
    : db.select().from(assetVariants);
  return query.orderBy(desc(assetVariants.createdAt));
}

export async function countVariants(): Promise<{
  total: number;
  embedded: number;
  byKind: Record<string, number>;
  distinctParents: number;
}> {
  const rows = await db.select().from(assetVariants);
  let embedded = 0;
  const byKind: Record<string, number> = {};
  const parents = new Set<string>();
  for (const r of rows) {
    if (r.embedding) embedded++;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    parents.add(r.parentAssetId);
  }
  return { total: rows.length, embedded, byKind, distinctParents: parents.size };
}

/** In-memory cosine search over variant embeddings. */
export async function searchVariantsByEmbedding(
  queryEmbedding: Buffer,
  topK = 10,
): Promise<Array<{ variant: AssetVariant; score: number }>> {
  const rows = await db
    .select()
    .from(assetVariants)
    .where(isNotNull(assetVariants.embedding));
  const q = bufferToF32(queryEmbedding);
  const scored = rows.map((variant) => ({
    variant,
    score: variant.embedding
      ? cosineSimilarity(q, bufferToF32(variant.embedding as Buffer))
      : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
