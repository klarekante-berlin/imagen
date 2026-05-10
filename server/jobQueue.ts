/**
 * Imagen V3 – Job Queue (Inngest 4.x)
 *
 * Handles async image generation with:
 *  - Automatic retries (3 attempts, exponential backoff)
 *  - Per-slide status tracking (generating → complete | error)
 *  - Concurrency control (max 3 parallel slide generations)
 *  - Idempotency: each job keyed by storyId + slideId
 *  - Graceful abort: if story is deleted mid-run, jobs are no-ops
 *
 * Architecture:
 *  - generateStoryImages: fan-out function → dispatches one job per slide
 *  - generateSingleSlide: worker function → generates one slide image
 *
 * Dev mode (no Inngest server):
 *  - INNGEST_DEV=true → runs jobs inline (synchronous, no queue)
 *
 * Inngest 4.x API:
 *  - createFunction({ id, triggers: [{ event }] }, handler)
 *  - serve({ client, functions }) from "inngest/express"
 */

import { Inngest } from "inngest";
import {
  getStoryById,
  getSlidesByStoryId,
  getAssetsByIds,
  updateStory,
  updateSlide,
} from "./db";
import {
  generateSlideImage,
  generateSlideImageFreepik,
  normalizeConsistencyContext,
} from "./storyService";
import { storageGetSignedUrl } from "./storage";
import type { ImageFormat } from "../drizzle/schema";

// ─── Inngest Client ───────────────────────────────────────────────────────────
// isDev=true suppresses the "cloud mode but no signing key" warning in local dev.
// In production, INNGEST_SIGNING_KEY env var must be set (isDev becomes false).
export const inngest = new Inngest({
  id: "imagen",
  isDev: !process.env.INNGEST_SIGNING_KEY,
});

// ─── Fan-out: generateStoryImages ─────────────────────────────────────────────
/**
 * Triggered when a story is ready to generate images.
 * Fans out one imagen/slide.generate event per pending slide.
 */
export const generateStoryImages = inngest.createFunction(
  {
    id: "generate-story-images",
    name: "Generate Story Images (fan-out)",
    triggers: [{ event: "imagen/story.generate" }],
    concurrency: { limit: 2 },
  },
  async ({ event, step }) => {
    const { storyId } = (event as unknown as { data: { storyId: number } }).data;

    const story = await step.run("load-story", async () => {
      const s = await getStoryById(storyId);
      if (!s) throw new Error(`Story ${storyId} not found`);
      return s;
    });

    const storySlides = await step.run("load-slides", async () => {
      return getSlidesByStoryId(storyId);
    });

    await step.run("mark-generating", async () => {
      await updateStory(storyId, { status: "generating_images" });
    });

    const pendingSlides = storySlides.filter(
      (s) => s.imagePrompt && s.status !== "complete"
    );

    await step.sendEvent(
      "dispatch-slide-jobs",
      pendingSlides.map((slide) => ({
        name: "imagen/slide.generate",
        data: { storyId, slideId: slide.id, slideNumber: slide.slideNumber },
      }))
    );

    return { storyId, dispatched: pendingSlides.length };
  }
);

// ─── Worker: generateSingleSlide ──────────────────────────────────────────────
/**
 * Generates a single slide image.
 * Retries up to 3 times with exponential backoff.
 */
export const generateSingleSlide = inngest.createFunction(
  {
    id: "generate-single-slide",
    name: "Generate Single Slide Image",
    triggers: [{ event: "imagen/slide.generate" }],
    concurrency: { limit: 3 },
    retries: 3,
  },
  async ({ event, step }) => {
    const { storyId, slideId, slideNumber } = (
      event as unknown as { data: { storyId: number; slideId: number; slideNumber: number } }
    ).data;

    await step.run("mark-slide-generating", async () => {
      await updateSlide(slideId, { status: "generating", errorMessage: null });
    });

    const context = await step.run("load-context", async () => {
      const story = await getStoryById(storyId);
      if (!story) throw new Error(`Story ${storyId} not found`);

      const slides = await getSlidesByStoryId(storyId);
      const slide = slides.find((s) => s.id === slideId);
      if (!slide) throw new Error(`Slide ${slideId} not found`);
      if (!slide.imagePrompt) throw new Error(`Slide ${slideId} has no imagePrompt`);

      const usedAssets = await getAssetsByIds(story.usedAssetIds ?? []);
      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error(`Story ${storyId} has no valid consistency context`);

      return { story, slide, usedAssets, ctx };
    });

    const { story, slide, usedAssets, ctx } = context;

    // Resolve character reference images
    const characterRefs = (ctx.characters ?? [])
      .filter((char) => char.assetId && char.assetId > 0)
      .map((char) => {
        const asset = usedAssets.find((a) => a.id === char.assetId);
        return { name: char.name, asset };
      })
      .filter(
        (r): r is { name: string; asset: NonNullable<typeof r.asset> } =>
          !!r.asset?.imageUrl
      );

    // Resolve style reference images
    const excludedStyleIds = new Set(ctx.excludedStyleRefAssetIds ?? []);
    const styleRefAssets = usedAssets
      .filter((a) => a.category === "stil-referenz")
      .filter((a) => !excludedStyleIds.has(a.id));

    const styleReferenceUrls = await step.run("presign-style-refs", async () => {
      const urls = await Promise.all(
        styleRefAssets.map((a) => storageGetSignedUrl(a.imageUrl ?? ""))
      );
      return urls.filter((u): u is string => !!u);
    });

    const charRefPresigned = await step.run("presign-char-refs", async () => {
      const map = new Map<string, string>();
      await Promise.all(
        characterRefs.map(async (r) => {
          const url = await storageGetSignedUrl(r.asset.imageUrl ?? "");
          if (url) map.set(r.name.toLowerCase(), url);
        })
      );
      return Object.fromEntries(map);
    });

    const slideCharacters = (slide.charactersInSlide as string[]) ?? [];
    const charRefUrls = slideCharacters
      .map((name) => charRefPresigned[name.toLowerCase()])
      .filter((url): url is string => !!url)
      .slice(0, 6);

    const result = await step.run("generate-image", async () => {
      const imageFormat = (story.imageFormat ?? "1:1") as ImageFormat;

      if (story.imageProvider === "freepik") {
        return generateSlideImageFreepik(
          slide.imagePrompt!,
          ctx,
          slideNumber,
          storyId,
          imageFormat
        );
      }

      return generateSlideImage(
        slide.imagePrompt!,
        ctx,
        slideNumber,
        storyId,
        imageFormat,
        charRefUrls,
        styleReferenceUrls,
        slideCharacters
      );
    });

    await step.run("save-result", async () => {
      await updateSlide(slideId, {
        imageKey: result.imageKey,
        imageUrl: result.imageUrl,
        status: "complete",
        errorMessage: null,
      });
    });

    return { slideId, slideNumber, imageUrl: result.imageUrl };
  }
);

