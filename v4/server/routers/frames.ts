import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  FRAME_TYPES,
  TRANSPARENCY_MODES,
} from "../../shared/types/enums";
import { pollAllPending } from "../_core/pending-poller";
import { publicProcedure, router } from "../_core/trpc";
import {
  listPendingFrames,
  submitFrameForGeneration,
} from "../services/ai/generate-frame";
import { resolveStoryReferenceAssets } from "../services/ai/reference-resolver";
import { suggestNextFrame } from "../services/ai/suggest-frame";
import { getPromptRevision } from "../services/db/prompts";
import type { PromptKey } from "../../shared/types/enums";
import {
  compactSceneOrder,
  createFrame,
  deleteFrame,
  getFrame,
  listFramesForScene,
  moveFrame,
  nextFrameOrderIndex,
  updateFrame,
} from "../services/db/frames";
import { getProject } from "../services/db/projects";
import { getScene } from "../services/db/scenes";
import { getStory } from "../services/db/stories";
import { getTemplate } from "../services/db/templates";

export const framesRouter = router({
  listByScene: publicProcedure
    .input(z.object({ sceneId: z.string() }))
    .query(({ input }) => listFramesForScene(input.sceneId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getFrame(input.id)),

  create: publicProcedure
    .input(
      z.object({
        sceneId: z.string(),
        frameType: z.enum(FRAME_TYPES).optional(),
        textOverlay: z.string().optional(),
        caption: z.string().optional(),
        imagePrompt: z.string().optional(),
        transparencyMode: z.enum(TRANSPARENCY_MODES).optional(),
        /** Copy textOverlay / caption / imagePrompt / frameType / transparency
         * from this frame. Explicit input fields still win when provided. */
        cloneFromFrameId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const orderIndex = await nextFrameOrderIndex(input.sceneId);
      const source = input.cloneFromFrameId
        ? await getFrame(input.cloneFromFrameId)
        : null;
      return createFrame({
        sceneId: input.sceneId,
        orderIndex,
        frameType: input.frameType ?? source?.frameType ?? "slide",
        textOverlay: input.textOverlay ?? source?.textOverlay ?? undefined,
        caption: input.caption ?? source?.caption ?? undefined,
        imagePrompt: input.imagePrompt ?? source?.imagePrompt ?? undefined,
        transparencyMode:
          input.transparencyMode ?? source?.transparencyMode ?? "opaque",
      });
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        textOverlay: z.string().optional(),
        caption: z.string().optional(),
        imagePrompt: z.string().optional(),
        transparencyMode: z.enum(TRANSPARENCY_MODES).optional(),
        frameType: z.enum(FRAME_TYPES).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateFrame(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /** Book-only: which library characters appear on this specific page. */
  updateCast: publicProcedure
    .input(
      z.object({
        id: z.string(),
        characterIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await updateFrame(input.id, {
        castJson: input.characterIds.length > 0 ? input.characterIds : null,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /**
   * Move a frame to a target scene at a target position. Renumbers source and
   * destination scenes after the move to keep order indices contiguous.
   */
  move: publicProcedure
    .input(
      z.object({
        frameId: z.string(),
        targetSceneId: z.string(),
        /** Position in the target scene's frame list (0-based). */
        targetIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input }) => {
      const frame = await getFrame(input.frameId);
      if (!frame) throw new TRPCError({ code: "NOT_FOUND" });

      const sourceSceneId = frame.sceneId;
      const destFrames = (await listFramesForScene(input.targetSceneId)).filter(
        (f) => f.id !== input.frameId,
      );
      const clampedIndex = Math.min(input.targetIndex, destFrames.length);

      // Park the moved frame at a high index so it doesn't collide with shifts.
      await moveFrame(input.frameId, input.targetSceneId, 1_000_000);

      // Shift destination frames at >= targetIndex by +1, then drop the moved
      // frame in at targetIndex.
      for (let i = destFrames.length - 1; i >= clampedIndex; i--) {
        await updateFrame(destFrames[i]!.id, { orderIndex: i + 1 });
      }
      await updateFrame(input.frameId, { orderIndex: clampedIndex });

      // Compact source (if different) and destination to keep indices contiguous.
      if (sourceSceneId !== input.targetSceneId) {
        await compactSceneOrder(sourceSceneId);
      }
      await compactSceneOrder(input.targetSceneId);

      return getFrame(input.frameId);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const frame = await getFrame(input.id);
      await deleteFrame(input.id);
      if (frame) await compactSceneOrder(frame.sceneId);
      return { ok: true };
    }),

  generate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      if (!process.env.ATLASCLOUD_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ATLASCLOUD_API_KEY not set — generation unavailable.",
        });
      }

      const frame = await getFrame(input.id);
      if (!frame) throw new TRPCError({ code: "NOT_FOUND", message: "Frame not found" });
      if (!frame.imagePrompt?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Frame has no imagePrompt. Edit the prompt before generating.",
        });
      }
      // Allow re-trigger if the frame is "generating" but lost its prediction id
      // (server-restart leftover). Reject only when there's still an active
      // Atlas prediction tracked.
      if (frame.status === "generating" && frame.pendingPredictionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Frame is already generating (Atlas prediction in flight).",
        });
      }

      const scene = await getScene(frame.sceneId);
      const story = scene ? await getStory(scene.storyId) : undefined;
      const project = story?.projectId ? await getProject(story.projectId) : undefined;
      const template = project ? await getTemplate(project.templateId) : undefined;
      const aspect =
        project?.settingsJson?.imageFormat ??
        template?.defaultsJson.imageFormat ??
        "1:1";

      try {
        await submitFrameForGeneration({ frameId: frame.id, aspect });
      } catch (err) {
        const message = (err as Error).message ?? "Unknown error";
        await updateFrame(frame.id, { status: "error" });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Atlas submit failed: ${message.slice(0, 240)}`,
        });
      }

      return { ok: true, status: "generating" as const, aspect };
    }),

  /**
   * Submit every eligible frame in a scene to Atlas in parallel. Skips frames
   * already generating with a live prediction. Returns counts.
   */
  generateScene: publicProcedure
    .input(z.object({ sceneId: z.string() }))
    .mutation(async ({ input }) => {
      if (!process.env.ATLASCLOUD_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ATLASCLOUD_API_KEY not set.",
        });
      }
      const scene = await getScene(input.sceneId);
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      const story = await getStory(scene.storyId);
      const project = story?.projectId ? await getProject(story.projectId) : undefined;
      const template = project ? await getTemplate(project.templateId) : undefined;
      const aspect =
        project?.settingsJson?.imageFormat ??
        template?.defaultsJson.imageFormat ??
        "1:1";

      const frames = await listFramesForScene(input.sceneId);
      const eligible = frames.filter(
        (f) =>
          f.imagePrompt?.trim() &&
          !(f.status === "generating" && f.pendingPredictionId),
      );

      const results = await Promise.all(
        eligible.map(async (f) => {
          try {
            await submitFrameForGeneration({ frameId: f.id, aspect });
            return { id: f.id, ok: true as const };
          } catch (err) {
            await updateFrame(f.id, { status: "error" });
            return { id: f.id, ok: false as const, error: (err as Error).message };
          }
        }),
      );

      return {
        submitted: results.filter((r) => r.ok).length,
        skipped: frames.length - eligible.length,
        failed: results.filter((r) => !r.ok).length,
        aspect,
      };
    }),

  /**
   * Manual sync — runs the same poll the background worker does, sharing
   * its in-flight lock. Returns { skipped: true } if a periodic tick is
   * already running.
   */
  syncPending: publicProcedure.mutation(() => pollAllPending()),

  /**
   * Book-only: re-run composeBookPage against the frame's current rendition
   * using the latest scene metadata + frame.caption. Reuses the stored raw
   * illustration so no Atlas call is needed.
   */
  recomposeBookPage: publicProcedure
    .input(z.object({ frameId: z.string() }))
    .mutation(async ({ input }) => {
      const { recomposeBookPageForFrame } = await import(
        "../services/post-compose/recompose-frame"
      );
      try {
        await recomposeBookPageForFrame(input.frameId);
        return { ok: true };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      }
    }),

  /** Frames waiting on an Atlas prediction (any story, any scene). */
  listPending: publicProcedure.query(() => listPendingFrames()),

  /**
   * Ask Claude to propose the next frame's content for a scene. Returns the
   * suggestion as a draft — the client decides whether to call frames.create
   * with it.
   */
  suggestNext: publicProcedure
    .input(
      z.object({
        sceneId: z.string(),
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
      const scene = await getScene(input.sceneId);
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      const story = await getStory(scene.storyId);
      if (!story) throw new TRPCError({ code: "NOT_FOUND" });
      const project = story.projectId ? await getProject(story.projectId) : undefined;

      const activePromptIds = project?.activePromptIdsJson ?? {};
      const prompts: Partial<Record<PromptKey, string>> = {};
      for (const key of ["plan", "write", "style", "anticipate"] as PromptKey[]) {
        const revId = activePromptIds[key];
        if (!revId) continue;
        const rev = await getPromptRevision(revId);
        if (rev) prompts[key] = rev.text;
      }

      // Resolve characters available to this story for the prompt context.
      const resolved = await resolveStoryReferenceAssets(story.id, story.projectId, {
        persistBackfill: false,
      });

      const styleAnchorText =
        story.styleAnchorText ?? project?.styleAnchorText ?? null;

      const framesSoFar = await listFramesForScene(input.sceneId);

      try {
        const suggestion = await suggestNextFrame({
          story,
          scene,
          project,
          prompts,
          styleAnchorText,
          attachedCharNames: Array.from(new Set(resolved.attachedCharNames)),
          framesSoFar,
          model: input.model,
        });
        return suggestion;
      } catch (err) {
        const m = (err as Error).message ?? "Unknown error";
        if (/401|authentication_error/i.test(m)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Anthropic rejected the key." });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Suggest failed: ${m.slice(0, 240)}`,
        });
      }
    }),
});
