import { createHash } from "node:crypto";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  createAsset, getAssets, getAssetById, getAssetsByIds, updateAsset, deleteAsset,
  bulkDeleteAssets,
  getAssetByContentHash, bulkApproveHighConfidence,
  createStory, getStories, getStoryById, updateStory, deleteStory,
  createSlides, getSlidesByStoryId, getSlideById, updateSlide, updateSlideByStoryAndNumber,
  deleteSlide, markSlidesNeedingRegen,
  getCharacters, getCharacterById, getCharactersByIds, updateCharacter, resolveOrCreateCharacter,
  getProjects, getProjectById, createProject, updateProject,
} from "./db";
import { storagePut } from "./storage";
import {
  generateSlideImage, generateSlideImageFreepik,
  getPresignedStorageUrl,
  normalizeConsistencyContext,
  findSceneForSlide,
  deriveSceneSlideRanges,
} from "./storyService";
import { planStory, rewriteSlideImagePrompt, writeStorySlides } from "./storyPlanner";
import type { ConsistencyCharacterRef, ConsistencyContext, Scene, StoryPlan } from "@shared/types";
import type { Slide, Story } from "../drizzle/schema";
import {
  categorizeImage, extractVariantsFromSheet, reviewStatusFromResult,
  type CategorizeResult, type KnownCharacter,
} from "./_core/visionCategorize";
import { prepareImageForVision, prepareImageForStorage } from "./_core/imagePrep";
import sharp from "sharp";
import type { AssetVariant } from "@shared/types";
import {
  ASSET_CATEGORIES, CHARACTER_KINDS, REVIEW_STATUSES,
} from "../drizzle/schema";
import { embedAsset, backfillEmbeddings } from "./embeddingService";

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
      const rawBuffer = Buffer.from(input.imageData, "base64");
      // Convert big PNG/WEBP/GIF uploads to JPEG before storage so downstream
      // vision/embed pipelines don't blow Anthropic's 5MB limit. Hash AFTER
      // conversion so dedup matches the bytes we actually store.
      const stored = await prepareImageForStorage(rawBuffer, input.mimeType, input.fileName);
      const buffer = stored.buffer;
      const mimeType = stored.mediaType;
      const fileName = stored.fileName;
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

      const tmpKey = `assets/${input.category ?? "uploads"}/${Date.now()}-${fileName}`;
      const { url, key } = await storagePut(tmpKey, buffer, mimeType);

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
            const prepared = await prepareImageForVision(buffer, mimeType);
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

      // Variant extraction: only meaningful for character sheets and
      // environment sheets. Best-effort — never blocks the upload.
      let variants: AssetVariant[] | null = null;
      const shouldExtractVariants =
        !!visionResult &&
        (visionResult.isCharacterSheet === true || category === "umgebungen");
      if (shouldExtractVariants && visionResult) {
        try {
          const meta = await sharp(buffer).metadata();
          const imageWidth = meta.width ?? 0;
          const imageHeight = meta.height ?? 0;
          if (imageWidth > 0 && imageHeight > 0) {
            const presigned = await getPresignedStorageUrl(url);
            const variantSource =
              presigned && presigned.startsWith("http")
                ? { type: "url" as const, url: presigned }
                : ({
                    type: "base64" as const,
                    mediaType: mimeType,
                    data: buffer.toString("base64"),
                  } as const);
            const extracted = await extractVariantsFromSheet(variantSource, {
              isCharacterSheet: visionResult.isCharacterSheet,
              assetCategory: category,
              visualDescription: visionResult.visualDescription,
              imageWidth,
              imageHeight,
            });
            variants = extracted.length > 0 ? extracted : null;
          }
        } catch (e) {
          console.warn("[assets.upload] variant extraction failed:", e);
          variants = null;
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
        variants,
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

      // Auto-embed: generate Voyage AI multimodal embedding in the background.
      // Fire-and-forget — never blocks the upload response.
      if (process.env.VOYAGE_API_KEY) {
        embedAsset(id).catch((e) =>
          console.warn(`[assets.upload] embedding failed for asset ${id}:`, e)
        );
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
      pose: z.string().optional(),
      outfit: z.string().optional(),
      mood: z.string().optional(),
      dominantColors: z.array(z.string()).optional(),
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

  bulkDelete: publicProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }))
    .mutation(async ({ input }) => {
      const deleted = await bulkDeleteAssets(input.ids);
      return { success: true, deleted };
    }),

  categories: publicProcedure.query(() => ASSET_CATEGORIES),

  /**
   * Backfill Voyage AI multimodal embeddings for all assets that don't have one.
   * Safe to call multiple times (idempotent). Processes in batches of 5.
   * Returns stats: { total, embedded, skipped, errors }
   */
  backfillEmbeddings: publicProcedure
    .mutation(async () => {
      if (!process.env.VOYAGE_API_KEY) {
        throw new Error("VOYAGE_API_KEY is not set — cannot generate embeddings");
      }
      return backfillEmbeddings(5, 1000);
    }),

  /**
   * Re-embed a single asset (force=true overwrites existing embedding).
   */
  embedAsset: publicProcedure
    .input(z.object({ id: z.number().int().positive(), force: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      if (!process.env.VOYAGE_API_KEY) {
        throw new Error("VOYAGE_API_KEY is not set — cannot generate embeddings");
      }
      return embedAsset(input.id, { force: input.force });
    }),
});
// ─── Character Router ──────────────────────────────────────────────────────────

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

