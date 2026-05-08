import { createHash } from "node:crypto";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  createAsset, getAssets, getAssetById, getAssetsByIds, updateAsset, deleteAsset,
  getAssetByContentHash, bulkApproveHighConfidence,
  createStory, getStories, getStoryById, updateStory, deleteStory,
  createSlides, getSlidesByStoryId, getSlideById, updateSlide, updateSlideByStoryAndNumber,
  getCharacters, getCharacterById, updateCharacter, resolveOrCreateCharacter,
} from "./db";
import { storagePut } from "./storage";
import {
  generateSlideImage, generateSlideImageFreepik,
  getPresignedStorageUrl,
  normalizeConsistencyContext,
} from "./storyService";
import { planStory, writeStorySlides } from "./storyPlanner";
import type { ConsistencyCharacterRef, StoryPlan } from "@shared/types";
import {
  categorizeImage, reviewStatusFromResult,
  type CategorizeResult, type KnownCharacter,
} from "./_core/visionCategorize";
import { prepareImageForVision } from "./_core/imagePrep";
import {
  ASSET_CATEGORIES, CHARACTER_KINDS, REVIEW_STATUSES,
} from "../drizzle/schema";

// ─── Asset Router ─────────────────────────────────────────────────────────────

const assetRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          characterId: z.number().nullable().optional(),
          reviewStatus: z.enum(REVIEW_STATUSES).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return getAssets({
        category: input?.category,
        characterId: input?.characterId,
        reviewStatus: input?.reviewStatus,
      });
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getAssetById(input.id);
    }),

  upload: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.enum(ASSET_CATEGORIES).optional(),
      autoCategorize: z.boolean().default(true),
      description: z.string().optional(),
      visualDescription: z.string().optional(),
      tags: z.array(z.string()).optional(),
      imageData: z.string(),
      mimeType: z.string().default("image/png"),
      fileName: z.string().default("asset.png"),
      /**
       * Optional hint mirroring the bulk-import folder-hint mechanism.
       * Applied as a strong prior for vision categorization but vision still
       * has final say. Useful for "I'm uploading 12 sohn variations".
       */
      hint: z.object({
        folderName: z.string().optional(),
        characterName: z.string().optional(),
        characterKind: z.enum(CHARACTER_KINDS).optional(),
        characterAliases: z.array(z.string()).optional(),
        fallbackCategory: z.enum(ASSET_CATEGORIES).optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.imageData, "base64");
      const contentHash = createHash("sha256").update(buffer).digest("hex");

      const existing = await getAssetByContentHash(contentHash);
      if (existing) {
        return {
          id: existing.id,
          imageKey: existing.imageKey,
          imageUrl: existing.imageUrl,
          deduplicated: true as const,
          vision: null,
        };
      }

      let category = input.category ?? "sonstiges";
      let visionResult: CategorizeResult | null = null;
      let characterId: number | null = null;

      const tmpKey = `assets/${input.category ?? "uploads"}/${Date.now()}-${input.fileName}`;
      const { url, key } = await storagePut(tmpKey, buffer, input.mimeType);

      if (input.autoCategorize) {
        try {
          const knownChars = await getCharacters();
          const known: KnownCharacter[] = knownChars.map((c) => ({
            id: c.id,
            name: c.name,
            aliases: c.aliases ?? [],
            kind: c.kind,
          }));
          const presigned = await getPresignedStorageUrl(url);
          let source;
          // Anthropic vision rejects data: URIs as `url`; only http(s).
          // Use the in-memory buffer for base64 in any non-http case.
          if (presigned && presigned.startsWith("http")) {
            source = { type: "url" as const, url: presigned };
          } else {
            const prepared = await prepareImageForVision(buffer, input.mimeType);
            source = {
              type: "base64" as const,
              mediaType: prepared.mediaType,
              data: prepared.buffer.toString("base64"),
            };
          }
          const categorizeHint = input.hint
            ? {
                folderName: input.hint.folderName,
                fallbackCategory: input.hint.fallbackCategory,
                character:
                  input.hint.characterName && input.hint.characterKind
                    ? {
                        name: input.hint.characterName,
                        kind: input.hint.characterKind,
                        aliases: input.hint.characterAliases,
                      }
                    : undefined,
              }
            : undefined;
          visionResult = await categorizeImage(source, known, categorizeHint);
          if (!input.category) category = visionResult.suggestedCategory;
          characterId = await resolveOrCreateCharacter(visionResult.suggestedCharacter);
        } catch (e) {
          console.error("[assets.upload] vision categorize failed:", e);
        }
      }

      const id = await createAsset({
        name: input.name,
        category,
        description: input.description ?? null,
        visualDescription: input.visualDescription ?? visionResult?.visualDescription ?? null,
        tags: input.tags ?? visionResult?.tags ?? null,
        imageKey: key,
        imageUrl: url,
        characterId,
        isCharacterSheet: visionResult?.isCharacterSheet ?? false,
        pose: visionResult?.pose ?? null,
        outfit: visionResult?.outfit ?? null,
        setting: visionResult?.setting ?? null,
        mood: visionResult?.mood ?? null,
        dominantColors: visionResult?.dominantColors ?? null,
        contentHash,
        autoCategorized: !!visionResult,
        visionConfidence: visionResult?.categoryConfidence ?? null,
        reviewStatus: visionResult ? reviewStatusFromResult(visionResult) : "approved",
      });

      // Set primaryAssetId on character if this is its first sheet
      if (characterId && visionResult?.isCharacterSheet) {
        const ch = await getCharacterById(characterId);
        if (ch && !ch.primaryAssetId) {
          await updateCharacter(characterId, { primaryAssetId: id });
        }
      }

      return {
        id,
        imageKey: key,
        imageUrl: url,
        deduplicated: false as const,
        vision: visionResult,
      };
    }),

  update: publicProcedure
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

  approveCategory: publicProcedure
    .input(z.object({
      id: z.number(),
      category: z.enum(ASSET_CATEGORIES).optional(),
      characterId: z.number().nullable().optional(),
      visualDescription: z.string().optional(),
      isCharacterSheet: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateAsset(id, { ...data, reviewStatus: "approved" });
      return { success: true };
    }),

  bulkApprove: publicProcedure
    .input(z.object({ minConfidence: z.number().min(0).max(100).default(80) }))
    .mutation(async ({ input }) => {
      const approved = await bulkApproveHighConfidence(input.minConfidence);
      return { approved };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteAsset(input.id);
      return { success: true };
    }),

  categories: publicProcedure.query(() => ASSET_CATEGORIES),
});

