import { eq, sql } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  frames,
  type Frame,
  type InsertFrame,
} from "../../../drizzle/schema";

export async function listFramesForScene(sceneId: string): Promise<Frame[]> {
  return db
    .select()
    .from(frames)
    .where(eq(frames.sceneId, sceneId))
    .orderBy(frames.orderIndex);
}

export async function getFrame(id: string): Promise<Frame | undefined> {
  const [row] = await db.select().from(frames).where(eq(frames.id, id)).limit(1);
  return row;
}

export async function createFrame(input: InsertFrame): Promise<Frame> {
  const [row] = await db.insert(frames).values(input).returning();
  return row;
}

export async function updateFrame(
  id: string,
  patch: Partial<InsertFrame>,
): Promise<Frame | undefined> {
  const [row] = await db
    .update(frames)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(frames.id, id))
    .returning();
  return row;
}

export async function deleteFrame(id: string): Promise<void> {
  await db.delete(frames).where(eq(frames.id, id));
}

export async function moveFrame(
  frameId: string,
  sceneId: string,
  orderIndex: number,
): Promise<Frame | undefined> {
  return updateFrame(frameId, { sceneId, orderIndex });
}

export async function nextFrameOrderIndex(sceneId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(${frames.orderIndex}), -1)` })
    .from(frames)
    .where(eq(frames.sceneId, sceneId));
  return (row?.max ?? -1) + 1;
}

/**
 * Renumbers all frames in a scene to 0..N-1 in their current order.
 * Used after drag/drop reorders to ensure contiguous indices.
 */
export async function compactSceneOrder(sceneId: string): Promise<void> {
  const list = await listFramesForScene(sceneId);
  for (let i = 0; i < list.length; i++) {
    if (list[i]!.orderIndex !== i) {
      await db
        .update(frames)
        .set({ orderIndex: i, updatedAt: new Date().toISOString() })
        .where(eq(frames.id, list[i]!.id));
    }
  }
}