// ─── Slides Router ────────────────────────────────────────────────────────────

const slidesRouter = router({
  /**
   * Edit slide text fields. Does NOT trigger image regeneration.
   * If `imagePrompt` is changed, flips `needsRegen=true` so the UI surfaces
   * the regenerate-to-apply hint (textContent/caption-only edits don't, since
   * those don't affect image rendering).
   */
  updateContent: publicProcedure
    .input(z.object({
      slideId: z.number(),
      textContent: z.string().optional(),
      imagePrompt: z.string().optional(),
      caption: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { slideId, ...rest } = input;
      const data: Partial<{
        textContent: string;
        imagePrompt: string;
        caption: string;
        needsRegen: boolean;
      }> = {};
      if (rest.textContent !== undefined) data.textContent = rest.textContent;
      if (rest.caption !== undefined) data.caption = rest.caption;
      if (rest.imagePrompt !== undefined) {
        data.imagePrompt = rest.imagePrompt;
        data.needsRegen = true;
      }
      await updateSlide(slideId, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ slideId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSlide(input.slideId);
      return { success: true };
    }),

  /**
   * Reassign a slide to a different scene. Updates `slides.sceneId` only —
   * does NOT regenerate the image or rewrite the prompt. Client shows a
   * "Regenerate to apply" hint locally; user hits regenerate when ready.
   * See design doc §3a / §5 (no auto-regen).
   */
  assignScene: publicProcedure
    .input(z.object({
      slideId: z.number().int().positive(),
      sceneId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const slide = await getSlideById(input.slideId);
      if (!slide) throw new Error("Slide not found");

      const story = await getStoryById(slide.storyId);
      if (!story) throw new Error("Story not found");

      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");

      const exists = ctx.scenes.some((s) => s.id === input.sceneId);
      if (!exists) throw new Error(`Scene "${input.sceneId}" not found in this story`);

      // Flip needsRegen so the slide shows the "regenerate to apply" strip —
      // its imagePrompt was written against the *old* scene's environment.
      await updateSlide(input.slideId, { sceneId: input.sceneId, needsRegen: true });
      return { success: true };
    }),

  /** Reorder slides: array position (1-indexed) becomes the new slideNumber. */
  reorder: publicProcedure
    .input(z.object({ storyId: z.number(), slideIds: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      // Two-pass to avoid uniqueness collisions if a future migration adds a
      // (storyId, slideNumber) unique index — first move everything into a
      // disjoint range, then settle into the final order.
      const offset = 1000;
      for (let i = 0; i < input.slideIds.length; i++) {
        await updateSlide(input.slideIds[i], { slideNumber: offset + i + 1 });
      }
      for (let i = 0; i < input.slideIds.length; i++) {
        await updateSlide(input.slideIds[i], { slideNumber: i + 1 });
      }
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
      // Read-time derive: per-slide `sceneId` is the source of truth for
      // scene membership; recompute `Scene.slideRange` from the slides so
      // post-reassign / post-reorder data stays sane. Stored JSON may have
      // stale ranges — we never write back here. See design doc §6.
      const ctx = normalizeConsistencyContext(story.consistencyContext);
      const consistencyContext = ctx
        ? { ...ctx, scenes: deriveSceneSlideRanges(ctx.scenes, storySlides) }
        : story.consistencyContext;
      return { ...story, consistencyContext, slides: storySlides };
    }),

  /** Stage 1 — return a StoryPlan for the UI to confirm. No DB write. */
  plan: publicProcedure
    .input(z.object({
      theme: z.string().min(1),
      projectId: z.number().int().optional(),
      model: z.enum(["claude-sonnet-4-6", "claude-opus-4-5"]).default("claude-sonnet-4-6"),
      customSystemPrompt: z.string().optional(),
      customUserPromptPrefix: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const characterLibrary = await getCharacters();
      const assetCatalog = await getAssets();
      // Load project (falls back to first project if none specified)
      const project = input.projectId
        ? await getProjectById(input.projectId)
        : (await getProjects())[0];
      if (!project) throw new Error("No project found. Create a project first.");
      const plan = await planStory({
        theme: input.theme,
        model: input.model,
        project,
        characterLibrary: characterLibrary.map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases,
          kind: c.kind,
          defaultDescription: c.defaultDescription,
        })),
        assetCatalog,
        customSystemPrompt: input.customSystemPrompt,
        customUserPromptPrefix: input.customUserPromptPrefix,
      });

      // Enrich detectedEntities with full character info for the UI
      const idsToFetch = plan.detectedEntities
        .map((e) => e.matchedCharacterId)
        .filter((id): id is number => typeof id === "number");
      const fetched = idsToFetch.length > 0 ? await getCharactersByIds(idsToFetch) : [];
      const charById = new Map(fetched.map((c) => [c.id, c]));
      const enrichedEntities = plan.detectedEntities.map((e) => ({
        ...e,
        character: e.matchedCharacterId ? (charById.get(e.matchedCharacterId) ?? null) : null,
      }));

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
      projectId: z.number().int().optional(),
      selectedAssetIdsByEntity: z.record(z.string(), z.number().nullable()).optional(),
      excludedStyleRefAssetIds: z.array(z.number().int().positive()).optional(),
      model: z.enum(["claude-sonnet-4-6", "claude-opus-4-5"]).default("claude-sonnet-4-6"),
      imageFormat: z.enum(["1:1", "4:5"]).default("1:1"),
      imageProvider: z.enum(["gpt-image-2", "freepik"]).default("gpt-image-2"),
      customSystemPrompt: z.string().optional(),
      customUserPromptPrefix: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Load project (falls back to first project if none specified)
      const project = input.projectId
        ? await getProjectById(input.projectId)
        : (await getProjects())[0];
      if (!project) throw new Error("No project found. Create a project first.");

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
      // User-excluded style refs (per ConsistencyContextV2.excludedStyleRefAssetIds)
      // are filtered out here so they never enter the prompt context.
      const excludedStyleRefAssetIds = input.excludedStyleRefAssetIds ?? [];
      const excludedSet = new Set(excludedStyleRefAssetIds);
      const allAssets = await getAssets();
      const styleAssets = allAssets
        .filter((a) => a.category === "stil-referenz")
        .filter((a) => !excludedSet.has(a.id));
      const styleReferenceUrls = styleAssets.map((a) => a.imageUrl).filter((u): u is string => !!u);
      for (const a of styleAssets) usedAssetIds.push(a.id);

      // imageFormat: prefer explicit input override, else use project default
      const imageFormat = (input.imageFormat ?? project.imageFormat) as "1:1" | "4:5";

      const { consistencyContext, slides } = await writeStorySlides({
        theme: input.theme,
        plan,
        resolvedCharacters,
        styleReferenceUrls,
        model: input.model,
        project,
        customSystemPrompt: input.customSystemPrompt,
        customUserPromptPrefix: input.customUserPromptPrefix,
      });

      // Persist exclusion list on consistencyContext so generateAllImages /
      // regenerateSlide can re-apply it on every regeneration.
      if (excludedStyleRefAssetIds.length > 0) {
        consistencyContext.excludedStyleRefAssetIds = excludedStyleRefAssetIds;
      }

      const storyId = await createStory({
        title: plan.title,
        theme: input.theme,
        status: "draft",
        model: input.model,
        imageProvider: input.imageProvider,
        imageFormat,
        projectId: project.id,
        consistencyContext,
        usedAssetIds: Array.from(new Set(usedAssetIds)),
      });

      await createSlides(storyId, plan.suggestedSlideCount);

      for (const slide of slides) {
        // Compute sceneId at write time from the planner's slideRange so each
        // slide row gets a stable per-slide scene FK. See design doc §3c.
        const sceneId =
          slide.sceneId ?? findSceneForSlide(consistencyContext, slide.slideNumber)?.id ?? null;
        await updateSlideByStoryAndNumber(storyId, slide.slideNumber, {
          textContent: slide.textContent,
          caption: slide.caption,
          charactersInSlide: slide.charactersInSlide,
          imagePrompt: slide.imagePrompt,
          sceneId,
          status: "pending",
        });
      }

      await updateStory(storyId, { status: "draft" });
      return { storyId, title: plan.title };
    }),

  /**
   * Patch a story's consistencyContext. Reads, shallow-merges with patch,
   * writes back. Unspecified fields stay untouched.
   */
  updateConsistencyContext: publicProcedure
    .input(z.object({
      storyId: z.number(),
      patch: z.object({
        colorPalette: z.string().optional(),
        globalStylePrompt: z.string().optional(),
        artStyle: z.string().optional(),
        characters: z.array(z.object({
          characterId: z.number(),
          assetId: z.number(),
          name: z.string(),
          outfit: z.string(),
          visualDescription: z.string(),
          referenceImageUrl: z.string().optional(),
          worldBuilt: z.boolean().optional(),
        })).optional(),
        scenes: z.array(z.object({
          id: z.string(),
          slideRange: z.tuple([z.number().int(), z.number().int()]),
          environment: z.string(),
          environmentLockNotes: z.string(),
          transitionToNext: z.string().optional(),
          environmentRefAssetId: z.number().optional(),
        })).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      const existing = (story.consistencyContext as ConsistencyContext | null) ?? null;
      if (!existing) throw new Error("Story has no consistency context");

      const merged: ConsistencyContext = {
        ...existing,
        ...(input.patch.artStyle !== undefined ? { artStyle: input.patch.artStyle } : {}),
        ...(input.patch.colorPalette !== undefined ? { colorPalette: input.patch.colorPalette } : {}),
        ...(input.patch.globalStylePrompt !== undefined ? { globalStylePrompt: input.patch.globalStylePrompt } : {}),
        ...(input.patch.characters !== undefined
          ? { characters: input.patch.characters as ConsistencyCharacterRef[] }
          : {}),
        ...(input.patch.scenes !== undefined
          ? { scenes: input.patch.scenes as Scene[] }
          : {}),
      };
      await updateStory(input.storyId, { consistencyContext: merged });
      return { success: true };
    }),

  /**
   * Patch a single scene inside `consistencyContext.scenes`. Only fields
   * present in `patch` are touched. After persisting, every slide in this
   * scene is flagged `needsRegen=true` so the UI nudges the user to
   * regenerate (the imagePrompt was written against the pre-edit env/lock).
   * See design doc §3b.
   */
  updateScene: publicProcedure
    .input(z.object({
      storyId: z.number().int().positive(),
      sceneId: z.string().min(1),
      patch: z.object({
        environment: z.string().optional(),
        environmentLockNotes: z.string().optional(),
        transitionToNext: z.string().nullish(),
        environmentRefAssetId: z.number().int().nullish(),
      }),
    }))
    .mutation(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");

      const idx = ctx.scenes.findIndex((s) => s.id === input.sceneId);
      if (idx === -1) throw new Error(`Scene "${input.sceneId}" not found`);

      const cur = ctx.scenes[idx];
      const merged: Scene = {
        ...cur,
        ...(input.patch.environment !== undefined ? { environment: input.patch.environment } : {}),
        ...(input.patch.environmentLockNotes !== undefined
          ? { environmentLockNotes: input.patch.environmentLockNotes }
          : {}),
        ...(input.patch.transitionToNext !== undefined
          ? { transitionToNext: input.patch.transitionToNext ?? undefined }
          : {}),
        ...(input.patch.environmentRefAssetId !== undefined
          ? { environmentRefAssetId: input.patch.environmentRefAssetId ?? undefined }
          : {}),
      };
      const nextScenes = ctx.scenes.slice();
      nextScenes[idx] = merged;
      await updateStory(input.storyId, {
        consistencyContext: { ...ctx, scenes: nextScenes },
      });

      const flagged = await markSlidesNeedingRegen(input.storyId, input.sceneId);
      return { success: true, flagged };
    }),

  /**
   * Reorder `consistencyContext.scenes` per the provided sceneId order.
   * Input must contain exactly the same set of sceneIds as currently exist
   * (no missing, no extras). Does NOT touch `slideRange` — see design doc §6
   * (slideRange may go stale; auto-recompute is a separate follow-up).
   */
  reorderScenes: publicProcedure
    .input(z.object({
      storyId: z.number().int().positive(),
      sceneIds: z.array(z.string().min(1)).min(1),
    }))
    .mutation(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");

      const existingIds = ctx.scenes.map((s) => s.id);
      const inputIds = input.sceneIds;
      if (inputIds.length !== existingIds.length) {
        throw new Error(
          `reorderScenes expects ${existingIds.length} sceneIds, got ${inputIds.length}`,
        );
      }
      const existingSet = new Set(existingIds);
      const inputSet = new Set(inputIds);
      if (inputSet.size !== inputIds.length) {
        throw new Error("reorderScenes: duplicate sceneIds in input");
      }
      for (const id of inputIds) {
        if (!existingSet.has(id)) {
          throw new Error(`reorderScenes: unknown sceneId "${id}"`);
        }
      }

      const byId = new Map(ctx.scenes.map((s) => [s.id, s]));
      const nextScenes = inputIds.map((id) => byId.get(id)!);
      await updateStory(input.storyId, {
        consistencyContext: { ...ctx, scenes: nextScenes },
      });
      return { success: true };
    }),

  /**
   * Remove an empty scene from `consistencyContext.scenes`. Refuses to delete
   * if any slide still references this sceneId (caller should reassign first).
   * Does NOT renumber surviving scenes. See design doc §6.
   */
  removeScene: publicProcedure
    .input(z.object({
      storyId: z.number().int().positive(),
      sceneId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const story = await getStoryById(input.storyId);
      if (!story) throw new Error("Story not found");
      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");

      const idx = ctx.scenes.findIndex((s) => s.id === input.sceneId);
      if (idx === -1) throw new Error(`Scene "${input.sceneId}" not found`);

      const storySlides = await getSlidesByStoryId(input.storyId);
      const stillReferenced = storySlides.some((s) => s.sceneId === input.sceneId);
      if (stillReferenced) {
        throw new Error("Scene has slides assigned — reassign them before deleting");
      }

      const nextScenes = ctx.scenes.filter((s) => s.id !== input.sceneId);
      await updateStory(input.storyId, {
        consistencyContext: { ...ctx, scenes: nextScenes },
      });
      return { success: true };
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

      // Inline mode (INNGEST_DEV=true): run generation synchronously in-process.
      // Async mode (default): dispatch to Inngest job queue for resilient,
      // retryable, observable background processing.
      if (process.env.INNGEST_DEV === "true") {
        const { generateStoryImagesInline } = await import("./jobQueue");
        await generateStoryImagesInline(input.storyId);
        return { success: true, queued: false };
      }

      // Async: send event to Inngest → fan-out per slide
      const { inngest: inngestClient } = await import("./jobQueue");
      await inngestClient.send({
        name: "imagen/story.generate",
        data: { storyId: input.storyId },
      });
      await updateStory(input.storyId, { status: "generating_images" });
      return { success: true, queued: true };
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

      await updateSlide(input.slideId, { status: "generating" });
      const result = await regenerateSlideImage(slide, story, ctx, slide.imagePrompt);
      await updateSlide(input.slideId, {
        imageKey: result.imageKey,
        imageUrl: result.imageUrl,
        status: "complete",
        errorMessage: null,
        // Slide is now in sync with its prompt + scene context.
        needsRegen: false,
      });

      return { imageUrl: result.imageUrl };
    }),

  /**
   * Two-step regenerate: first ask Claude to rewrite the slide's imagePrompt
   * against the *current* scene + character context, persist it, then run
   * the normal image generation. Use this after a scene reassign or scene-env
   * edit when the existing imagePrompt no longer reflects reality.
   * See design doc §5 future "Phase 3 #12".
   */
  regenerateWithFreshPrompt: publicProcedure
    .input(z.object({ slideId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const slide = await getSlideById(input.slideId);
      if (!slide) throw new Error("Slide not found");

      const story = await getStoryById(slide.storyId);
      if (!story || !story.consistencyContext) throw new Error("Story not found");

      const ctx = normalizeConsistencyContext(story.consistencyContext);
      if (!ctx) throw new Error("Story has invalid consistency context");

      const scene = slide.sceneId
        ? ctx.scenes.find((s) => s.id === slide.sceneId) ?? null
        : null;

      const newImagePrompt = await rewriteSlideImagePrompt({
        slide: {
          slideNumber: slide.slideNumber,
          textContent: slide.textContent ?? "",
          caption: slide.caption ?? "",
          charactersInSlide: (slide.charactersInSlide as string[]) ?? [],
          sceneId: slide.sceneId ?? null,
        },
        scene,
        characters: ctx.characters ?? [],
        storyTheme: story.theme ?? "",
        imageFormat: story.imageFormat as import("../drizzle/schema").ImageFormat,
        model: story.model,
      });
      await updateSlide(input.slideId, { imagePrompt: newImagePrompt, status: "generating" });;

      // Re-fetch slide to use the freshly-saved prompt + propagate to image gen.
      const refreshed = await getSlideById(input.slideId);
      if (!refreshed) throw new Error("Slide vanished after prompt write");

      const result = await regenerateSlideImage(refreshed, story, ctx, newImagePrompt);
      await updateSlide(input.slideId, {
        imageKey: result.imageKey,
        imageUrl: result.imageUrl,
        status: "complete",
        errorMessage: null,
        needsRegen: false,
      });

      return { success: true, newImagePrompt, imageUrl: result.imageUrl };
    }),

  getSlides: publicProcedure
    .input(z.object({ storyId: z.number() }))
    .query(async ({ input }) => {
      return getSlidesByStoryId(input.storyId);
    }),
});

// ─── Single-slide image regen helper ──────────────────────────────────────────

/**
 * Resolve character + style refs and call the configured image provider for
 * one slide. Shared by `regenerateSlide` and `regenerateWithFreshPrompt` —
 * both diverge only in how `imagePrompt` is sourced. Caller is responsible
 * for setting `status: "generating"` before and persisting the result after.
 */
async function regenerateSlideImage(
  slide: Slide,
  story: Story,
  ctx: ConsistencyContext,
  imagePrompt: string,
): Promise<{ imageKey: string; imageUrl: string }> {
  if (!imagePrompt) throw new Error("Slide has no image prompt");
  const usedAssets = await getAssetsByIds(story.usedAssetIds || []);

  // Build character reference map with presigned absolute URLs for Atlas
  // Cloud. Full sheets always — variant selection is baked into `imagePrompt`
  // by the composer step at story-generation time.
  const characterRefs = (ctx.characters || [])
    .filter((char) => char.assetId && char.assetId > 0)
    .map((char) => {
      const asset = usedAssets.find((a) => a.id === char.assetId);
      return { name: char.name, asset };
    })
    .filter((r) => r.asset?.imageUrl);
  const presigned = await Promise.all(
    characterRefs.map((r) => getPresignedStorageUrl(r.asset!.imageUrl ?? "")),
  );
  const characterAssetMap = new Map<string, string>();
  characterRefs.forEach((r, i) => {
    if (presigned[i]) characterAssetMap.set(r.name.toLowerCase(), presigned[i]!);
  });
  const slideCharacters = (slide.charactersInSlide as string[]) || [];
  // Match generateAllImages: up to 3 char refs, smart-fill rest with styles
  // in generateSlideImage. Atlas hard-cap is 4 total.
  const charRefUrls = slideCharacters
    .map((name) => characterAssetMap.get(name.toLowerCase()))
    .filter((url): url is string => !!url)
    .slice(0, 3);

  // All stil-referenz assets minus user-excluded ones — generateSlideImage
  // decides how many to actually pass.
  const excludedStyleIds = new Set(ctx.excludedStyleRefAssetIds ?? []);
  const styleRefAssets = usedAssets
    .filter((a) => a.category === "stil-referenz")
    .filter((a) => !excludedStyleIds.has(a.id));
  const styleReferenceUrls = (
    await Promise.all(styleRefAssets.map((a) => getPresignedStorageUrl(a.imageUrl ?? "")))
  ).filter((u): u is string => !!u);

  if (story.imageProvider === "freepik") {
    return generateSlideImageFreepik(
      imagePrompt, ctx, slide.slideNumber, slide.storyId, story.imageFormat as import("../drizzle/schema").ImageFormat,
    );
  }
  return generateSlideImage(
    imagePrompt, ctx, slide.slideNumber, slide.storyId, story.imageFormat as import("../drizzle/schema").ImageFormat,
    charRefUrls, styleReferenceUrls, slideCharacters,
  );
}

// ─── App Router ───────────────────────────────────────────────────────────────

// ─── Projects Router ─────────────────────────────────────────────────────────
const projectsRouter = router({
  list: publicProcedure.query(async () => {
    return getProjects();
  }),
  get: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      return getProjectById(input.id);
    }),
  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      imageFormat: z.enum(["1:1", "4:5", "16:9", "9:16"]).default("1:1"),
      planSystemPrompt: z.string().min(1),
      writeSystemPrompt: z.string().min(1),
      globalStylePrompt: z.string().min(1),
      allowedAssetCategories: z.array(z.string()).optional(),
      minFrames: z.number().int().min(1).default(1),
      maxFrames: z.number().int().max(50).default(10),
    }))
    .mutation(async ({ input }) => {
      const id = await createProject({
        name: input.name,
        description: input.description ?? null,
        imageFormat: input.imageFormat,
        planSystemPrompt: input.planSystemPrompt,
        writeSystemPrompt: input.writeSystemPrompt,
        globalStylePrompt: input.globalStylePrompt,
        allowedAssetCategories: (input.allowedAssetCategories as import("../drizzle/schema").AssetCategory[] | undefined) ?? null,
        minFrames: input.minFrames,
        maxFrames: input.maxFrames,
      });
      return { id };
    }),
  update: publicProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      imageFormat: z.enum(["1:1", "4:5", "16:9", "9:16"]).optional(),
      planSystemPrompt: z.string().min(1).optional(),
      writeSystemPrompt: z.string().min(1).optional(),
      globalStylePrompt: z.string().min(1).optional(),
      allowedAssetCategories: z.array(z.string()).optional(),
      minFrames: z.number().int().min(1).optional(),
      maxFrames: z.number().int().max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, allowedAssetCategories, ...rest } = input;
      await updateProject(id, {
        ...rest,
        allowedAssetCategories: allowedAssetCategories as import("../drizzle/schema").AssetCategory[] | undefined,
      });
      return { ok: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  assets: assetRouter,
  characters: characterRouter,
  stories: storyRouter,
  slides: slidesRouter,
  generate: generateRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
