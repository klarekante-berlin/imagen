import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assets,
  type Asset,
  type InsertAsset,
} from "../../../drizzle/schema";
import type { AssetKind } from "../../../shared/types/enums";
import { bufferToF32, cosineSimilarity } from "../ai/voyage";

export async function listAssetsForProject(
  projectId: string,
  kinds?: AssetKind[],
): Promise<Asset[]> {
  const projectFilter = eq(assets.projectId, projectId);
  const cond = kinds && kinds.length > 0
    ? and(projectFilter, inArray(assets.kind, kinds))
    : projectFilter;
  return db.select().from(assets).where(cond);
}

export async function listAssetsForCharacter(characterId: string): Promise<Asset[]> {
  return db.select().from(assets).where(eq(assets.characterId, characterId));
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row;
}

export async function getAssetByContentHash(hash: string): Promise<Asset | undefined> {
  const [row] = await db
    .select()
    .from(assets)
    .where(eq(assets.contentHash, hash))
    .limit(1);
  return row;
}

export async function createAsset(input: InsertAsset): Promise<Asset> {
  const [row] = await db.insert(assets).values(input).returning();
  return row;
}

export async function updateAsset(
  id: string,
  patch: Partial<InsertAsset>,
): Promise<Asset | undefined> {
  const [row] = await db
    .update(assets)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(assets.id, id))
    .returning();
  return row;
}

export async function setAssetEmbedding(id: string, embedding: Buffer): Promise<void> {
  await db
    .update(assets)
    .set({ embedding, updatedAt: new Date().toISOString() })
    .where(eq(assets.id, id));
}

export async function deleteAsset(id: string): Promise<Asset | undefined> {
  const [row] = await db.delete(assets).where(eq(assets.id, id)).returning();
  return row;
}

export async function listAssetsMissingEmbeddings(projectId?: string): Promise<Asset[]> {
  const cond = projectId
    ? and(eq(assets.projectId, projectId), isNull(assets.embedding))
    : isNull(assets.embedding);
  return db.select().from(assets).where(cond);
}

/**
 * In-memory cosine search across project assets. Fine for libraries up to a
 * few thousand sheets; revisit with vector_top_k when Turso is in play.
 */
export async function searchAssetsByEmbedding(
  projectId: string,
  queryEmbedding: Buffer,
  topK = 10,
  kinds?: AssetKind[],
): Promise<Array<{ asset: Asset; score: number }>> {
  const baseCond = and(eq(assets.projectId, projectId), isNotNull(assets.embedding));
  const cond = kinds && kinds.length > 0 ? and(baseCond, inArray(assets.kind, kinds)) : baseCond;
  const rows = await db.select().from(assets).where(cond);
  const q = bufferToF32(queryEmbedding);
  const scored = rows.map((asset) => ({
    asset,
    score: asset.embedding ? cosineSimilarity(q, bufferToF32(asset.embedding as Buffer)) : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