// ─── Character Router ─────────────────────────────────────────────────────────

const characterRouter = router({
  list: publicProcedure.query(async () => getCharacters()),
  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => getCharacterById(input.id)),
  kinds: publicProcedure.query(() => CHARACTER_KINDS),
  update: publicProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      kind: z.enum(CHARACTER_KINDS).optional(),
      defaultDescription: z.string().optional(),
      defaultStyleNotes: z.string().optional(),
      primaryAssetId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateCharacter(id, data);
      return { success: true };
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

  /** Stage 1 — return a StoryPlan for the UI to confirm. No DB write. */
  plan: publicProcedure
    .input(z.object({
      theme: z.string().min(1),
      model: z.enum(["claude-sonnet-4-6", "claude-opus-4-5"]).default("claude-sonnet-4-6"),
    }))
    .mutation(async ({ input }) => {
      const characterLibrary = await getCharacters();
      const assetCatalog = await getAssets();
      const plan = await planStory({
        theme: input.theme,
        model: input.model,
        characterLibrary: characterLibrary.map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases,
          kind: c.kind,
          defaultDescription: c.defaultDescription,
        })),
        assetCatalog,
      });

      // Enrich detectedEntities with full character info for the UI
      const enrichedEntities = await Promise.all(
        plan.detectedEntities.map(async (e) => {
          if (!e.matchedCharacterId) return { ...e, character: null };
          const ch = await getCharacterById(e.matchedCharacterId);
          return { ...e, character: ch ?? null };
        }),
      );

      return { ...plan, detectedEntities: enrichedEntities };
    }),

  /** Stage 3 — write slides + persist story using the user-confirmed plan. */
  generate: publicProcedure
    .input(z.object({
      theme: z.string().min(1),
      plan: z.object({
        title: z.string(),
        suggestedSlideCount: z.number().int().min(3).max(10),
        reasoning: z.string(),
        scenes: z.array(z.object({
          id: z.string(),
          slideRange: z.tuple([z.number().int(), z.number().int()]),
          environment: z.string(),
          environmentLockNotes: z.string(),
          transitionToNext: z.string().nullish(),
          environmentRefAssetId: z.number().nullish(),
        })),
        detectedEntities: z.array(z.object({
          name: z.string(),
          type: z.enum(["character", "object", "place"]),
          matchedCharacterId: z.number().nullish(),
          matchedAssetIds: z.array(z.number()).default([]),
          needsWorldBuilding: z.boolean(),
          draftVisualDescription: z.string().nullish(),
        })),
      }),
      selectedAssetIdsByEntity: z.record(z.string(), z.number().nullable()).optional(),
      model: z.enum(["claude-sonnet-4-6", "claude-opus-4-5"]).default("claude-sonnet-4-6"),
      imageFormat: z.enum(["1:1", "4:5"]).default("1:1"),
      imageProvider: z.enum(["gpt-image-2", "freepik"]).default("gpt-image-2"),
    }))
    .mutation(async ({ input }) => {
      // Coerce zod-allowed null → undefined for downstream Scene/DetectedEntity shapes.
      const plan: StoryPlan = {
        title: input.plan.title,
        suggestedSlideCount: input.plan.suggestedSlideCount,
        reasoning: input.plan.reasoning,
        scenes: input.plan.scenes.map((s) => ({
          id: s.id,
          slideRange: s.slideRange,
          environment: s.environment,
          environmentLockNotes: s.environmentLockNotes,
          transitionToNext: s.transitionToNext ?? undefined,
          environmentRefAssetId: s.environmentRefAssetId ?? undefined,
        })),
        detectedEntities: input.plan.detectedEntities.map((e) => ({
          name: e.name,
          type: e.type,
          matchedCharacterId: e.matchedCharacterId ?? undefined,
          matchedAssetIds: e.matchedAssetIds,
          needsWorldBuilding: e.needsWorldBuilding,
          draftVisualDescription: e.draftVisualDescription ?? undefined,
        })),
      };

      // Resolve characters: user override → matched character → skip
      const resolvedCharacters: ConsistencyCharacterRef[] = [];
      const usedAssetIds: number[] = [];
      const overrides = input.selectedAssetIdsByEntity ?? {};

      for (const entity of plan.detectedEntities) {
        if (entity.type !== "character") continue;
        const overrideAssetId = overrides[entity.name];
        let assetId: number | null = null;
        let characterId = 0;
        let visualDescription = entity.draftVisualDescription ?? "";
        let name = entity.name;

        if (overrideAssetId !== undefined && overrideAssetId !== null) {
          assetId = overrideAssetId;
          const a = await getAssetById(overrideAssetId);
          if (a?.characterId) characterId = a.characterId;
          if (a?.visualDescription) visualDescription = a.visualDescription;
          if (a?.name) name = a.name;
        } else if (entity.matchedCharacterId) {
          const ch = await getCharacterById(entity.matchedCharacterId);
          if (ch) {
            characterId = ch.id;
            name = ch.name;
            if (ch.defaultDescription) visualDescription = ch.defaultDescription;
            if (ch.primaryAssetId) {
              assetId = ch.primaryAssetId;
              const a = await getAssetById(ch.primaryAssetId);
              if (a?.visualDescription && !visualDescription) visualDescription = a.visualDescription;
            }
          }
        }

        // Persist the relative /manus-storage/... path only — never the resolved
        // data URI. Resolving happens fresh at image-gen time. Persisting a
        // multi-MB data URI bloats the stories JSON column past max_allowed_packet.
        let referenceImageUrl: string | undefined;
        if (assetId) {
          const a = await getAssetById(assetId);
          if (a?.imageUrl) {
            referenceImageUrl = a.imageUrl;
          }
          usedAssetIds.push(assetId);
        }

        resolvedCharacters.push({
          characterId,
          assetId: assetId ?? 0,
          name,
          outfit: "",
          visualDescription,
          referenceImageUrl,
          worldBuilt: false,
        });
      }

      // Style references — persist relative paths only (avoids data: URIs
      // bloating consistencyContext past max_allowed_packet). generateAllImages
      // re-resolves to data URIs / presigned URLs at render time.
      const allAssets = await getAssets();
      const styleAssets = allAssets.filter((a) => a.category === "stil-referenz");
      const styleReferenceUrls = styleAssets.map((a) => a.imageUrl).filter((u): u is string => !!u);
      for (const a of styleAssets) usedAssetIds.push(a.id);

      const { consistencyContext, slides } = await writeStorySlides({
        theme: input.theme,
        plan,
        resolvedCharacters,
        styleReferenceUrls,
        model: input.model,
        imageFormat: input.imageFormat,
      });

      const storyId = await createStory({
        title: plan.title,
        theme: input.theme,
        status: "draft",
        model: input.model,
        imageProvider: input.imageProvider,
        imageFormat: input.imageFormat,
        consistencyContext,
        usedAssetIds: Array.from(new Set(usedAssetIds)),
      });

      await createSlides(storyId, plan.suggestedSlideCount);

      for (const slide of slides) {
        await updateSlideByStoryAndNumber(storyId, slide.slideNumber, {
          textContent: slide.textContent,
          caption: slide.caption,
          charactersInSlide: slide.charactersInSlide,
          imagePrompt: slide.imagePrompt,
          status: "pending",
        });
      }

      await updateStory(storyId, { status: "draft" });
      return { storyId, title: plan.title };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteStory(input.id);
      return { success: true };
    }),

  duplicate: publicProcedure
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
  generateAllImages: publicProcedure
    .input(z.object({ storyId: z.number() }))
    .mutation(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      if (!story.consistencyContext) throw new Error("Story has no consistency context");

      const storySlides = await getSlidesByStoryId(input.storyId);
      await updateStory(input.storyId, { status: "generating_images" });

      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");

      // Get all used assets with their image URLs for reference
      const usedAssets = await getAssetsByIds(story.usedAssetIds || []);

       // Build a map: characterName -> presigned absolute URL for Atlas Cloud reference_images
      const characterAssetMap = new Map<string, string>();
      let presignAttempts = 0;
      for (const char of (ctx.characters || [])) {
        if (char.assetId && char.assetId > 0) {
          const asset = usedAssets.find((a) => a.id === char.assetId);
          if (asset?.imageUrl) {
            presignAttempts++;
            // Convert relative /manus-storage/... to absolute presigned URL
            const presignedUrl = await getPresignedStorageUrl(asset.imageUrl);
            if (presignedUrl) characterAssetMap.set(char.name.toLowerCase(), presignedUrl);
          }
        }
      }
      if (presignAttempts > 0 && characterAssetMap.size === 0) {
        console.warn(
          `[generate] ${presignAttempts} character ref(s) skipped — no public URL available (STORAGE_BACKEND=local has no presign). Falling back to text-only character descriptions in prompt.`,
        );
      }
      // Style references: all stil-referenz assets in this story (incl. typo/font sheets).
      // Smart-fill below picks the right mix per slide.
      const styleRefAssets = usedAssets.filter((a) => a.category === "stil-referenz");
      const styleReferenceUrls = (
        await Promise.all(styleRefAssets.map((a) => getPresignedStorageUrl(a.imageUrl ?? "")))
      ).filter((u): u is string => !!u);

      let errorCount = 0;
      for (const slide of storySlides) {
        if (!slide.imagePrompt) continue;
        try {
          await updateSlide(slide.id, { status: "generating" });

          // Get character reference images for this specific slide.
          // Atlas hard-caps at 4 refs total. Pick characters first (more impactful
          // for consistency), up to 3, then fill remaining slots with style refs.
          const slideCharacters = (slide.charactersInSlide as string[] || []);
          const charRefUrls = slideCharacters
            .map((name) => characterAssetMap.get(name.toLowerCase()))
            .filter((url): url is string => !!url)
            .slice(0, 3);

          let result: { imageKey: string; imageUrl: string };
          if (story.imageProvider === "freepik") {
            result = await generateSlideImageFreepik(
              slide.imagePrompt, ctx, slide.slideNumber, input.storyId, story.imageFormat
            );
          } else {
            result = await generateSlideImage(
              slide.imagePrompt, ctx, slide.slideNumber, input.storyId, story.imageFormat,
              charRefUrls,
              styleReferenceUrls,
              slideCharacters,
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

  regenerateSlide: publicProcedure
    .input(z.object({ slideId: z.number() }))
    .mutation(async ({ input }) => {
      const slide = await getSlideById(input.slideId);
      if (!slide) throw new Error("Slide not found");
      if (!slide.imagePrompt) throw new Error("Slide has no image prompt");

      const story = await getStoryById(slide.storyId);
      if (!story || !story.consistencyContext) throw new Error("Story not found");

      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");
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
      // Match generateAllImages: up to 3 char refs, smart-fill rest with styles in
      // generateSlideImage. Atlas hard-cap is 4 total.
      const charRefUrls = slideCharacters
        .map((name) => characterAssetMap.get(name.toLowerCase()))
        .filter((url): url is string => !!url)
        .slice(0, 3);

      // All stil-referenz assets — generateSlideImage decides how many to actually pass
      const styleRefAssets = usedAssets.filter((a) => a.category === "stil-referenz");
      const styleReferenceUrls = (
        await Promise.all(styleRefAssets.map((a) => getPresignedStorageUrl(a.imageUrl ?? "")))
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
          charRefUrls, styleReferenceUrls, slideCharacters,
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

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  assets: assetRouter,
  characters: characterRouter,
  stories: storyRouter,
  generate: generateRouter,
});

export type AppRouter = typeof appRouter;
