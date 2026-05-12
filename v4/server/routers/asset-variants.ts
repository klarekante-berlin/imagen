import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  applyVariantExtraction,
  deleteVariantWithStorage,
} from "../services/ai/apply-variants";
import { getAsset } from "../services/db/assets";
import {
  deleteVariant,
  getVariant,
  listVariantsForAsset,
} from "../services/db/asset-variants";

export const assetVariantsRouter = router({
  listForAsset: publicProcedure
    .input(z.object({ assetId: z.string() }))
    .query(({ input }) => listVariantsForAsset(input.assetId)),

  /** Run Claude vision to detect sub-views, crop each, embed, persist. */
  extract: publicProcedure
    .input(
      z.object({
        assetId: z.string(),
        replace: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY not set.",
        });
      }
      const asset = await getAsset(input.assetId);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      if (asset.kind !== "character_sheet") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Variants are only extracted from character_sheet assets. Re-categorize first if needed.",
        });
      }
      try {
        const r = await applyVariantExtraction(input.assetId, {
          replace: input.replace ?? true,
        });
        return { created: r.created.length, skipped: r.skipped };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Extract failed: ${(err as Error).message.slice(0, 240)}`,
        });
      }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const v = await getVariant(input.id);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      await deleteVariantWithStorage(v);
      await deleteVariant(input.id);
      return { ok: true };
    }),
});
