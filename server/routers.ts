import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createAsset, getAssets, getAssetById, getAssetsByIds, updateAsset, deleteAsset,
  createStory, getStories, getStoryById, updateStory, deleteStory,
  createSlides, getSlidesByStoryId, getSlideById, updateSlide, updateSlideByStoryAndNumber,
} from "./db";
import { storagePut } from "./storage";
import {
  generateStoryText, generateSlideImage, generateSlideImageFreepik,
  ConsistencyContext, detectCharactersFromScript, getPresignedStorageUrl,
} from "./storyService";
import { ASSET_CATEGORIES } from "../drizzle/schema";
import type { TRPCError } from "@trpc/server";

// ─── Asset Router ─────────────────────────────────────────────────────────────

const assetRouter = router({
  list: publicProcedure
    .input(z.object({ category: z.string().optional() }))
    .query(async ({ input }) => {
      return getAssets(input.category);
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getAssetById(input.id);
    }),

  upload: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.enum(ASSET_CATEGORIES),
      description: z.string().optional(),
      visualDescription: z.string().optional(),
      tags: z.array(z.string()).optional(),
      // Base64 encoded image data
      imageData: z.string(),
      mimeType: z.string().default("image/png"),
      fileName: z.string().default("asset.png"),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.imageData, "base64");
      const key = `assets/${input.category}/${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      const id = await createAsset({
        name: input.name,
        category: input.category,
        description: input.description,
        visualDescription: input.visualDescription,
        tags: input.tags,
        imageKey: key,
        imageUrl: url,
      });

      return { id, imageKey: key, imageUrl: url };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      category: z.enum(ASSET_CATEGORIES).optional(),
      description: z.string().optional(),
      visualDescription: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateAsset(id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteAsset(input.id);
      return { success: true };
    }),

  categories: publicProcedure.query(() => ASSET_CATEGORIES),
});

// ─── Detect Characters Router ───────────────────────────────────────────────

const detectRouter = router({
  detectCharacters: publicProcedure
    .input(z.object({
      scriptOrTheme: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      // Load all assets for matching
      const allAssets = await getAssets();
      const detected = await detectCharactersFromScript(input.scriptOrTheme, allAssets);

      // Enrich with asset details
      const enriched = await Promise.all(
        detected.map(async (d) => {
          if (!d.suggestedAssetId) return { ...d, asset: null };
          const asset = await getAssetById(d.suggestedAssetId);
          return { ...d, asset: asset ?? null };
        })
      );

      return enriched;
    }),
});

// ─── Story Router ─────────────────────────────────────────────────────────────

const storyRouter = router({
  list: publicProcedure.query(async () => {
    return getStories();
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const story = await getStoryById(input.id);
      if (!story) return null;
      const storySlides = await getSlidesByStoryId(input.id);
      return { ...story, slides: storySlides };
    }),

  create: protectedProcedure
    .input(z.object({
      theme: z.string().min(1),
      selectedAssetIds: z.array(z.number()).default([]),
      model: z.enum(["claude-sonnet-4-6", "claude-opus-4-5"]).default("claude-sonnet-4-6"),
      imageFormat: z.enum(["1:1", "4:5"]).default("1:1"),
      imageProvider: z.enum(["gpt-image-2", "freepik"]).default("gpt-image-2"),
    }))
    .mutation(async ({ input }) => {
      // Fetch selected assets for context
      const selectedAssets = await getAssetsByIds(input.selectedAssetIds);

      // Generate story text via Claude
      const storyContent = await generateStoryText(
        input.theme,
        selectedAssets,
        input.model,
        input.imageFormat
      );

      // Create story in DB
      const storyId = await createStory({
        title: storyContent.title,
        theme: input.theme,
        status: "draft",
        model: input.model,
        imageProvider: input.imageProvider,
        imageFormat: input.imageFormat,
        consistencyContext: storyContent.consistencyContext,
        usedAssetIds: storyContent.usedAssetIds,
      });

      // Create 10 slide placeholders
      await createSlides(storyId, 10);

      // Update each slide with generated content
      for (const slide of storyContent.slides) {
        await updateSlideByStoryAndNumber(storyId, slide.slideNumber, {
          textContent: slide.textContent,
          caption: slide.caption,
          charactersInSlide: slide.charactersInSlide,
          imagePrompt: slide.imagePrompt,
          status: "pending",
        });
      }

      await updateStory(storyId, { status: "draft" });

      return { storyId, title: storyContent.title };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteStory(input.id);
      return { success: true };
    }),

  duplicate: protectedProcedure
    .input(z.object({ id: z.number(), newTheme: z.string().optional() }))
    .mutation(async ({ input }) => {
      const original = await getStoryById(input.id);
      if (!original) throw new Error("Story not found");

      const newId = await createStory({
        title: `${original.title} (Kopie)`,
        theme: input.newTheme || original.theme,
        status: "draft",
        model: original.model,
        imageProvider: original.imageProvider,
        imageFormat: original.imageFormat,
        consistencyContext: original.consistencyContext,
        usedAssetIds: original.usedAssetIds,
      });

      const originalSlides = await getSlidesByStoryId(input.id);
      if (originalSlides.length > 0) {
        await createSlides(newId, 10);
        for (const slide of originalSlides) {
          await updateSlideByStoryAndNumber(newId, slide.slideNumber, {
            textContent: slide.textContent,
            caption: slide.caption,
            charactersInSlide: slide.charactersInSlide,
            imagePrompt: slide.imagePrompt,
            status: "pending",
          });
        }
      }

      return { storyId: newId };
    }),
});

// ─── Image Generation Router ──────────────────────────────────────────────────

const generateRouter = router({
  generateAllImages: protectedProcedure
    .input(z.object({ storyId: z.number() }))
    .mutation(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      if (!story.consistencyContext) throw new Error("Story has no consistency context");

      const storySlides = await getSlidesByStoryId(input.storyId);
      await updateStory(input.storyId, { status: "generating_images" });

      const ctx = story.consistencyContext as ConsistencyContext;

      // Get all used assets with their image URLs for reference
      const usedAssets = await getAssetsByIds(story.usedAssetIds || []);

       // Build a map: characterName -> presigned absolute URL for Atlas Cloud reference_images
      const characterAssetMap = new Map<string, string>();
      for (const char of (ctx.characters || [])) {
        if (char.assetId && char.assetId > 0) {
          const asset = usedAssets.find((a) => a.id === char.assetId);
          if (asset?.imageUrl) {
            // Convert relative /manus-storage/... to absolute presigned URL
            const presignedUrl = await getPresignedStorageUrl(asset.imageUrl);
            if (presignedUrl) characterAssetMap.set(char.name.toLowerCase(), presignedUrl);
          }
        }
      }
      // Style reference: use assets from 'stil-referenz' category (Mitchells etc.)
      const styleRefAssets = usedAssets.filter(
        (a) => a.category === "stil-referenz"
      );
      const styleReferenceUrls = (
        await Promise.all(styleRefAssets.slice(0, 1).map((a) => getPresignedStorageUrl(a.imageUrl ?? "")))
      ).filter((u): u is string => !!u);

      let errorCount = 0;
      for (const slide of storySlides) {
        if (!slide.imagePrompt) continue;
        try {
          await updateSlide(slide.id, { status: "generating" });

          // Get character reference images for this specific slide
          const slideCharacters = (slide.charactersInSlide as string[] || []);
          const charRefUrls = slideCharacters
            .map((name) => characterAssetMap.get(name.toLowerCase()))
            .filter((url): url is string => !!url)
            .slice(0, 2); // max 2 character refs per slide

          let result: { imageKey: string; imageUrl: string };
          if (story.imageProvider === "freepik") {
            result = await generateSlideImageFreepik(
              slide.imagePrompt, ctx, slide.slideNumber, input.storyId, story.imageFormat
            );
          } else {
            result = await generateSlideImage(
              slide.imagePrompt, ctx, slide.slideNumber, input.storyId, story.imageFormat,
              charRefUrls,
              styleReferenceUrls
            );
          }

          await updateSlide(slide.id, {
            imageKey: result.imageKey,
            imageUrl: result.imageUrl,
            status: "complete",
          });
        } catch (err) {
          errorCount++;
          await updateSlide(slide.id, {
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      const finalStatus = errorCount === 0 ? "complete" : errorCount === storySlides.length ? "error" : "complete";
      await updateStory(input.storyId, { status: finalStatus });

      return { success: true, errorCount };
    }),

  regenerateSlide: protectedProcedure
    .input(z.object({ slideId: z.number() }))
    .mutation(async ({ input }) => {
      const slide = await getSlideById(input.slideId);
      if (!slide) throw new Error("Slide not found");
      if (!slide.imagePrompt) throw new Error("Slide has no image prompt");

      const story = await getStoryById(slide.storyId);
      if (!story || !story.consistencyContext) throw new Error("Story not found");

      const ctx = story.consistencyContext as ConsistencyContext;
      const usedAssets = await getAssetsByIds(story.usedAssetIds || []);

       // Build character reference map with presigned absolute URLs for Atlas Cloud
      const characterAssetMap = new Map<string, string>();
      for (const char of (ctx.characters || [])) {
        if (char.assetId && char.assetId > 0) {
          const asset = usedAssets.find((a) => a.id === char.assetId);
          if (asset?.imageUrl) {
            const presignedUrl = await getPresignedStorageUrl(asset.imageUrl);
            if (presignedUrl) characterAssetMap.set(char.name.toLowerCase(), presignedUrl);
          }
        }
      }
      const slideCharacters = (slide.charactersInSlide as string[] || []);
      const charRefUrls = slideCharacters
        .map((name) => characterAssetMap.get(name.toLowerCase()))
        .filter((url): url is string => !!url)
        .slice(0, 2);

      // Style reference: use assets from 'stil-referenz' category
      const styleRefAssets = usedAssets.filter((a) => a.category === "stil-referenz");
      const styleReferenceUrls = (
        await Promise.all(styleRefAssets.slice(0, 1).map((a) => getPresignedStorageUrl(a.imageUrl ?? "")))
      ).filter((u): u is string => !!u);
      await updateSlide(input.slideId, { status: "generating" });

      let result: { imageKey: string; imageUrl: string };
      if (story.imageProvider === "freepik") {
        result = await generateSlideImageFreepik(
          slide.imagePrompt, ctx, slide.slideNumber, slide.storyId, story.imageFormat
        );
      } else {
        result = await generateSlideImage(
          slide.imagePrompt, ctx, slide.slideNumber, slide.storyId, story.imageFormat,
          charRefUrls, styleReferenceUrls
        );
      }

      await updateSlide(input.slideId, {
        imageKey: result.imageKey,
        imageUrl: result.imageUrl,
        status: "complete",
        errorMessage: null,
      });

      return { imageUrl: result.imageUrl };
    }),

  getSlides: publicProcedure
    .input(z.object({ storyId: z.number() }))
    .query(async ({ input }) => {
      return getSlidesByStoryId(input.storyId);
    }),
});

// ─── Export Router ────────────────────────────────────────────────────────────

const exportRouter = router({
  getExportData: publicProcedure
    .input(z.object({ storyId: z.number() }))
    .query(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      const storySlides = await getSlidesByStoryId(input.storyId);
      const completedSlides = storySlides.filter((s) => s.imageUrl);
      return {
        story,
        slides: completedSlides,
        totalSlides: storySlides.length,
        completedSlides: completedSlides.length,
      };
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  assets: assetRouter,
  stories: storyRouter,
  generate: generateRouter,
  export: exportRouter,
  detect: detectRouter,
});

export type AppRouter = typeof appRouter;
