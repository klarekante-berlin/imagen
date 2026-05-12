import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ASSET_VARIANT_KINDS } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import {
  applyVariantExtraction,
  deleteVariantWithStorage,
} from "../services/ai/apply-variants";
import { getAsset } from "../services/db/assets";
import {
  countVariants,
  deleteVariant,
  getVariant,
  listAllVariants,
  listVariantsForAsset,
} from "../services/db/asset-variants";

export const assetVariantsRouter = router({
  listForAsset: publicProcedure
    .input(z.object({ assetId: z.string() }))
    .query(({ input }) => listVariantsForAsset(input.assetId)),

  /** Global variant list for the Library variants tab. Strips the embedding
   * blob from the response (use hasEmbedding instead) to keep payload small. */
  listAll: publicProcedure
    .input(
      z
        .object({
          kinds: z.array(z.enum(ASSET_VARIANT_KINDS)).optional(),
          parentAssetIds: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const rows = await listAllVariants(input);
      return rows.map((v) => ({
        id: v.id,
        parentAssetId: v.parentAssetId,
        kind: v.kind,
        name: v.name,
        imageUrl: v.imageUrl,
        bboxJson: v.bboxJson,
        metadataJson: v.metadataJson,
        createdAt: v.createdAt,
        hasEmbedding: !!v.embedding,
      }));
    }),

  /** Counts for the Library stats panel. */
  stats: publicProcedure.query(() => countVariants()),

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
