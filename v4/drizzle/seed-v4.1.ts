import "dotenv/config";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../server/_core/db";
import {
  assets,
  attachments,
  characters,
  scenes,
  stories,
  storyVariants,
} from "./schema";

async function backfillStoryVariants() {
  const rows = await db
    .select({ id: stories.id })
    .from(stories)
    .leftJoin(storyVariants, eq(storyVariants.storyId, stories.id))
    .where(isNull(storyVariants.id));
  let inserted = 0;
  for (const r of rows) {
    await db.insert(storyVariants).values({
      storyId: r.id,
      name: "v1",
      isPrimary: true,
    });
    inserted++;
  }
  return inserted;
}

async function backfillSceneVariantIds() {
  const rows = await db
    .select({ sceneId: scenes.id, storyId: scenes.storyId })
    .from(scenes)
    .where(isNull(scenes.storyVariantId));
  let updated = 0;
  for (const r of rows) {
    const [v1] = await db
      .select({ id: storyVariants.id })
      .from(storyVariants)
      .where(and(eq(storyVariants.storyId, r.storyId), eq(storyVariants.isPrimary, true)))
      .limit(1);
    if (!v1) continue;
    await db
      .update(scenes)
      .set({ storyVariantId: v1.id })
      .where(eq(scenes.id, r.sceneId));
    updated++;
  }
  return updated;
}

async function backfillAssetProjectAttachments() {
  const rows = await db
    .select({ id: assets.id, projectId: assets.projectId })
    .from(assets);
  let inserted = 0;
  for (const r of rows) {
    if (!r.projectId) continue;
    try {
      await db.insert(attachments).values({
        scope: "project",
        scopeId: r.projectId,
        ref: "asset",
        refId: r.id,
      });
      inserted++;
    } catch {
      // already exists (unique index)
    }
  }
  return inserted;
}

async function backfillCharacterProjectAttachments() {
  const rows = await db
    .select({ id: characters.id, projectId: characters.projectId })
    .from(characters);
  let inserted = 0;
  for (const r of rows) {
    if (!r.projectId) continue;
    try {
      await db.insert(attachments).values({
        scope: "project",
        scopeId: r.projectId,
        ref: "character",
        refId: r.id,
      });
      inserted++;
    } catch {
      // already exists (unique index)
    }
  }
  return inserted;
}

async function main() {
  const v = await backfillStoryVariants();
  const s = await backfillSceneVariantIds();
  const a = await backfillAssetProjectAttachments();
  const c = await backfillCharacterProjectAttachments();
  console.log(
    `[v4 seed v4.1] story_variants:+${v}, scenes.variantId:+${s}, attachments(asset:+${a}, character:+${c})`,
  );
}

main().catch((err) => {
  console.error("[v4 seed v4.1] Failed:", err);
  process.exit(1);
});

// keep `sql` import alive — used implicitly by drizzle defaults below
void sql;
