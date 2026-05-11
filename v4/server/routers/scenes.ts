import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getStoryVariant } from "../services/db/story-variants";
import {
  createScene,
  deleteScene,
  getScene,
  listScenesForVariant,
  nextSceneOrderIndex,
  reorderScenes,
  updateScene,
} from "../services/db/scenes";

export const scenesRouter = router({
  listByVariant: publicProcedure
    .input(z.object({ storyVariantId: z.string() }))
    .query(({ input }) => listScenesForVariant(input.storyVariantId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getScene(input.id)),

  create: publicProcedure
    .input(
      z.object({
        storyVariantId: z.string(),
        title: z.string().optional(),
        environment: z.string().optional(),
        environmentLockNotes: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const variant = await getStoryVariant(input.storyVariantId);
      if (!variant) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
      const orderIndex = await nextSceneOrderIndex(input.storyVariantId);
      return createScene({
        storyId: variant.storyId,
        storyVariantId: input.storyVariantId,
        orderIndex,
        title: input.title,
        environment: input.environment,
        environmentLockNotes: input.environmentLockNotes,
      });
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        environment: z.string().optional(),
        environmentLockNotes: z.string().optional(),
        transitionToNext: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateScene(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  reorder: publicProcedure
    .input(
      z.object({
        storyVariantId: z.string(),
        orderedIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      await reorderScenes(input.orderedIds);
      return listScenesForVariant(input.storyVariantId);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deleteScene(input.id);
      return { ok: true };
    }),
});
