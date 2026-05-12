import { and, desc, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  promptRevisions,
  type InsertPromptRevision,
  type PromptRevision,
} from "../../../drizzle/schema";
import type { PromptKey } from "../../../shared/types/enums";

export async function createPromptRevision(
  input: InsertPromptRevision,
): Promise<PromptRevision> {
  const [row] = await db.insert(promptRevisions).values(input).returning();
  return row;
}

export async function listPromptRevisions(
  projectId: string,
  key?: PromptKey,
): Promise<PromptRevision[]> {
  const cond = key
    ? and(eq(promptRevisions.projectId, projectId), eq(promptRevisions.key, key))
    : eq(promptRevisions.projectId, projectId);
  return db
    .select()
    .from(promptRevisions)
    .where(cond)
    .orderBy(desc(promptRevisions.createdAt));
}

export async function getPromptRevision(id: string): Promise<PromptRevision | undefined> {
  const [row] = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.id, id))
    .limit(1);
  return row;
}

export async function deletePromptRevision(id: string): Promise<void> {
  await db.delete(promptRevisions).where(eq(promptRevisions.id, id));
}
