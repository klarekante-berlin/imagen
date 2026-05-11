import { z } from "zod";
import {
  ATTACHMENT_REFS,
  ATTACHMENT_SCOPES,
} from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import {
  attach,
  detach,
  listByScope,
} from "../services/db/attachments";

export const attachmentsRouter = router({
  attach: publicProcedure
    .input(
      z.object({
        scope: z.enum(ATTACHMENT_SCOPES),
        scopeId: z.string(),
        ref: z.enum(ATTACHMENT_REFS),
        refId: z.string(),
        role: z.string().optional(),
        orderIndex: z.number().int().optional(),
      }),
    )
    .mutation(({ input }) =>
      attach({
        scope: input.scope,
        scopeId: input.scopeId,
        ref: input.ref,
        refId: input.refId,
        role: input.role,
        orderIndex: input.orderIndex ?? 0,
      }),
    ),

  detach: publicProcedure
    .input(
      z.object({
        scope: z.enum(ATTACHMENT_SCOPES),
        scopeId: z.string(),
        ref: z.enum(ATTACHMENT_REFS),
        refId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      await detach(input.scope, input.scopeId, input.ref, input.refId);
      return { ok: true };
    }),

  listByScope: publicProcedure
    .input(
      z.object({
        scope: z.enum(ATTACHMENT_SCOPES),
        scopeId: z.string(),
        ref: z.enum(ATTACHMENT_REFS).optional(),
      }),
    )
    .query(({ input }) => listByScope(input.scope, input.scopeId, input.ref)),
});
