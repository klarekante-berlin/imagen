import { and, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  characters,
  type Character,
  type InsertCharacter,
} from "../../../drizzle/schema";

export async function listCharacters(projectId: string): Promise<Character[]> {
  return db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId))
    .orderBy(characters.name);
}

export async function getCharacter(id: string): Promise<Character | undefined> {
  const [row] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  return row;
}

export async function createCharacter(input: InsertCharacter): Promise<Character> {
  const [row] = await db.insert(characters).values(input).returning();
  return row;
}

export async function updateCharacter(
  id: string,
  patch: Partial<InsertCharacter>,
): Promise<Character | undefined> {
  const [row] = await db
    .update(characters)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(characters.id, id))
    .returning();
  return row;
}

export async function deleteCharacter(id: string): Promise<void> {
  await db.delete(characters).where(eq(characters.id, id));
}

export async function findCharacterByName(
  projectId: string,
  name: string,
): Promise<Character | undefined> {
  const [row] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.projectId, projectId), eq(characters.name, name)))
    .limit(1);
  return row;
}
