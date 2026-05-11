import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ASSET_KINDS, type AssetKind } from "../../shared/types/enums";
import { publicProcedure, router } from "../_core/trpc";
import { embedImageWithText, embedText } from "../services/ai/voyage";
import {
  createAsset,
  deleteAsset,
  getAsset,
  getAssetByContentHash,
  listAssetsForCharacter,
  listAssetsForProject,
  searchAssetsByEmbedding,
  setAssetEmbedding,
} from "../services/db/assets";
import { storageDelete, storagePut } from "../services/storage";

const base64Image = z
  .string()
  .min(20)
  .regex(/^[A-Za-z0-9+/=]+$/, "Must be raw base64 (no data URL prefix)");

const fileExtFor = (mime: string): string => {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "bin";
};

async function safeEmbed(
  imageBase64: string | null,
  text: string,
): Promise<Buffer | null> {
  if (!process.env.VOYAGE_API_KEY) return null;
  try {
    if (imageBase64) return await embedImageWithText(imageBase64, text);
    return await embedText(text);
  } catch (err) {
    console.warn("[v4 assets] embed failed:", (err as Error).message);
    return null;
  }
}

export const assetsRouter = router({
  listByProject: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        kinds: z.array(z.enum(ASSET_KINDS)).optional(),
      }),
    )
    .query(({ input }) => listAssetsForProject(input.projectId, input.kinds)),

  listByCharacter: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .query(({ input }) => listAssetsForCharacter(input.characterId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getAsset(input.id)),

  uploadBase64: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        characterId: z.string().optional(),
        kind: z.enum(ASSET_KINDS),
        name: z.string().min(1).max(160),
        mimeType: z.string().default("image/png"),
        imageBase64: base64Image,
        visualDescription: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.imageBase64, "base64");
      if (buffer.byteLength === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file" });
      }

      const ext = fileExtFor(input.mimeType);
      const safeName = input.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
      const stored = await storagePut(
        `projects/${input.projectId}/${input.kind}/${safeName}.${ext}`,
        buffer,
      );

      const existing = await getAssetByContentHash(stored.contentHash);
      if (existing) {
        // Drop the freshly-written duplicate file; keep the canonical row.
        await storageDelete(stored.key);
        return { asset: existing, deduplicated: true };
      }

      const asset = await createAsset({
        projectId: input.projectId,
        characterId: input.characterId,
        kind: input.kind,
        name: input.name,
        imageKey: stored.key,
        imageUrl: stored.url,
        contentHash: stored.contentHash,
        visualDescription: input.visualDescription,
        tagsJson: input.tags,
      });

      const embedding = await safeEmbed(
        input.imageBase64,
        [input.name, input.visualDescription ?? "", (input.tags ?? []).join(", ")]
          .filter(Boolean)
          .join(". "),
      );
      if (embedding) await setAssetEmbedding(asset.id, embedding);

      return { asset, deduplicated: false };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(160).optional(),
        visualDescription: z.string().optional(),
        tags: z.array(z.string()).optional(),
        characterId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, tags, ...rest } = input;
      const asset = await getAsset(id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await import("../services/db/assets").then((m) =>
        m.updateAsset(id, { ...rest, tagsJson: tags ?? asset.tagsJson ?? undefined }),
      );
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const removed = await deleteAsset(input.id);
      if (removed?.imageKey) await storageDelete(removed.imageKey);
      return { ok: true };
    }),

  search: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: z.string().min(1).max(500),
        topK: z.number().int().min(1).max(50).default(10),
        kinds: z.array(z.enum(ASSET_KINDS)).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!process.env.VOYAGE_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "VOYAGE_API_KEY not set — semantic search unavailable",
        });
      }
      let queryEmbedding: Buffer;
      try {
        queryEmbedding = await embedText(input.query);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Voyage embedding failed: ${(err as Error).message.slice(0, 200)}`,
        });
      }
      const kinds = input.kinds as AssetKind[] | undefined;
      const hits = await searchAssetsByEmbedding(
        input.projectId,
        queryEmbedding,
        input.topK,
        kinds,
      );
      return hits.map((h) => ({ ...h.asset, score: h.score }));
    }),
});
