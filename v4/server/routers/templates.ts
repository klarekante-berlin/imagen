import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  FRAME_TYPES,
  PROMPT_KEYS,
  TEMPLATE_KINDS,
  TRANSPARENCY_MODES,
} from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  getTemplateByName,
  listTemplates,
  updateTemplate,
} from "../services/db/templates";

const defaultsSchema = z.object({
  imageFormat: z.string().min(1).max(20),
  frameCountMin: z.number().int().min(1).max(100),
  frameCountMax: z.number().int().min(1).max(100),
  transparency: z.enum(TRANSPARENCY_MODES),
  frameType: z.enum(FRAME_TYPES),
  defaultPrompts: z.object({
    plan: z.string(),
    write: z.string(),
    style: z.string(),
    anticipate: z.string(),
  }),
});

const uiHintsSchema = z
  .object({
    tagline: z.string().optional(),
    exampleStructure: z.string().optional(),
  })
  .optional();

export const templatesRouter = router({
  list: publicProcedure.query(() => listTemplates()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getTemplate(input.id)),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        kind: z.enum(TEMPLATE_KINDS),
        defaultsJson: defaultsSchema,
        uiHintsJson: uiHintsSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const dup = await getTemplateByName(input.name);
      if (dup) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Template "${input.name}" already exists.`,
        });
      }
      return createTemplate({
        name: input.name,
        kind: input.kind,
        defaultsJson: input.defaultsJson,
        uiHintsJson: input.uiHintsJson,
        isBuiltIn: false,
      });
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        kind: z.enum(TEMPLATE_KINDS).optional(),
        defaultsJson: defaultsSchema.optional(),
        uiHintsJson: uiHintsSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const updated = await updateTemplate(id, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const template = await getTemplate(input.id);
      if (!template) throw new TRPCError({ code: "NOT_FOUND" });
      if (template.isBuiltIn) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Built-in templates cannot be deleted. Edit instead, or clone.",
        });
      }
      await deleteTemplate(input.id);
      return { ok: true };
    }),

  /** Just to silence lints — re-export the prompt keys for the UI form. */
  promptKeys: publicProcedure.query(() => PROMPT_KEYS),
});
