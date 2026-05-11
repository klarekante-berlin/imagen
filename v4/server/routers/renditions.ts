import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { updateFrame } from "../services/db/frames";
import { getFrame } from "../services/db/frames";
import {
  deleteRendition,
  getRendition,
  listRenditionsForFrame,
} from "../services/db/renditions";
import { storageDelete } from "../services/storage";

export const renditionsRouter = router({
  listByFrame: publicProcedure
    .input(z.object({ frameId: z.string() }))
    .query(({ input }) => listRenditionsForFrame(input.frameId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getRendition(input.id)),

  /**
   * Promote the frame's `previousRenditionId` to be the new `currentRenditionId`,
   * and demote the current to previous. Useful when the user prefers the
   * older version.
   */
  swapFavorite: publicProcedure
    .input(z.object({ frameId: z.string() }))
    .mutation(async ({ input }) => {
      const frame = await getFrame(input.frameId);
      if (!frame) throw new TRPCError({ code: "NOT_FOUND" });
      if (!frame.previousRenditionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Nothing to swap to — no previous rendition.",
        });
      }
      const updated = await updateFrame(frame.id, {
        currentRenditionId: frame.previousRenditionId,
        previousRenditionId: frame.currentRenditionId,
      });
      return updated;
    }),

  /**
   * Permanently drops the frame's previous (non-favorite) rendition.
   */
  dropPrevious: publicProcedure
    .input(z.object({ frameId: z.string() }))
    .mutation(async ({ input }) => {
      const frame = await getFrame(input.frameId);
      if (!frame) throw new TRPCError({ code: "NOT_FOUND" });
      if (!frame.previousRenditionId) return { ok: true };
      const removed = await deleteRendition(frame.previousRenditionId);
      if (removed?.imageKey) await storageDelete(removed.imageKey);
      await updateFrame(frame.id, { previousRenditionId: null });
      return { ok: true };
    }),
});
