import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getTemplate, listTemplates } from "../services/db/templates";

export const templatesRouter = router({
  list: publicProcedure.query(() => listTemplates()),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getTemplate(input.id)),
});
