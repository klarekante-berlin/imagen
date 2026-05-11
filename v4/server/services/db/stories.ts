import { desc, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  stories,
  type InsertStory,
  type Story,
} from "../../../drizzle/schema";

export async function listStories(): Promise<Story[]> {
  return db.select().from(stories).orderBy(desc(stories.updatedAt));
}

export async function listStoriesForProject(projectId: string): Promise<Story[]> {
  return db
    .select()
    .from(stories)
    .where(eq(stories.projectId, projectId))
    .orderBy(desc(stories.updatedAt));
}

export async function getStory(id: string): Promise<Story | undefined> {
  const [row] = await db.select().from(stories).where(eq(stories.id, id)).limit(1);
  return row;
}

export async function createStory(input: InsertStory): Promise<Story> {
  const [row] = await db.insert(stories).values(input).returning();
  return row;
}

export async function updateStory(
  id: string,
  patch: Partial<InsertStory>,
): Promise<Story | undefined> {
  const [row] = await db
    .update(stories)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, id))
    .returning();
  return row;
}

export async function deleteStory(id: string): Promise<void> {
  await db.delete(stories).where(eq(stories.id, id));
}
