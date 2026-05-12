import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  listAssetsForWorld,
} from "../services/db/assets";
import {
  listCharactersForWorld,
} from "../services/db/characters";
import {
  createWorld,
  deleteWorld,
  getWorld,
  getWorldByName,
  listWorlds,
  updateWorld,
} from "../services/db/worlds";

const styleTokens = z
  .object({
    artStyle: z.string().optional(),
    colorPalette: z.array(z.string()).optional(),
    typography: z.string().optional(),
    notes: z.string().optional(),
  })
  .optional();

export const worldsRouter = router({
  list: publicProcedure.query(() => listWorlds()),

  /** Per-world counts: characters, plus assets broken out by kind. Drives
   * the Worlds list page table. */
  listWithCounts: publicProcedure.query(async () => {
    const all = await listWorlds();
    const out = await Promise.all(
      all.map(async (w) => {
        const characters = await listCharactersForWorld(w.id);
        const assets = await listAssetsForWorld(w.id);
        const byKind: Record<string, number> = {};
        for (const a of assets) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
        return {
          ...w,
          characterCount: characters.length,
          environmentCount: byKind["environment"] ?? 0,
          propCount: byKind["prop"] ?? 0,
          styleRefCount: byKind["style_ref"] ?? 0,
          totalAssetCount: assets.length,
        };
      }),
    );
    return out;
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getWorld(input.id)),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().optional(),
        styleTokensJson: styleTokens,
      }),
    )
    .mutation(async ({ input }) => {
      const dup = await getWorldByName(input.name);
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "World name taken" });
      return createWorld({
        name: input.name,
        description: input.description,
        styleTokensJson: input.styleTokensJson,
      });
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().optional(),
        styleTokensJson: styleTokens,
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateWorld(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deleteWorld(input.id);
      return { ok: true };
    }),
});
