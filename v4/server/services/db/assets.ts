import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assets,
  type Asset,
  type InsertAsset,
} from "../../../drizzle/schema";
import type { AssetKind } from "../../../shared/types/enums";
import { bufferToF32, cosineSimilarity } from "../ai/voyage";
import { listRefIdsForScope } from "./attachments";

export async function listAllAssets(kinds?: AssetKind[]): Promise<Asset[]> {
  const cond = kinds && kinds.length > 0 ? inArray(assets.kind, kinds) : undefined;
  const q = db.select().from(assets).orderBy(desc(assets.createdAt));
  return cond ? q.where(cond) : q;
}

export async function listAssetsForProject(
  projectId: string,
  kinds?: AssetKind[],
): Promise<Asset[]> {
  const refIds = await listRefIdsForScope("project", projectId, "asset");
  if (refIds.length === 0) return [];
  const cond = kinds && kinds.length > 0
    ? and(inArray(assets.id, refIds), inArray(assets.kind, kinds))
    : inArray(assets.id, refIds);
  return db.select().from(assets).where(cond).orderBy(desc(assets.createdAt));
}

export async function listAssetsForWorld(
  worldId: string,
  kinds?: AssetKind[],
): Promise<Asset[]> {
  const cond = kinds && kinds.length > 0
    ? and(eq(assets.worldId, worldId), inArray(assets.kind, kinds))
    : eq(assets.worldId, worldId);
  return db.select().from(assets).where(cond).orderBy(desc(assets.createdAt));
}

export async function listAssetsForCharacter(characterId: string): Promise<Asset[]> {
  return db
    .select()
    .from(assets)
    .where(eq(assets.characterId, characterId))
    .orderBy(desc(assets.createdAt));
}

export async function reassignCharacterAssets(
  fromCharacterId: string,
  toCharacterId: string,
): Promise<number> {
  const rows = await db
    .update(assets)
    .set({
      characterId: toCharacterId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(assets.characterId, fromCharacterId))
    .returning({ id: assets.id });
  return rows.length;
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

export async function countAssets(): Promise<{
  total: number;
  embedded: number;
  withVisualDescription: number;
  withVisionConfidence: number;
  byKind: Record<string, number>;
  lastUpdated: string | null;
}> {
  const rows = await db.select().from(assets);
  let embedded = 0;
  let withVisualDescription = 0;
  let withVisionConfidence = 0;
  const byKind: Record<string, number> = {};
  let lastUpdated: string | null = null;
  for (const r of rows) {
    if (r.embedding) embedded++;
    if (r.visualDescription && r.visualDescription.trim().length > 0) withVisualDescription++;
    if (typeof r.metadataJson?.visionConfidence === "number") withVisionConfidence++;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    if (!lastUpdated || r.updatedAt > lastUpdated) lastUpdated = r.updatedAt;
  }
  return {
    total: rows.length,
    embedded,
    withVisualDescription,
    withVisionConfidence,
    byKind,
    lastUpdated,
  };
}

/**
 * In-memory cosine search. Optional projectId scopes via attachments,
 * worldId via FK, kinds via column. Fine for libraries up to a few thousand
 * sheets; revisit with vector_top_k when Turso is in play.
 */
export async function searchAssetsByEmbedding(
  queryEmbedding: Buffer,
  topK = 10,
  filters?: {
    projectId?: string;
    worldId?: string;
    kinds?: AssetKind[];
  },
): Promise<Array<{ asset: Asset; score: number }>> {
  const wheres = [isNotNull(assets.embedding)];

  if (filters?.projectId) {
    const refIds = await listRefIdsForScope("project", filters.projectId, "asset");
    if (refIds.length === 0) return [];
    wheres.push(inArray(assets.id, refIds));
  }
  if (filters?.worldId) wheres.push(eq(assets.worldId, filters.worldId));
  if (filters?.kinds && filters.kinds.length > 0) {
    wheres.push(inArray(assets.kind, filters.kinds));
  }

  const rows = await db
    .select()
    .from(assets)
    .where(and(...wheres));

  const q = bufferToF32(queryEmbedding);
  const scored = rows.map((asset) => ({
    asset,
    score: asset.embedding ? cosineSimilarity(q, bufferToF32(asset.embedding as Buffer)) : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
