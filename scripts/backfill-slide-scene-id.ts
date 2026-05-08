/**
 * One-off backfill: populate `slides.sceneId` for legacy rows from each
 * story's consistencyContext.
 *
 * Idempotent — slides whose sceneId is already set are skipped, so re-runs
 * are safe (and cheap).
 *
 * Usage:
 *   pnpm backfill:slide-scene-ids                # all stories
 *   pnpm backfill:slide-scene-ids --dry-run      # report only, no DB write
 *   pnpm backfill:slide-scene-ids --story=42     # one story by ID
 */

import "dotenv/config";

import { getStories, getSlidesByStoryId, updateSlide } from "../server/db";
import { findSceneForSlide, normalizeConsistencyContext } from "../server/storyService";

interface CliArgs {
  dryRun: boolean;
  storyId?: number;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--story=")) args.storyId = parseInt(a.slice("--story=".length), 10);
  }
  return args;
}

async function main() {
  const args = parseArgs();
  console.log(`[backfill] flags: ${JSON.stringify(args)}`);

  const allStories = await getStories();
  const stories = args.storyId
    ? allStories.filter((s) => s.id === args.storyId)
    : allStories;

  if (stories.length === 0) {
    console.log("[backfill] no stories matched");
    return;
  }

  console.log(`[backfill] processing ${stories.length} story/ies`);

  let updatedSlides = 0;
  let skippedAlreadySet = 0;
  let skippedNoCtx = 0;
  let skippedNoMatch = 0;

  for (const story of stories) {
    const ctx = normalizeConsistencyContext(story.consistencyContext);
    if (!ctx) {
      console.log(`[story ${story.id}] - skipped (no/invalid consistencyContext)`);
      skippedNoCtx++;
      continue;
    }

    const slides = await getSlidesByStoryId(story.id);
    let storyUpdated = 0;
    let storySkipped = 0;

    for (const slide of slides) {
      if (slide.sceneId) {
        skippedAlreadySet++;
        storySkipped++;
        continue;
      }
      const scene = findSceneForSlide(ctx, slide.slideNumber);
      if (!scene) {
        skippedNoMatch++;
        continue;
      }
      if (args.dryRun) {
        console.log(`  [dry] slide ${slide.id} (n=${slide.slideNumber}) -> ${scene.id}`);
      } else {
        await updateSlide(slide.id, { sceneId: scene.id });
      }
      updatedSlides++;
      storyUpdated++;
    }

    console.log(
      `[story ${story.id}] "${story.title}" — ${slides.length} slides, ` +
        `${storyUpdated} updated, ${storySkipped} already-set`
    );
  }

  console.log(
    `\n[backfill] done: ${updatedSlides} updated, ` +
      `${skippedAlreadySet} already-set, ${skippedNoCtx} no-ctx stories, ` +
      `${skippedNoMatch} no-scene-match`
  );
  if (args.dryRun) console.log("[backfill] dry-run — no DB writes performed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[backfill] fatal:", e);
    process.exit(1);
  });
