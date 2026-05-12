import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CHARACTER_ORIGINS } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { mergeCharacters } from "../services/cascade";
import {
  attach,
  detachAllForRef,
  listScopeIdsForRef,
} from "../services/db/attachments";
import { listAssetsForCharacter } from "../services/db/assets";
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listAllCharacters,
  listCharactersForProject,
  listCharactersForWorld,
  listFloatingCharacters,
  updateCharacter,
} from "../services/db/characters";

export const charactersRouter = router({
  list: publicProcedure.query(() => listAllCharacters()),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listCharactersForProject(input.projectId)),

  listByWorld: publicProcedure
    .input(z.object({ worldId: z.string() }))
    .query(({ input }) => listCharactersForWorld(input.worldId)),

  listFloating: publicProcedure.query(() => listFloatingCharacters()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getCharacter(input.id)),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().optional(),
        persona: z.string().optional(),
        aliasesJson: z.array(z.string()).optional(),
        origin: z.enum(CHARACTER_ORIGINS).optional(),
        worldId: z.string().optional(),
        attachToProjectId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const character = await createCharacter({
        name: input.name,
        description: input.description,
        persona: input.persona,
        aliasesJson: input.aliasesJson,
        origin: input.origin ?? "user",
        worldId: input.worldId,
      });
      if (input.attachToProjectId) {
        await attach({
          scope: "project",
          scopeId: input.attachToProjectId,
          ref: "character",
          refId: character.id,
        });
      }
      return character;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().optional(),
        persona: z.string().optional(),
        aliasesJson: z.array(z.string()).optional(),
        primaryAssetId: z.string().nullable().optional(),
        worldId: z.string().nullable().optional(),
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
      await detachAllForRef("character", input.id);
      return { ok: true };
    }),

  /**
   * Merge `sourceId` into `targetId`: sheets, attachments, and aliases move
   * to target; source is deleted. Errors if same id, or either missing.
   */
  merge: publicProcedure
    .input(
      z.object({
        sourceId: z.string(),
        targetId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.sourceId === input.targetId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source and target must differ",
        });
      }
      try {
        return await mergeCharacters(input.sourceId, input.targetId);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      }
    }),

  /** Where is this character used? Returns project ids it's attached to,
   * its world, and the sheets bound to it via FK. */
  usedBy: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const character = await getCharacter(input.id);
      if (!character) throw new TRPCError({ code: "NOT_FOUND" });
      const projectScopeIds = await listScopeIdsForRef(
        "character",
        input.id,
        "project",
      );
      const storyScopeIds = await listScopeIdsForRef("character", input.id, "story");
      const sheets = await listAssetsForCharacter(input.id);
      return {
        worldId: character.worldId,
        projectIds: projectScopeIds,
        storyIds: storyScopeIds,
        sheetCount: sheets.length,
        primaryAssetId: character.primaryAssetId,
      };
    }),
});
