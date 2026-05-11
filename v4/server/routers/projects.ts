import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PromptKey } from "../../shared/types/enums";
import { PROMPT_KEYS } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "../services/db/projects";
import { createPromptRevision } from "../services/db/prompts";
import { getTemplate } from "../services/db/templates";

export const projectsRouter = router({
  list: publicProcedure.query(() => listProjects()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getProject(input.id)),

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
});