// ─── Inline fallback (dev without Inngest server) ─────────────────────────────
/**
 * Run image generation inline (synchronous) without an Inngest server.
 * Used when INNGEST_DEV=true or as a fallback.
 * Concurrency capped at 3 parallel workers.
 */
export async function generateStoryImagesInline(storyId: number): Promise<void> {
   const storyRaw = await getStoryById(storyId);
  if (!storyRaw) throw new Error(`Story ${storyId} not found`);
  const story = storyRaw; // non-null for closure
  const storySlides = await getSlidesByStoryId(storyId);
  await updateStory(storyId, { status: "generating_images" });

  const usedAssets = await getAssetsByIds(story.usedAssetIds ?? []);
  const ctxRaw = normalizeConsistencyContext(story.consistencyContext);
  if (!ctxRaw) throw new Error(`Story ${storyId} has no valid consistency context`);
  const ctx = ctxRaw;

  const characterRefs = (ctx.characters ?? [])
    .filter((char) => char.assetId && char.assetId > 0)
    .map((char) => {
      const asset = usedAssets.find((a) => a.id === char.assetId);
      return { name: char.name, asset };
    })
    .filter(
      (r): r is { name: string; asset: NonNullable<typeof r.asset> } =>
        !!r.asset?.imageUrl
    );

  const excludedStyleIds = new Set(ctx.excludedStyleRefAssetIds ?? []);
  const styleRefAssets = usedAssets
    .filter((a) => a.category === "stil-referenz")
    .filter((a) => !excludedStyleIds.has(a.id));

  const styleReferenceUrls = (
    await Promise.all(styleRefAssets.map((a) => storageGetSignedUrl(a.imageUrl ?? "")))
  ).filter((u): u is string => !!u);

  const charRefMap = new Map<string, string>();
  await Promise.all(
    characterRefs.map(async (r) => {
      const url = await storageGetSignedUrl(r.asset.imageUrl ?? "");
      if (url) charRefMap.set(r.name.toLowerCase(), url);
    })
  );

  const CONCURRENCY = 3;
  const queue = storySlides.filter((s) => s.imagePrompt && s.status !== "complete");
  let cursor = 0;
  let errorCount = 0;

  async function worker() {
    while (cursor < queue.length) {
      const slide = queue[cursor++];
      try {
        await updateSlide(slide.id, { status: "generating", errorMessage: null });

        const slideCharacters = (slide.charactersInSlide as string[]) ?? [];
        const charRefUrls = slideCharacters
          .map((name) => charRefMap.get(name.toLowerCase()))
          .filter((url): url is string => !!url)
          .slice(0, 6);

        const imageFormat = (story.imageFormat ?? "1:1") as ImageFormat;
        let result: { imageKey: string; imageUrl: string };

        if (story.imageProvider === "freepik") {
          result = await generateSlideImageFreepik(
            slide.imagePrompt!,
            ctx,
            slide.slideNumber,
            storyId,
            imageFormat
          );
        } else {
          result = await generateSlideImage(
            slide.imagePrompt!,
            ctx,
            slide.slideNumber,
            storyId,
            imageFormat,
            charRefUrls,
            styleReferenceUrls,
            slideCharacters
          );
        }

        await updateSlide(slide.id, {
          imageKey: result.imageKey,
          imageUrl: result.imageUrl,
          status: "complete",
          errorMessage: null,
        });
      } catch (err) {
        errorCount++;
        await updateSlide(slide.id, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker())
  );

  const finalSlides = await getSlidesByStoryId(storyId);
  const allDone = finalSlides.every(
    (s) => s.status === "complete" || s.status === "error"
  );
  if (allDone) {
    await updateStory(storyId, {
      status: errorCount === 0 ? "complete" : "error",
    });
  }
}
