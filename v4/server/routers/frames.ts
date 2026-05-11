import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  FRAME_TYPES,
  TRANSPARENCY_MODES,
} from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { generateFrameInline } from "../services/ai/generate-frame";
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
      }),
    )
    .mutation(async ({ input }) => {
      const orderIndex = await nextFrameOrderIndex(input.sceneId);
      return createFrame({
        sceneId: input.sceneId,
        orderIndex,
        frameType: input.frameType ?? "slide",
        textOverlay: input.textOverlay,
        caption: input.caption,
        imagePrompt: input.imagePrompt,
        transparencyMode: input.transparencyMode ?? "opaque",
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

  /**
   * Fire-and-forget: marks the frame as 'generating', returns immediately,
   * runs Atlas generation in the background. UI polls frame.get / frames.listByScene
   * to surface the new rendition once it lands.
   *
   * (A proper Inngest-backed flow with retries comes in phase 3b.)
   */
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
      if (frame.status === "generating") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Frame is already generating.",
        });
      }

      // Resolve aspect from project settings → template defaults → fallback.
      const scene = await getScene(frame.sceneId);
      const story = scene ? await getStory(scene.storyId) : undefined;
      const project = story?.projectId ? await getProject(story.projectId) : undefined;
      const template = project ? await getTemplate(project.templateId) : undefined;
      const aspect =
        project?.settingsJson?.imageFormat ??
        template?.defaultsJson.imageFormat ??
        "1:1";

      // Mark generating + queue.
      await updateFrame(frame.id, { status: "generating" });

      // Background work. Errors surface in frame.status='error' + errorMessage.
      void (async () => {
        try {
          await generateFrameInline({ frameId: frame.id, aspect });
        } catch (err) {
          const message = (err as Error).message ?? "Unknown error";
          console.error(`[v4 generate] frame=${frame.id} failed:`, message);
          await updateFrame(frame.id, { status: "error" });
        }
      })();

      return { ok: true, status: "generating" as const, aspect };
    }),
});
