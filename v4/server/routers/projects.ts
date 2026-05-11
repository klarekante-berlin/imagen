import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PromptKey } from "../../shared/types/enums";
import { PROMPT_KEYS } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { extractStyleFromReferences } from "../services/ai/extract-style";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "../services/db/projects";
import { createPromptRevision } from "../services/db/prompts";
import { resolveStoryAttachmentContext } from "../services/db/story-context";
import { getTemplate } from "../services/db/templates";
import { listByScope } from "../services/db/attachments";
import { db } from "../_core/db";
import { assets as assetsTable } from "../../drizzle/schema";
import { inArray } from "drizzle-orm";

async function listProjectAttachedAssets(projectId: string) {
  const rows = await listByScope("project", projectId, "asset");
  if (rows.length === 0) return [];
  return db
    .select()
    .from(assetsTable)
    .where(inArray(assetsTable.id, rows.map((r) => r.refId)));
}

export const projectsRouter = router({
  list: publicProcedure.query(() => listProjects()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getProject(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateProject(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().optional(),
        templateId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const template = await getTemplate(input.templateId);
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      const project = await createProject({
        name: input.name,
        description: input.description,
        templateId: input.templateId,
      });

      const activePromptIds: Partial<Record<PromptKey, string>> = {};
      for (const key of PROMPT_KEYS) {
        const defaultText = template.defaultsJson.defaultPrompts[key] ?? "";
        const rev = await createPromptRevision({
          projectId: project.id,
          key,
          text: defaultText,
          note: "Initial from template",
        });
        activePromptIds[key] = rev.id;
      }

      const updated = await updateProject(project.id, { activePromptIdsJson: activePromptIds });
      return updated ?? project;
    }),

  /**
   * Run Claude vision over the project's attached assets and store the
   * extracted style anchor on the project. Up to 10 references; if there
   * are more the first 10 by attachment order are used.
   */
  extractStyleAnchor: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY not set.",
        });
      }
      const project = await getProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const assets = await listProjectAttachedAssets(input.projectId);
      if (assets.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No assets attached to this project yet. Attach at least one reference image first.",
        });
      }

      try {
        const result = await extractStyleFromReferences({ assets });
        const updated = await updateProject(input.projectId, {
          styleAnchorText: result.text,
          styleAnchorStructuredJson: result.structured,
          styleAnchorUpdatedAt: new Date().toISOString(),
        });
        return { project: updated, structured: result.structured, usage: result.usage };
      } catch (err) {
        const m = (err as Error).message ?? "Unknown error";
        if (/401|authentication_error|invalid x-api-key/i.test(m)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Anthropic rejected the API key.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Style extraction failed: ${m.slice(0, 240)}`,
        });
      }
    }),

  updateStyleAnchor: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        text: z.string().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await updateProject(input.projectId, {
        styleAnchorText: input.text,
        styleAnchorUpdatedAt: new Date().toISOString(),
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /** Convenience for the canvas: returns the assets the extractor would use. */
  listStyleReferences: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listProjectAttachedAssets(input.projectId)),

  /**
   * Same as listStyleReferences but returns the union the splitter / generator
   * would actually see (project + story scope, including world-transitive
   * characters). Mainly for debugging the canvas style panel.
   */
  resolveContextForStory: publicProcedure
    .input(z.object({ storyId: z.string(), projectId: z.string().nullable() }))
    .query(({ input }) =>
      resolveStoryAttachmentContext(input.storyId, input.projectId ?? undefined),
    ),
});
