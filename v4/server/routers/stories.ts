import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { SECTION_KINDS, STORY_KINDS } from "../../shared/types/enums";
import type { PromptKey } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { extractStyleFromReferences } from "../services/ai/extract-style";
import { resolveStoryReferenceAssets } from "../services/ai/reference-resolver";
import { splitContent } from "../services/ai/split-content";
import { splitBook } from "../services/ai/split-book";
import { parseBookManuscript } from "../services/ingest/book-manuscript";
import { cascadeDeleteStory } from "../services/cascade";
import { detachAllForRef } from "../services/db/attachments";
import { resolveStoryAttachmentContext } from "../services/db/story-context";
import {
  createFrame,
  listFramesForScene,
} from "../services/db/frames";
import { getProject } from "../services/db/projects";
import { getPromptRevision } from "../services/db/prompts";
import {
  createScene,
  deleteScene,
  listScenesForVariant,
} from "../services/db/scenes";
import {
  createStoryVariant,
  deleteStoryVariant,
  getPrimaryVariant,
  getStoryVariant,
  listVariantsForStory,
  setPrimaryVariant,
  updateStoryVariant,
} from "../services/db/story-variants";
import {
  createStory,
  getStory,
  listStories,
  listStoriesForProject,
  updateStory,
} from "../services/db/stories";
import { getTemplate } from "../services/db/templates";

async function duplicateVariantContents(
  fromVariantId: string,
  toVariantId: string,
): Promise<void> {
  const sourceScenes = await listScenesForVariant(fromVariantId);
  for (const scene of sourceScenes) {
    const newScene = await createScene({
      storyId: scene.storyId,
      storyVariantId: toVariantId,
      orderIndex: scene.orderIndex,
      title: scene.title,
      environment: scene.environment,
      environmentLockNotes: scene.environmentLockNotes,
      transitionToNext: scene.transitionToNext,
      charactersJson: scene.charactersJson ?? undefined,
      missingEntitiesJson: scene.missingEntitiesJson ?? undefined,
    });
    const sourceFrames = await listFramesForScene(scene.id);
    for (const frame of sourceFrames) {
      await createFrame({
        sceneId: newScene.id,
        orderIndex: frame.orderIndex,
        frameType: frame.frameType,
        textOverlay: frame.textOverlay,
        caption: frame.caption,
        imagePrompt: frame.imagePrompt,
        transparencyMode: frame.transparencyMode,
        status: "draft",
      });
    }
  }
}

