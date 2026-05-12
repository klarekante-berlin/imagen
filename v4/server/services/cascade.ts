import { eq, inArray } from "drizzle-orm";
import { db } from "../_core/db";
import {
  frames,
  renditions,
  scenes,
  stories,
  storyVariants,
} from "../../drizzle/schema";
import {
  detachAllForRef,
  detachAllForScope,
  reassignRef,
} from "./db/attachments";
import { reassignCharacterAssets } from "./db/assets";
import {
  deleteCharacter,
  getCharacter,
  updateCharacter,
} from "./db/characters";
import { storageDelete } from "./storage";

/**
 * Delete a story plus everything that hangs off it:
 * variants → scenes → frames → renditions (incl. storage files),
 * and any attachments scoped to the story or its variants.
 * Returns counts so the caller can surface them in a toast.
 */
export async function cascadeDeleteStory(storyId: string): Promise<{
  variants: number;
  scenes: number;
  frames: number;
  renditions: number;
  storageDeleted: number;
}> {
  const variantRows = await db
    .select({ id: storyVariants.id })
    .from(storyVariants)
    .where(eq(storyVariants.storyId, storyId));
  const variantIds = variantRows.map((v) => v.id);

  const sceneRows = variantIds.length
    ? await db
        .select({ id: scenes.id })
        .from(scenes)
        .where(inArray(scenes.storyVariantId, variantIds))
    : [];
  const sceneIds = sceneRows.map((s) => s.id);

  const frameRows = sceneIds.length
    ? await db
        .select({ id: frames.id })
        .from(frames)
        .where(inArray(frames.sceneId, sceneIds))
    : [];
  const frameIds = frameRows.map((f) => f.id);

  const renditionRows = frameIds.length
    ? await db
        .select({ id: renditions.id, imageKey: renditions.imageKey })
        .from(renditions)
        .where(inArray(renditions.frameId, frameIds))
    : [];

  let storageDeleted = 0;
  for (const r of renditionRows) {
    if (r.imageKey) {
      try {
        await storageDelete(r.imageKey);
        storageDeleted++;
      } catch (err) {
        console.warn(`[v4 cascade] storage delete failed for ${r.imageKey}:`, (err as Error).message);
      }
    }
  }

  if (renditionRows.length) {
    await db.delete(renditions).where(
      inArray(renditions.id, renditionRows.map((r) => r.id)),
    );
  }
  if (frameIds.length) {
    await db.delete(frames).where(inArray(frames.id, frameIds));
  }
  if (sceneIds.length) {
    await db.delete(scenes).where(inArray(scenes.id, sceneIds));
  }
  if (variantIds.length) {
    await db.delete(storyVariants).where(inArray(storyVariants.id, variantIds));
  }

  // Attachments scoped to the story or any of its variants.
  await detachAllForScope("story", storyId);
  for (const vid of variantIds) {
    await detachAllForScope("story_variant", vid);
  }
  // Attachments that reference the story itself (rare but defensive).
  await detachAllForRef("asset", storyId);

  await db.delete(stories).where(eq(stories.id, storyId));

  return {
    variants: variantIds.length,
    scenes: sceneIds.length,
    frames: frameIds.length,
    renditions: renditionRows.length,
    storageDeleted,
  };
}

/**
 * Merge `sourceId` into `targetId`:
 *  - all assets bound to source.characterId → target.characterId
 *  - all attachments with (ref='character', refId=source) → refId=target
 *    (collisions with existing attachments to target are dropped)
 *  - target absorbs source.name + source.aliases into its aliases list
 *  - source character is deleted
 *
 * The two characters must be distinct. Throws on (a) same id, (b) either id missing.
 */
export async function mergeCharacters(
  sourceId: string,
  targetId: string,
): Promise<{
  assetsMoved: number;
  attachmentsMoved: number;
  attachmentsDropped: number;
  aliasesAdded: number;
}> {
  if (sourceId === targetId) {
    throw new Error("Source and target must differ");
  }
  const source = await getCharacter(sourceId);
  const target = await getCharacter(targetId);
  if (!source) throw new Error(`Source character ${sourceId} not found`);
  if (!target) throw new Error(`Target character ${targetId} not found`);

  const assetsMoved = await reassignCharacterAssets(sourceId, targetId);
  const { moved: attachmentsMoved, dropped: attachmentsDropped } =
    await reassignRef("character", sourceId, targetId);

  const existingAliases = new Set(
    (target.aliasesJson ?? []).map((a) => a.trim().toLowerCase()),
  );
  const candidates = [source.name, ...(source.aliasesJson ?? [])]
    .map((a) => a.trim())
    .filter(Boolean)
    .filter((a) => a.toLowerCase() !== target.name.trim().toLowerCase())
    .filter((a) => !existingAliases.has(a.toLowerCase()));
  const seen = new Set<string>();
  const additions: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(c);
  }
  if (additions.length > 0) {
    await updateCharacter(targetId, {
      aliasesJson: [...(target.aliasesJson ?? []), ...additions],
    });
  }

  await detachAllForRef("character", sourceId);
  await deleteCharacter(sourceId);

  return {
    assetsMoved,
    attachmentsMoved,
    attachmentsDropped,
    aliasesAdded: additions.length,
  };
}
