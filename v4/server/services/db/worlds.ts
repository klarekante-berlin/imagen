import { desc, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  worlds,
  type InsertWorld,
  type World,
} from "../../../drizzle/schema";

export async function listWorlds(): Promise<World[]> {
  return db.select().from(worlds).orderBy(desc(worlds.updatedAt));
}

export async function getWorld(id: string): Promise<World | undefined> {
  const [row] = await db.select().from(worlds).where(eq(worlds.id, id)).limit(1);
  return row;
}

export async function getWorldByName(name: string): Promise<World | undefined> {
  const [row] = await db.select().from(worlds).where(eq(worlds.name, name)).limit(1);
  return row;
}

export async function createWorld(input: InsertWorld): Promise<World> {
  const [row] = await db.insert(worlds).values(input).returning();
  return row;
}

export async function updateWorld(
  id: string,
  patch: Partial<InsertWorld>,
): Promise<World | undefined> {
  const [row] = await db
    .update(worlds)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(worlds.id, id))
    .returning();
  return row;
}

export async function deleteWorld(id: string): Promise<void> {
  await db.delete(worlds).where(eq(worlds.id, id));
}
