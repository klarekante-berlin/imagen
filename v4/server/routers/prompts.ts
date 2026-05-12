import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROMPT_KEYS } from "../../shared/types/enums";
import type { PromptKey } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { getProject, updateProject } from "../services/db/projects";
import {
  createPromptRevision,
  deletePromptRevision,
  getPromptRevision,
  listPromptRevisions,
} from "../services/db/prompts";
import { getTemplate } from "../services/db/templates";

export const promptsRouter = router({
  /** All revisions for a project, optionally narrowed to a single key. */
  listForProject: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        key: z.enum(PROMPT_KEYS).optional(),
      }),
    )
    .query(({ input }) => listPromptRevisions(input.projectId, input.key)),

  /** Resolve the currently-active revision per key for a project. */
  activeForProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const activeIds = project.activePromptIdsJson ?? {};
      const out: Record<PromptKey, { id: string; text: string; createdAt: string } | null> = {
        plan: null,
        write: null,
        style: null,
        anticipate: null,
      };
      for (const key of PROMPT_KEYS) {
        const revId = activeIds[key];
        if (!revId) continue;
        const rev = await getPromptRevision(revId);
        if (rev) out[key] = { id: rev.id, text: rev.text, createdAt: rev.createdAt };
      }
      return out;
    }),

  /** Create a new revision for a key. If activate=true (default), also set
   * it as the project's active revision for that key. */
  createRevision: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        key: z.enum(PROMPT_KEYS),
        text: z.string().min(1),
        note: z.string().optional(),
        activate: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const rev = await createPromptRevision({
        projectId: input.projectId,
        key: input.key,
        text: input.text,
        note: input.note,
      });
      if (input.activate) {
        const activeIds = { ...(project.activePromptIdsJson ?? {}) };
        activeIds[input.key] = rev.id;
        await updateProject(project.id, { activePromptIdsJson: activeIds });
      }
      return rev;
    }),

  /** Promote an existing revision to be the active one for its key. */
  setActive: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        revisionId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const rev = await getPromptRevision(input.revisionId);
      if (!rev || rev.projectId !== project.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Revision not found for this project" });
      }
      const activeIds = { ...(project.activePromptIdsJson ?? {}) };
      activeIds[rev.key] = rev.id;
      const updated = await updateProject(project.id, { activePromptIdsJson: activeIds });
      return updated ?? project;
    }),

  /** Reset a key back to the project's template default. Creates a new
   * revision with the template's default text and activates it. */
  resetToTemplate: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        key: z.enum(PROMPT_KEYS),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const template = await getTemplate(project.templateId);
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      const defaultText = template.defaultsJson.defaultPrompts[input.key] ?? "";
      const rev = await createPromptRevision({
        projectId: input.projectId,
        key: input.key,
        text: defaultText,
        note: "Reset to template default",
      });
      const activeIds = { ...(project.activePromptIdsJson ?? {}) };
      activeIds[input.key] = rev.id;
      await updateProject(project.id, { activePromptIdsJson: activeIds });
      return rev;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const rev = await getPromptRevision(input.id);
      if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await getProject(rev.projectId);
      const activeIds = project?.activePromptIdsJson ?? {};
      if (activeIds[rev.key] === rev.id) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This revision is active. Activate another one first.",
        });
      }
      await deletePromptRevision(input.id);
      return { ok: true };
    }),
});
