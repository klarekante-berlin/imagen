import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  characters,
  type Character,
  type InsertCharacter,
} from "../../../drizzle/schema";
import { listRefIdsForScope } from "./attachments";

export async function listAllCharacters(): Promise<Character[]> {
  return db.select().from(characters).orderBy(desc(characters.updatedAt));
}

export async function listCharactersForProject(projectId: string): Promise<Character[]> {
  const refIds = await listRefIdsForScope("project", projectId, "character");
  if (refIds.length === 0) return [];
  return db
    .select()
    .from(characters)
    .where(inArray(characters.id, refIds))
    .orderBy(characters.name);
}

export async function listCharactersForWorld(worldId: string): Promise<Character[]> {
  return db
    .select()
    .from(characters)
    .where(eq(characters.worldId, worldId))
    .orderBy(characters.name);
}

export async function listFloatingCharacters(): Promise<Character[]> {
  return db
    .select()
    .from(characters)
    .where(and(isNull(characters.worldId), isNull(characters.projectId)))
    .orderBy(characters.name);
}

/** Case-insensitive match on name or any alias. Returns the first hit. */
export async function findCharacterByNameOrAlias(
  name: string,
): Promise<Character | undefined> {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  const all = await db.select().from(characters);
  return all.find((c) => {
    if (c.name.trim().toLowerCase() === needle) return true;
    const aliases = c.aliasesJson ?? [];
    return aliases.some((a) => a.trim().toLowerCase() === needle);
  });
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