export const storiesRouter = router({
  list: publicProcedure.query(() => listStories()),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listStoriesForProject(input.projectId)),

  /** Per-story counts for the table view. Returns scenes + frame breakdown
   * (ready / generating / draft / error). */
  listByProjectWithCounts: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const all = await listStoriesForProject(input.projectId);
      const framesModule = await import("../services/db/frames");
      const scenesModule = await import("../services/db/scenes");
      const variantsModule = await import("../services/db/story-variants");
      const out = await Promise.all(
        all.map(async (s) => {
          const variant = await variantsModule.getPrimaryVariant(s.id);
          const scenes = variant
            ? await scenesModule.listScenesForVariant(variant.id)
            : [];
          let total = 0;
          let ready = 0;
          let generating = 0;
          let error = 0;
          for (const sc of scenes) {
            const frames = await framesModule.listFramesForScene(sc.id);
            total += frames.length;
            for (const f of frames) {
              if (f.status === "ready") ready++;
              else if (f.status === "generating" || f.status === "queued") generating++;
              else if (f.status === "error") error++;
            }
          }
          return {
            ...s,
            primaryVariantId: variant?.id ?? null,
            sceneCount: scenes.length,
            frameCount: total,
            framesReady: ready,
            framesGenerating: generating,
            framesError: error,
          };
        }),
      );
      return out;
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getStory(input.id)),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().nullable().optional(),
        kind: z.enum(STORY_KINDS).default("story"),
        title: z.string().min(1).max(200),
        sourceText: z.string().default(""),
      }),
    )
    .mutation(async ({ input }) => {
      const story = await createStory({
        projectId: input.projectId ?? undefined,
        kind: input.kind,
        title: input.title,
        sourceText: input.sourceText,
      });
      const variant = await createStoryVariant({
        storyId: story.id,
        name: "v1",
        isPrimary: true,
      });
      return { story, primaryVariant: variant };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        sourceText: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateStory(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const story = await getStory(input.id);
      if (!story) throw new TRPCError({ code: "NOT_FOUND" });
      const counts = await cascadeDeleteStory(input.id);
      return { ok: true, ...counts };
    }),

  // ── Variants ────────────────────────────────────────────────────────────

  listVariants: publicProcedure
    .input(z.object({ storyId: z.string() }))
    .query(({ input }) => listVariantsForStory(input.storyId)),

  getVariant: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getStoryVariant(input.id)),

  getPrimaryVariant: publicProcedure
    .input(z.object({ storyId: z.string() }))
    .query(({ input }) => getPrimaryVariant(input.storyId)),

  addVariant: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        name: z.string().min(1).max(60).optional(),
        copyFromVariantId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await listVariantsForStory(input.storyId);
      const name = input.name ?? `v${existing.length + 1}`;
      const variant = await createStoryVariant({
        storyId: input.storyId,
        name,
        isPrimary: false,
      });
      if (input.copyFromVariantId) {
        await duplicateVariantContents(input.copyFromVariantId, variant.id);
      }
      return variant;
    }),

  renameVariant: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(60),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await updateStoryVariant(input.id, { name: input.name });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  setPrimaryVariant: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const updated = await setPrimaryVariant(input.id);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  deleteVariant: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const variant = await getStoryVariant(input.id);
      if (!variant) throw new TRPCError({ code: "NOT_FOUND" });
      const siblings = await listVariantsForStory(variant.storyId);
      if (siblings.length === 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete the only variant. Delete the story instead.",
        });
      }
      await deleteStoryVariant(input.id);
      if (variant.isPrimary) {
        const fallback = siblings.find((v) => v.id !== input.id);
        if (fallback) await setPrimaryVariant(fallback.id);
      }
      return { ok: true };
    }),

  /**
   * Returns the same reference set the generator and the style extractor see
   * (character primaries with lazy backfill + directly attached assets).
   * Drives the canvas Style panel's reference count.
   */
  previewReferenceAssets: publicProcedure
    .input(z.object({ storyId: z.string() }))
    .query(async ({ input }) => {
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND" });
      const resolved = await resolveStoryReferenceAssets(story.id, story.projectId, {
        persistBackfill: false,
      });
      return {
        refs: resolved.refs.map((r) => ({
          assetId: r.asset.id,
          name: r.asset.name,
          kind: r.asset.kind,
          imageUrl: r.asset.imageUrl,
          source: r.source,
          characterName: r.characterName,
        })),
      };
    }),

  /**
   * Style anchor: extract from the story's resolved reference set (character
   * primaries + directly attached assets), and store on the story row.
   * Overrides the project default at generation time.
   */
  extractStyleAnchor: publicProcedure
    .input(z.object({ storyId: z.string() }))
    .mutation(async ({ input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY not set.",
        });
      }
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND" });
      const resolved = await resolveStoryReferenceAssets(story.id, story.projectId);
      if (resolved.refs.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No reference images available. Attach a character with a sheet, or attach a style/environment/prop asset to the story (or its project).",
        });
      }
      try {
        const result = await extractStyleFromReferences({
          assets: resolved.refs.map((r) => r.asset),
        });
        const updated = await updateStory(story.id, {
          styleAnchorText: result.text,
          styleAnchorStructuredJson: result.structured,
          styleAnchorUpdatedAt: new Date().toISOString(),
        });
        return { story: updated, structured: result.structured, usage: result.usage };
      } catch (err) {
        const m = (err as Error).message ?? "Unknown error";
        if (/401|authentication_error|invalid x-api-key/i.test(m)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Anthropic rejected the API key.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Style extraction failed: ${m.slice(0, 240)}`,
        });
      }
    }),

  updateStyleAnchor: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        text: z.string().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await updateStory(input.storyId, {
        styleAnchorText: input.text,
        styleAnchorUpdatedAt: new Date().toISOString(),
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /**
   * Runs the splitter (Claude PLAN) and returns the proposed scenes/frames
   * WITHOUT writing to the DB. The client can show this as an editable
   * outline before committing.
   */
  previewSplit: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        sourceText: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY not set — splitter unavailable.",
        });
      }
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });

      // Only persist new source text if the caller provided a non-empty value.
      // An empty/whitespace-only `sourceText` must NEVER overwrite the saved
      // script — that previously bit a smoke run.
      let sourceText = (input.sourceText ?? "").trim() || story.sourceText;
      if (
        input.sourceText !== undefined &&
        input.sourceText.trim().length > 0 &&
        input.sourceText.trim() !== story.sourceText
      ) {
        const updated = await updateStory(story.id, { sourceText: input.sourceText });
        if (updated) sourceText = updated.sourceText;
      }
      if (!sourceText.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Story has no sourceText to split. Paste a script first.",
        });
      }

      const project = story.projectId ? await getProject(story.projectId) : undefined;
      const template = project ? await getTemplate(project.templateId) : undefined;
      const activePromptIds = project?.activePromptIdsJson ?? {};
      const prompts: Partial<Record<PromptKey, string>> = {};
      for (const key of ["plan", "write", "style", "anticipate"] as PromptKey[]) {
        const revId = activePromptIds[key];
        if (!revId) continue;
        const rev = await getPromptRevision(revId);
        if (rev) prompts[key] = rev.text;
      }
      const ctx = await resolveStoryAttachmentContext(story.id, story.projectId);

      try {
        const result = await splitContent({
          story,
          project,
          template,
          prompts,
          sourceText,
          attachedWorlds: ctx.worlds,
          attachedCharacters: ctx.characters,
          attachedStyleAssets: ctx.attachedAssets,
          model: input.model,
        });
        return { scenes: result.scenes, reasoning: result.reasoning, usage: result.usage };
      } catch (err) {
        const message = (err as Error).message ?? "Unknown error";
        if (/401|authentication_error|invalid x-api-key/i.test(message)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Anthropic rejected the API key.",
          });
        }
        if (/429|rate_limit/i.test(message)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Anthropic rate-limited. Retry shortly.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Splitter failed: ${message.slice(0, 240)}`,
        });
      }
    }),

  /**
   * Writes a (potentially user-edited) scene list to the target variant,
   * replacing whatever was there. The client typically calls this after
   * previewSplit + manual edits.
   */
  applySplit: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        variantId: z.string().optional(),
        scenes: z.array(
          z.object({
            title: z.string(),
            environment: z.string().optional(),
            environmentLockNotes: z.string().optional(),
            transitionToNext: z.string().optional(),
            characters: z.array(z.string()).default([]),
            frames: z.array(
              z.object({
                textOverlay: z.string().optional(),
                caption: z.string().optional(),
                imagePrompt: z.string().min(1),
              }),
            ),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });

      const variant =
        (input.variantId && (await getStoryVariant(input.variantId))) ||
        (await getPrimaryVariant(story.id));
      if (!variant || variant.storyId !== story.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
      }

      // Drop existing scenes + their frames.
      const oldScenes = await listScenesForVariant(variant.id);
      const framesModule = await import("../services/db/frames");
      for (const s of oldScenes) {
        const oldFrames = await listFramesForScene(s.id);
        for (const f of oldFrames) await framesModule.deleteFrame(f.id);
        await deleteScene(s.id);
      }

      let sceneCount = 0;
      let frameCount = 0;
      for (let si = 0; si < input.scenes.length; si++) {
        const s = input.scenes[si]!;
        const scene = await createScene({
          storyId: story.id,
          storyVariantId: variant.id,
          orderIndex: si,
          title: s.title,
          environment: s.environment,
          environmentLockNotes: s.environmentLockNotes,
          transitionToNext: s.transitionToNext,
          charactersJson: s.characters.map((rawName) => ({ rawName })),
        });
        sceneCount++;
        for (let fi = 0; fi < s.frames.length; fi++) {
          const f = s.frames[fi]!;
          await createFrame({
            sceneId: scene.id,
            orderIndex: fi,
            textOverlay: f.textOverlay,
            caption: f.caption,
            imagePrompt: f.imagePrompt,
          });
          frameCount++;
        }
      }

      return { sceneCount, frameCount };
    }),

  /**
   * Book-only: parse a markdown manuscript (+ optional image_prompts.json),
   * classify sections, match JSON prompts, batch-write the unmatched, and
   * auto-augment with Cover/ToC/Endpage. Does NOT persist; returns the
   * preview shape for the client to edit and then apply.
   */
  previewBookSplit: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        markdown: z.string().min(20),
        imagePromptsJson: z.any().optional(),
        includeChapterOpeners: z.boolean().optional(),
        autoFrontBackMatter: z.boolean().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });
      if (story.kind !== "book") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "previewBookSplit only works for kind='book' stories.",
        });
      }
      const parsed = parseBookManuscript(input.markdown, input.imagePromptsJson);
      if (parsed.stats.sections === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No sections detected — the markdown has no ## or ### headings.",
        });
      }

      // Persist the source markdown on the story so re-runs don't need re-upload.
      if (input.markdown !== story.sourceText) {
        await updateStory(story.id, { sourceText: input.markdown });
      }

      // The Claude call inside splitBook needs the API key; the pure-text
      // path doesn't. Only block when there's actually pending Claude work.
      const needsClaude = parsed.chapters
        .flatMap((c) => c.sections)
        .some((s) => s.matchedPrompts.length === 0);
      if (needsClaude && !process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ANTHROPIC_API_KEY not set — needed to generate prompts for sections without an image_prompts.json match.",
        });
      }

      try {
        const result = await splitBook(parsed, {
          includeChapterOpeners: input.includeChapterOpeners,
          autoFrontBackMatter: input.autoFrontBackMatter,
          model: input.model,
        });
        return {
          parsed: {
            title: parsed.title,
            stats: parsed.stats,
            extraCharacters: parsed.extraCharacters,
          },
          frames: result.frames.map((f) => ({
            sectionKind: f.sectionKind,
            pageNumber: f.pageNumber,
            chapterTitle: f.chapterTitle,
            imagePrompt: f.imagePrompt,
            caption: f.caption,
            origin: f.origin,
            jsonMetadata: f.jsonEntry
              ? {
                  negativePrompt: f.jsonEntry.negative_prompt,
                  aspectRatio: f.jsonEntry.aspect_ratio,
                  styleRefs: f.jsonEntry.style_refs,
                  didacticRole: f.jsonEntry.didactic_role,
                }
              : null,
          })),
          stats: result.stats,
          usage: result.usage,
        };
      } catch (err) {
        const message = (err as Error).message ?? "Unknown error";
        if (/401|authentication_error|invalid x-api-key/i.test(message)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Anthropic rejected the API key.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Book split failed: ${message.slice(0, 240)}`,
        });
      }
    }),

  /**
   * Book-only: persist a (potentially user-edited) list of book frames to
   * the active variant. Each frame becomes a scene-with-one-frame so the
   * existing canvas + generation pipeline can render it as-is.
   */
  applyBookSplit: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        variantId: z.string().optional(),
        frames: z.array(
          z.object({
            sectionKind: z.enum(SECTION_KINDS),
            pageNumber: z.number().int().nullable(),
            chapterTitle: z.string().nullable(),
            imagePrompt: z.string().min(1),
            caption: z.string().optional(),
            jsonMetadata: z
              .object({
                negativePrompt: z.string().optional(),
                aspectRatio: z.string().optional(),
                styleRefs: z.array(z.string()).optional(),
                didacticRole: z.string().optional(),
              })
              .nullable()
              .optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });
      if (story.kind !== "book") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "applyBookSplit only works for kind='book' stories.",
        });
      }
      const variant =
        (input.variantId && (await getStoryVariant(input.variantId))) ||
        (await getPrimaryVariant(story.id));
      if (!variant || variant.storyId !== story.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
      }

      // Wipe existing scenes + frames for this variant.
      const oldScenes = await listScenesForVariant(variant.id);
      const framesModule = await import("../services/db/frames");
      for (const s of oldScenes) {
        const oldFrames = await listFramesForScene(s.id);
        for (const f of oldFrames) await framesModule.deleteFrame(f.id);
        await deleteScene(s.id);
      }

      let sceneCount = 0;
      let frameCount = 0;
      for (let si = 0; si < input.frames.length; si++) {
        const f = input.frames[si]!;
        const scene = await createScene({
          storyId: story.id,
          storyVariantId: variant.id,
          orderIndex: si,
          title: f.chapterTitle ?? f.sectionKind,
          sectionKind: f.sectionKind,
          pageNumber: f.pageNumber,
          chapterTitle: f.chapterTitle,
        });
        sceneCount++;
        await createFrame({
          sceneId: scene.id,
          orderIndex: 0,
          frameType: "page",
          caption: f.caption,
          imagePrompt: f.imagePrompt,
          metadataJson: f.jsonMetadata ?? undefined,
        });
        frameCount++;
      }

      return { sceneCount, frameCount };
    }),

  /**
   * One-shot convenience: previewSplit + applySplit with no editing in between.
   * Kept for backward compatibility with the original UI flow.
   */
  split: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        variantId: z.string().optional(),
        sourceText: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY not set.",
        });
      }
      const story = await getStory(input.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });

      // Same guard as previewSplit — never overwrite saved script with empty.
      let sourceText = (input.sourceText ?? "").trim() || story.sourceText;
      if (
        input.sourceText !== undefined &&
        input.sourceText.trim().length > 0 &&
        input.sourceText.trim() !== story.sourceText
      ) {
        const updated = await updateStory(story.id, { sourceText: input.sourceText });
        if (updated) sourceText = updated.sourceText;
      }
      if (!sourceText.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No source text." });
      }

      const variant =
        (input.variantId && (await getStoryVariant(input.variantId))) ||
        (await getPrimaryVariant(story.id));
      if (!variant || variant.storyId !== story.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
      }

      const project = story.projectId ? await getProject(story.projectId) : undefined;
      const template = project ? await getTemplate(project.templateId) : undefined;
      const activePromptIds = project?.activePromptIdsJson ?? {};
      const prompts: Partial<Record<PromptKey, string>> = {};
      for (const key of ["plan", "write", "style", "anticipate"] as PromptKey[]) {
        const revId = activePromptIds[key];
        if (!revId) continue;
        const rev = await getPromptRevision(revId);
        if (rev) prompts[key] = rev.text;
      }
      const ctx = await resolveStoryAttachmentContext(story.id, story.projectId);

      let result;
      try {
        result = await splitContent({
          story,
          project,
          template,
          prompts,
          sourceText,
          attachedWorlds: ctx.worlds,
          attachedCharacters: ctx.characters,
          attachedStyleAssets: ctx.attachedAssets,
          model: input.model,
        });
      } catch (err) {
        const m = (err as Error).message ?? "Unknown error";
        if (/401|authentication_error|invalid x-api-key/i.test(m)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Anthropic rejected the API key." });
        }
        if (/429|rate_limit/i.test(m)) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Anthropic rate-limited." });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Splitter failed: ${m.slice(0, 240)}`,
        });
      }

      const framesModule = await import("../services/db/frames");
      const oldScenes = await listScenesForVariant(variant.id);
      for (const s of oldScenes) {
        const oldFrames = await listFramesForScene(s.id);
        for (const f of oldFrames) await framesModule.deleteFrame(f.id);
        await deleteScene(s.id);
      }

      let sceneCount = 0;
      let frameCount = 0;
      for (let si = 0; si < result.scenes.length; si++) {
        const s = result.scenes[si]!;
        const scene = await createScene({
          storyId: story.id,
          storyVariantId: variant.id,
          orderIndex: si,
          title: s.title,
          environment: s.environment,
          environmentLockNotes: s.environmentLockNotes,
          transitionToNext: s.transitionToNext,
          charactersJson: s.characters.map((rawName) => ({ rawName })),
        });
        sceneCount++;
        for (let fi = 0; fi < s.frames.length; fi++) {
          const f = s.frames[fi]!;
          await createFrame({
            sceneId: scene.id,
            orderIndex: fi,
            textOverlay: f.textOverlay,
            caption: f.caption,
            imagePrompt: f.imagePrompt,
          });
          frameCount++;
        }
      }

      return {
        sceneCount,
        frameCount,
        reasoning: result.reasoning,
        usage: result.usage,
      };
    }),
});
