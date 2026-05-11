import { eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  renditions,
  type InsertRendition,
  type Rendition,
} from "../../../drizzle/schema";

export async function listRenditionsForFrame(frameId: string): Promise<Rendition[]> {
  return db
    .select()
    .from(renditions)
    .where(eq(renditions.frameId, frameId))
    .orderBy(renditions.generatedAt);
}

export async function getRendition(id: string): Promise<Rendition | undefined> {
  const [row] = await db
    .select()
    .from(renditions)
    .where(eq(renditions.id, id))
    .limit(1);
  return row;
}

export async function createRendition(input: InsertRendition): Promise<Rendition> {
  const [row] = await db.insert(renditions).values(input).returning();
  return row;
}

export async function deleteRendition(id: string): Promise<Rendition | undefined> {
  const [row] = await db.delete(renditions).where(eq(renditions.id, id)).returning();
  return row;
}
