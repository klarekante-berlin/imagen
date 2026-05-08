/**
 * One-off / repeatable backfill: populate `assets.variants` for sheets that
 * predate the variants pipeline. Mirrors the on-upload flow — calls
 * `extractVariantsFromSheet` against each candidate asset's image.
 *
 * Backfill v2: bbox is no longer required; variants describe panels by
 * name + description only. Re-extraction will produce variants without
 * bboxes (the new tool doesn't ask for them) — that's expected.
 *
 * Idempotent: by default skips assets where `variants` is already non-null.
 * Pass `--force` to re-extract.
 *
 * Branch B: `--with-embeddings` additionally embeds the whole sheet via
 * Voyage and persists `assets.embedding`. Requires VOYAGE_API_KEY.
 *
 * Usage:
 *   pnpm backfill:variants --all-sheets                       # every char-sheet/umgebung
 *   pnpm backfill:variants --asset-id=42                      # one asset
 *   pnpm backfill:variants --all-sheets --dry-run             # report only, no DB write
 *   pnpm backfill:variants --all-sheets --force               # re-extract even if set
 *   pnpm backfill:variants --all-sheets --with-embeddings     # also fill assets.embedding
 */

import "dotenv/config";

import { getAssetById, getAssets, updateAsset } from "../server/db";
import { extractVariantsFromSheet } from "../server/_core/visionCategorize";
import { embedSheet } from "../server/_core/voyage";
import { getPresignedStorageUrl } from "../server/storyService";
import { storageReadLocal } from "../server/storage";
import type { Asset } from "../drizzle/schema";

interface CliArgs {
  assetId?: number;
  allSheets: boolean;
  dryRun: boolean;
  force: boolean;
  withEmbeddings: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { allSheets: false, dryRun: false, force: false, withEmbeddings: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--all-sheets") args.allSheets = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--with-embeddings") args.withEmbeddings = true;
    else if (a.startsWith("--asset-id=")) args.assetId = parseInt(a.slice("--asset-id=".length), 10);
  }
  return args;
}

async function readBuffer(asset: Asset): Promise<{ buffer: Buffer; contentType: string } | null> {
  const key = (asset.imageKey || asset.imageUrl).replace(/^\/manus-storage\//, "");
  if (!key) return null;
  const local = await storageReadLocal(key);
  if (local) return local;

  const presigned = await getPresignedStorageUrl(asset.imageUrl);
  if (!presigned || !presigned.startsWith("http")) return null;
  const res = await fetch(presigned);
  if (!res.ok) return null;
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "image/png",
  };
}

async function processAsset(asset: Asset, args: CliArgs): Promise<"updated" | "skipped" | "empty" | "failed"> {
  if (!args.force && asset.variants && (asset.variants as unknown[]).length > 0) {
    console.log(`[asset ${asset.id}] "${asset.name}" — already has ${(asset.variants as unknown[]).length} variants, skipping`);
    return "skipped";
  }

  const bytes = await readBuffer(asset);
  if (!bytes) {
    console.warn(`[asset ${asset.id}] "${asset.name}" — failed to read image bytes`);
    return "failed";
  }

  const presigned = await getPresignedStorageUrl(asset.imageUrl);
  const source =
    presigned && presigned.startsWith("http")
      ? { type: "url" as const, url: presigned }
      : ({
          type: "base64" as const,
          mediaType: bytes.contentType,
          data: bytes.buffer.toString("base64"),
        } as const);

  const variants = await extractVariantsFromSheet(source, {
    isCharacterSheet: asset.isCharacterSheet,
    assetCategory: asset.category,
    visualDescription: asset.visualDescription ?? "",
  });

  // Optional Branch B: also embed the whole sheet for inspiration retrieval.
  let embedding: number[] | null | undefined;
  if (args.withEmbeddings) {
    embedding = await embedSheet(source, variants, asset.visualDescription ?? "");
    if (embedding) {
      console.log(`[asset ${asset.id}] "${asset.name}" — embedded (${embedding.length}-dim)`);
    } else {
      console.warn(`[asset ${asset.id}] "${asset.name}" — embedSheet returned null`);
    }
  }

  if (variants.length === 0) {
    console.log(`[asset ${asset.id}] "${asset.name}" — no variants detected`);
    if (!args.dryRun && args.force) {
      const patch: Partial<Asset> = { variants: null };
      if (args.withEmbeddings) patch.embedding = embedding ?? null;
      await updateAsset(asset.id, patch);
    } else if (!args.dryRun && args.withEmbeddings && embedding) {
      // Variants empty but we still want to persist the embedding.
      await updateAsset(asset.id, { embedding });
    }
    return "empty";
  }

  console.log(`[asset ${asset.id}] "${asset.name}" — ${variants.length} variants: ${variants.map((v) => v.name).join(", ")}`);
  if (!args.dryRun) {
    const patch: Partial<Asset> = { variants };
    if (args.withEmbeddings) patch.embedding = embedding ?? null;
    await updateAsset(asset.id, patch);
  }
  return "updated";
}

async function main() {
  const args = parseArgs();
  console.log(`[backfill-variants] flags: ${JSON.stringify(args)}`);

  if (args.withEmbeddings && !process.env.VOYAGE_API_KEY) {
    console.error(
      "[backfill-variants] --with-embeddings requires VOYAGE_API_KEY in env",
    );
    process.exit(1);
  }

  let candidates: Asset[];
  if (typeof args.assetId === "number" && Number.isFinite(args.assetId)) {
    const a = await getAssetById(args.assetId);
    candidates = a ? [a] : [];
  } else if (args.allSheets) {
    const all = await getAssets();
    candidates = all.filter((a) => a.isCharacterSheet || a.category === "umgebungen");
  } else {
    console.error("[backfill-variants] expected --asset-id=<n> or --all-sheets");
    process.exit(1);
  }

  if (candidates.length === 0) {
    console.log("[backfill-variants] no assets matched");
    return;
  }

  console.log(`[backfill-variants] processing ${candidates.length} asset(s)`);

  const stats = { updated: 0, skipped: 0, empty: 0, failed: 0 };
  for (const asset of candidates) {
    try {
      const result = await processAsset(asset, args);
      stats[result]++;
    } catch (e) {
      stats.failed++;
      console.error(`[asset ${asset.id}] fatal:`, e);
    }
  }

  console.log(
    `\n[backfill-variants] done: ${stats.updated} updated, ${stats.skipped} skipped, ${stats.empty} empty, ${stats.failed} failed`,
  );
  if (args.dryRun) console.log("[backfill-variants] dry-run — no DB writes performed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[backfill-variants] fatal:", e);
    process.exit(1);
  });
