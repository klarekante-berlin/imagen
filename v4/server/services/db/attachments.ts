import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  attachments,
  type Attachment,
  type InsertAttachment,
} from "../../../drizzle/schema";
import type {
  AttachmentRef,
  AttachmentScope,
} from "../../../shared/types/enums";

export async function attach(input: InsertAttachment): Promise<Attachment> {
  const [existing] = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.scope, input.scope),
        eq(attachments.scopeId, input.scopeId),
        eq(attachments.ref, input.ref),
        eq(attachments.refId, input.refId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [row] = await db.insert(attachments).values(input).returning();
  return row;
}

export async function detach(
  scope: AttachmentScope,
  scopeId: string,
  ref: AttachmentRef,
  refId: string,
): Promise<void> {
  await db
    .delete(attachments)
    .where(
      and(
        eq(attachments.scope, scope),
        eq(attachments.scopeId, scopeId),
        eq(attachments.ref, ref),
        eq(attachments.refId, refId),
      ),
    );
}

export async function detachAllForRef(
  ref: AttachmentRef,
  refId: string,
): Promise<void> {
  await db
    .delete(attachments)
    .where(and(eq(attachments.ref, ref), eq(attachments.refId, refId)));
}

export async function listByScope(
  scope: AttachmentScope,
  scopeId: string,
  ref?: AttachmentRef,
): Promise<Attachment[]> {
  const cond = ref
    ? and(
        eq(attachments.scope, scope),
        eq(attachments.scopeId, scopeId),
        eq(attachments.ref, ref),
      )
    : and(eq(attachments.scope, scope), eq(attachments.scopeId, scopeId));
  return db.select().from(attachments).where(cond);
}

export async function listByRef(
  ref: AttachmentRef,
  refId: string,
): Promise<Attachment[]> {
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.ref, ref), eq(attachments.refId, refId)));
}

export async function listRefIdsForScope(
  scope: AttachmentScope,
  scopeId: string,
  ref: AttachmentRef,
): Promise<string[]> {
  const rows = await listByScope(scope, scopeId, ref);
  return rows.map((r) => r.refId);
}

export async function listScopeIdsForRef(
  ref: AttachmentRef,
  refId: string,
  scope?: AttachmentScope,
): Promise<string[]> {
  const cond = scope
    ? and(
        eq(attachments.ref, ref),
        eq(attachments.refId, refId),
        eq(attachments.scope, scope),
      )
    : and(eq(attachments.ref, ref), eq(attachments.refId, refId));
  const rows = await db.select().from(attachments).where(cond);
  return rows.map((r) => r.scopeId);
}

export async function manyByRefIds(
  ref: AttachmentRef,
  refIds: string[],
): Promise<Attachment[]> {
  if (refIds.length === 0) return [];
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.ref, ref), inArray(attachments.refId, refIds)));
}
