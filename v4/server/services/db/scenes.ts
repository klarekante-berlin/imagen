import { eq, sql } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  scenes,
  type InsertScene,
  type Scene,
} from "../../../drizzle/schema";

export async function listScenesForVariant(storyVariantId: string): Promise<Scene[]> {
  return db
    .select()
    .from(scenes)
    .where(eq(scenes.storyVariantId, storyVariantId))
    .orderBy(scenes.orderIndex);
}

export async function getScene(id: string): Promise<Scene | undefined> {
  const [row] = await db.select().from(scenes).where(eq(scenes.id, id)).limit(1);
  return row;
}

export async function createScene(input: InsertScene): Promise<Scene> {
  const [row] = await db.insert(scenes).values(input).returning();
  return row;
}

export async function updateScene(
  id: string,
  patch: Partial<InsertScene>,
): Promise<Scene | undefined> {
  const [row] = await db
    .update(scenes)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(scenes.id, id))
    .returning();
  return row;
}

export async function deleteScene(id: string): Promise<void> {
  await db.delete(scenes).where(eq(scenes.id, id));
}

export async function reorderScenes(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(scenes)
      .set({ orderIndex: i, updatedAt: new Date().toISOString() })
      .where(eq(scenes.id, orderedIds[i]!));
  }
}

export async function nextSceneOrderIndex(storyVariantId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(${scenes.orderIndex}), -1)` })
    .from(scenes)
    .where(eq(scenes.storyVariantId, storyVariantId));
  return (row?.max ?? -1) + 1;
}
