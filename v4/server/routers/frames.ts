import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  FRAME_TYPES,
  TRANSPARENCY_MODES,
} from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
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
});
