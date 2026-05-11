import { eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assetVariants,
  type AssetVariant,
  type InsertAssetVariant,
} from "../../../drizzle/schema";

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
