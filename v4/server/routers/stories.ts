import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { STORY_KINDS } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { detachAllForRef } from "../services/db/attachments";
import {
  createFrame,
  listFramesForScene,
} from "../services/db/frames";
import {
  createScene,
  listScenesForVariant,
} from "../services/db/scenes";
import {
  createStoryVariant,
  deleteStoryVariant,
  getPrimaryVariant,
  getStoryVariant,
  listVariantsForStory,
  setPrimaryVariant,
  updateStoryVariant,
} from "../services/db/story-variants";
import {
  createStory,
  deleteStory,
  getStory,
  listStories,
  listStoriesForProject,
  updateStory,
} from "../services/db/stories";

async function duplicateVariantContents(
  fromVariantId: string,
  toVariantId: string,
): Promise<void> {
  const sourceScenes = await listScenesForVariant(fromVariantId);
  for (const scene of sourceScenes) {
    const newScene = await createScene({
      storyId: scene.storyId,
      storyVariantId: toVariantId,
      orderIndex: scene.orderIndex,
      title: scene.title,
      environment: scene.environment,
      environmentLockNotes: scene.environmentLockNotes,
      transitionToNext: scene.transitionToNext,
      charactersJson: scene.charactersJson ?? undefined,
      missingEntitiesJson: scene.missingEntitiesJson ?? undefined,
    });
    const sourceFrames = await listFramesForScene(scene.id);
    for (const frame of sourceFrames) {
      await createFrame({
        sceneId: newScene.id,
        orderIndex: frame.orderIndex,
        frameType: frame.frameType,
        textOverlay: frame.textOverlay,
        caption: frame.caption,
        imagePrompt: frame.imagePrompt,
        transparencyMode: frame.transparencyMode,
        status: "draft",
      });
    }
  }
}

export const storiesRouter = router({
  list: publicProcedure.query(() => listStories()),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listStoriesForProject(input.projectId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getStory(input.id)),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().nullable().optional(),
        kind: z.enum(STORY_KINDS).default("story"),
        title: z.string().min(1).max(200),
        sourceText: z.string().default(""),
      }),
    )
    .mutation(async ({ input }) => {
      const story = await createStory({
        projectId: input.projectId ?? undefined,
        kind: input.kind,
        title: input.title,
        sourceText: input.sourceText,
      });
      const variant = await createStoryVariant({
        storyId: story.id,
        name: "v1",
        isPrimary: true,
      });
      return { story, primaryVariant: variant };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        sourceText: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateStory(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deleteStory(input.id);
      await detachAllForRef("asset", input.id); // any attachments by id (defensive)
      return { ok: true };
    }),

  // ── Variants ────────────────────────────────────────────────────────────

  listVariants: publicProcedure
    .input(z.object({ storyId: z.string() }))
    .query(({ input }) => listVariantsForStory(input.storyId)),

  getVariant: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getStoryVariant(input.id)),

  getPrimaryVariant: publicProcedure
    .input(z.object({ storyId: z.string() }))
    .query(({ input }) => getPrimaryVariant(input.storyId)),

  addVariant: publicProcedure
    .input(
      z.object({
        storyId: z.string(),
        name: z.string().min(1).max(60).optional(),
        copyFromVariantId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await listVariantsForStory(input.storyId);
      const name = input.name ?? `v${existing.length + 1}`;
      const variant = await createStoryVariant({
        storyId: input.storyId,
        name,
        isPrimary: false,
      });
      if (input.copyFromVariantId) {
        await duplicateVariantContents(input.copyFromVariantId, variant.id);
      }
      return variant;
    }),

  renameVariant: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(60),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await updateStoryVariant(input.id, { name: input.name });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  setPrimaryVariant: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const updated = await setPrimaryVariant(input.id);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  deleteVariant: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const variant = await getStoryVariant(input.id);
      if (!variant) throw new TRPCError({ code: "NOT_FOUND" });
      const siblings = await listVariantsForStory(variant.storyId);
      if (siblings.length === 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete the only variant. Delete the story instead.",
        });
      }
      await deleteStoryVariant(input.id);
      if (variant.isPrimary) {
        const fallback = siblings.find((v) => v.id !== input.id);
        if (fallback) await setPrimaryVariant(fallback.id);
      }
      return { ok: true };
    }),
});
