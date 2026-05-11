import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CHARACTER_ORIGINS } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
} from "../services/db/characters";

export const charactersRouter = router({
  listByProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listCharacters(input.projectId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getCharacter(input.id)),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(120),
        description: z.string().optional(),
        persona: z.string().optional(),
        aliasesJson: z.array(z.string()).optional(),
        origin: z.enum(CHARACTER_ORIGINS).optional(),
      }),
    )
    .mutation(({ input }) =>
      createCharacter({
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        persona: input.persona,
        aliasesJson: input.aliasesJson,
        origin: input.origin ?? "user",
      }),
    ),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().optional(),
        persona: z.string().optional(),
        aliasesJson: z.array(z.string()).optional(),
        primaryAssetId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateCharacter(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deleteCharacter(input.id);
      return { ok: true };
    }),
});
