import { and, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  storyVariants,
  type InsertStoryVariant,
  type StoryVariant,
} from "../../../drizzle/schema";

export async function listVariantsForStory(storyId: string): Promise<StoryVariant[]> {
  return db
    .select()
    .from(storyVariants)
    .where(eq(storyVariants.storyId, storyId))
    .orderBy(storyVariants.createdAt);
}

export async function getStoryVariant(id: string): Promise<StoryVariant | undefined> {
  const [row] = await db
    .select()
    .from(storyVariants)
    .where(eq(storyVariants.id, id))
    .limit(1);
  return row;
}

export async function getPrimaryVariant(storyId: string): Promise<StoryVariant | undefined> {
  const [row] = await db
    .select()
    .from(storyVariants)
    .where(and(eq(storyVariants.storyId, storyId), eq(storyVariants.isPrimary, true)))
    .limit(1);
  return row;
}

export async function createStoryVariant(input: InsertStoryVariant): Promise<StoryVariant> {
  const [row] = await db.insert(storyVariants).values(input).returning();
  return row;
}

export async function updateStoryVariant(
  id: string,
  patch: Partial<InsertStoryVariant>,
): Promise<StoryVariant | undefined> {
  const [row] = await db
    .update(storyVariants)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(storyVariants.id, id))
    .returning();
  return row;
}

/**
 * Make `variantId` the primary variant of its story, atomically.
 * Demotes any other variant of the same story.
 */
export async function setPrimaryVariant(variantId: string): Promise<StoryVariant | undefined> {
  const variant = await getStoryVariant(variantId);
  if (!variant) return undefined;
  await db
    .update(storyVariants)
    .set({ isPrimary: false, updatedAt: new Date().toISOString() })
    .where(eq(storyVariants.storyId, variant.storyId));
  const [row] = await db
    .update(storyVariants)
    .set({ isPrimary: true, updatedAt: new Date().toISOString() })
    .where(eq(storyVariants.id, variantId))
    .returning();
  return row;
}

export async function deleteStoryVariant(id: string): Promise<void> {
  await db.delete(storyVariants).where(eq(storyVariants.id, id));
}
