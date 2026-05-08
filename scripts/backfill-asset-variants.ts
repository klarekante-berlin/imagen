/**
 * One-off / repeatable backfill: populate `assets.variants` for sheets that
 * predate the variants pipeline. Mirrors the on-upload flow — calls
 * `extractVariantsFromSheet` against each candidate asset's image.
 *
 * Idempotent: by default skips assets where `variants` is already non-null.
 * Pass `--force` to re-extract.
 *
 * Usage:
 *   pnpm backfill:variants --all-sheets               # every char-sheet/umgebung
 *   pnpm backfill:variants --asset-id=42              # one asset
 *   pnpm backfill:variants --all-sheets --dry-run     # report only, no DB write
 *   pnpm backfill:variants --all-sheets --force       # re-extract even if set
 *   pnpm backfill:variants --all-sheets --with-embeddings   # Branch B: also embed via Voyage
 */

import "dotenv/config";

import sharp from "sharp";

import { getAssetById, getAssets, updateAsset } from "../server/db";
import { extractVariantsFromSheet } from "../server/_core/visionCategorize";
import { getPresignedStorageUrl } from "../server/storyService";
import { storageReadLocal } from "../server/storage";
import type { Asset } from "../drizzle/schema";

interface CliArgs {
  assetId?: number;
  allSheets: boolean;
  dryRun: boolean;
  force: boolean;
  /**
   * Branch B only — when set, run Voyage multimodal embeddings against each
   * extracted variant and persist 1024-dim vectors on `variants[i].embedding`.
   * `extractVariantsFromSheet` auto-embeds when VOYAGE_API_KEY is in env, so
   * this flag also gates the env var (we delete it from the process when the
   * flag is absent so plain backfills don't silently spend Voyage credits).
   */
  withEmbeddings: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    allSheets: false,
    dryRun: false,
    force: false,
    withEmbeddings: false,
  };
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

  const meta = await sharp(bytes.buffer).metadata();
  const imageWidth = meta.width ?? 0;
  const imageHeight = meta.height ?? 0;
  if (imageWidth === 0 || imageHeight === 0) {
    console.warn(`[asset ${asset.id}] "${asset.name}" — could not read dimensions`);
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
    imageWidth,
    imageHeight,
  });

  if (variants.length === 0) {
    console.log(`[asset ${asset.id}] "${asset.name}" — no variants detected`);
    if (!args.dryRun && args.force) {
      await updateAsset(asset.id, { variants: null });
    }
    return "empty";
  }

  console.log(`[asset ${asset.id}] "${asset.name}" — ${variants.length} variants: ${variants.map((v) => v.name).join(", ")}`);
  if (!args.dryRun) {
    await updateAsset(asset.id, { variants });
  }
  return "updated";
}

async function main() {
  const args = parseArgs();
  console.log(`[backfill-variants] flags: ${JSON.stringify(args)}`);

  if (args.withEmbeddings) {
    if (!process.env.VOYAGE_API_KEY) {
      console.error(
        "[backfill-variants] --with-embeddings requires VOYAGE_API_KEY in env",
      );
      process.exit(1);
    }
  } else {
    // Without the flag: never embed, even if the env var is set in this shell.
    // extractVariantsFromSheet checks process.env.VOYAGE_API_KEY at call time.
    delete process.env.VOYAGE_API_KEY;
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
