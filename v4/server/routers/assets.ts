import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ASSET_KINDS, type AssetKind } from "../../shared/types/enums";
import { toPublicAsset } from "../../shared/types/asset-view";
import { publicProcedure, router } from "../_core/trpc";
import { embedImageWithText, embedText } from "../services/ai/voyage";
import {
  createAsset,
  deleteAsset,
  getAsset,
  getAssetByContentHash,
  listAllAssets,
  listAssetsForCharacter,
  listAssetsForProject,
  listAssetsForWorld,
  searchAssetsByEmbedding,
  setAssetEmbedding,
  updateAsset,
} from "../services/db/assets";
import {
  attach,
  detachAllForRef,
  listScopeIdsForRef,
} from "../services/db/attachments";
import { storageDelete, storagePut } from "../services/storage";
import { normalizeImageForRef } from "../services/storage/normalize-image";

const base64Image = z
  .string()
  .min(20)
  .regex(/^[A-Za-z0-9+/=]+$/, "Must be raw base64 (no data URL prefix)");

// fileExtFor no longer used now that uploads always normalize to .jpg, but
// keeping the import surface stable for any external callers.

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
  list: publicProcedure
    .input(
      z.object({
        kinds: z.array(z.enum(ASSET_KINDS)).optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const rows = await listAllAssets(input?.kinds);
      return rows.map(toPublicAsset);
    }),

  listByProject: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        kinds: z.array(z.enum(ASSET_KINDS)).optional(),
      }),
    )
    .query(async ({ input }) => {
      const rows = await listAssetsForProject(input.projectId, input.kinds);
      return rows.map(toPublicAsset);
    }),

  listByWorld: publicProcedure
    .input(
      z.object({
        worldId: z.string(),
        kinds: z.array(z.enum(ASSET_KINDS)).optional(),
      }),
    )
    .query(async ({ input }) => {
      const rows = await listAssetsForWorld(input.worldId, input.kinds);
      return rows.map(toPublicAsset);
    }),

  listByCharacter: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .query(async ({ input }) => {
      const rows = await listAssetsForCharacter(input.characterId);
      return rows.map(toPublicAsset);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const row = await getAsset(input.id);
      return row ? toPublicAsset(row) : undefined;
    }),

  uploadBase64: publicProcedure
    .input(
      z.object({
        kind: z.enum(ASSET_KINDS),
        name: z.string().min(1).max(160),
        mimeType: z.string().default("image/png"),
        imageBase64: base64Image,
        visualDescription: z.string().optional(),
        tags: z.array(z.string()).optional(),
        characterId: z.string().optional(),
        worldId: z.string().optional(),
        attachToProjectId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const rawBuffer = Buffer.from(input.imageBase64, "base64");
      if (rawBuffer.byteLength === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file" });
      }

      // Normalize every upload: longest side ≤ 1536, JPEG q85, EXIF-rotated.
      // Cuts payload to Atlas + Claude vision and keeps the on-disk store tidy.
      let normalized;
      try {
        normalized = await normalizeImageForRef(rawBuffer);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not decode image: ${(err as Error).message.slice(0, 200)}`,
        });
      }
      const buffer = normalized.buffer;
      console.log(
        `[v4 upload] ${input.name}: ${rawBuffer.byteLength} → ${buffer.byteLength} bytes (${normalized.width}×${normalized.height} jpeg)`,
      );

      const safeName = input.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
      const stored = await storagePut(
        `library/${input.kind}/${safeName}.jpg`,
        buffer,
      );

      const existing = await getAssetByContentHash(stored.contentHash);
      if (existing) {
        await storageDelete(stored.key);
        const patch: Parameters<typeof updateAsset>[1] = {};
        if (!existing.characterId && input.characterId) patch.characterId = input.characterId;
        if (!existing.worldId && input.worldId) patch.worldId = input.worldId;
        const linked = Object.keys(patch).length > 0
          ? await updateAsset(existing.id, patch)
          : existing;
        if (input.attachToProjectId) {
          await attach({
            scope: "project",
            scopeId: input.attachToProjectId,
            ref: "asset",
            refId: existing.id,
          });
        }
        return { asset: toPublicAsset(linked ?? existing), deduplicated: true };
      }

      const asset = await createAsset({
        characterId: input.characterId,
        worldId: input.worldId,
        kind: input.kind,
        name: input.name,
        imageKey: stored.key,
        imageUrl: stored.url,
        contentHash: stored.contentHash,
        visualDescription: input.visualDescription,
        tagsJson: input.tags,
        metadataJson: {
          width: normalized.width,
          height: normalized.height,
          bytes: normalized.finalBytes,
        },
      });

      if (input.attachToProjectId) {
        await attach({
          scope: "project",
          scopeId: input.attachToProjectId,
          ref: "asset",
          refId: asset.id,
        });
      }

      const embedding = await safeEmbed(
        input.imageBase64,
        [input.name, input.visualDescription ?? "", (input.tags ?? []).join(", ")]
          .filter(Boolean)
          .join(". "),
      );
      let finalAsset = asset;
      if (embedding) {
        await setAssetEmbedding(asset.id, embedding);
        const refreshed = await getAsset(asset.id);
        if (refreshed) finalAsset = refreshed;
      }

      return { asset: toPublicAsset(finalAsset), deduplicated: false };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(160).optional(),
        visualDescription: z.string().optional(),
        tags: z.array(z.string()).optional(),
        characterId: z.string().nullable().optional(),
        worldId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, tags, ...rest } = input;
      const asset = await getAsset(id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await updateAsset(id, {
        ...rest,
        tagsJson: tags ?? asset.tagsJson ?? undefined,
      });
      return updated ? toPublicAsset(updated) : undefined;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const removed = await deleteAsset(input.id);
      if (removed?.imageKey) await storageDelete(removed.imageKey);
      if (removed) await detachAllForRef("asset", removed.id);
      return { ok: true };
    }),

  /** Where is this asset used? Returns project ids it's attached to plus the
   * character it's bound to via FK. */
  usedBy: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const asset = await getAsset(input.id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      const projectScopeIds = await listScopeIdsForRef("asset", input.id, "project");
      const storyScopeIds = await listScopeIdsForRef("asset", input.id, "story");
      return {
        characterId: asset.characterId,
        worldId: asset.worldId,
        projectIds: projectScopeIds,
        storyIds: storyScopeIds,
      };
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        topK: z.number().int().min(1).max(50).default(10),
        projectId: z.string().optional(),
        worldId: z.string().optional(),
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
      const hits = await searchAssetsByEmbedding(queryEmbedding, input.topK, {
        projectId: input.projectId,
        worldId: input.worldId,
        kinds: input.kinds as AssetKind[] | undefined,
      });
      return hits.map((h) => ({ ...toPublicAsset(h.asset), score: h.score }));
    }),
});
