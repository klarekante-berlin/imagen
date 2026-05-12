import sharp from "sharp";
import type { AssetVariant } from "../../../drizzle/schema";
import {
  createVariant,
  deleteVariantsForAsset,
  setVariantEmbedding,
} from "../db/asset-variants";
import { getAsset } from "../db/assets";
import { storageDelete, storagePut, storageRead } from "../storage";
import { extractVariants, type ExtractedVariant } from "./vision-variants";
import { embedImageWithText } from "./voyage";

export type ApplyVariantsOptions = {
  /** Wipe existing variants for this asset before extracting. Default true so
   * a re-run reflects current vision output instead of stacking. */
  replace?: boolean;
};

export type ApplyVariantsResult = {
  created: AssetVariant[];
  skipped: number;
};

/** Crops sub-region of `parent` according to a normalized bbox and re-encodes
 * to JPEG q85. Returns the new buffer + actual pixel dims. */
async function cropVariant(
  parentBuffer: Buffer,
  bbox: ExtractedVariant["bbox"],
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const img = sharp(parentBuffer, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) return null;
  const left = Math.max(0, Math.round(bbox.x * meta.width));
  const top = Math.max(0, Math.round(bbox.y * meta.height));
  const w = Math.min(meta.width - left, Math.round(bbox.width * meta.width));
  const h = Math.min(meta.height - top, Math.round(bbox.height * meta.height));
  if (w < 16 || h < 16) return null;
  const buffer = await sharp(parentBuffer, { failOn: "none" })
    .rotate()
    .extract({ left, top, width: w, height: h })
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { buffer, width: w, height: h };
}

/**
 * Extracts vision-detected sub-variants from a character_sheet, crops each
 * via sharp, stores + embeds them. Asset must already exist; only sheets are
 * meaningful here (the caller should gate).
 */
export async function applyVariantExtraction(
  assetId: string,
  opts: ApplyVariantsOptions = {},
): Promise<ApplyVariantsResult> {
  const asset = await getAsset(assetId);
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  const parent = await storageRead(asset.imageKey);
  if (!parent) throw new Error(`Could not read storage for ${assetId}`);

  const { variants } = await extractVariants(asset);

  if (opts.replace !== false) {
    await deleteVariantsForAsset(assetId);
  }

  const created: AssetVariant[] = [];
  let skipped = 0;

  for (const v of variants) {
    const crop = await cropVariant(parent.buffer, v.bbox);
    if (!crop) {
      skipped++;
      continue;
    }
    const safeName = v.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 40);
    const stored = await storagePut(
      `variants/${assetId}/${Date.now()}-${safeName || v.kind}.jpg`,
      crop.buffer,
    );
    const variant = await createVariant({
      parentAssetId: assetId,
      kind: v.kind,
      name: v.name,
      imageKey: stored.key,
      imageUrl: stored.url,
      bboxJson: v.bbox,
      metadataJson: {
        visualDescription: v.description,
        tags: v.tags ?? [],
      },
    });

    if (process.env.VOYAGE_API_KEY) {
      try {
        const text = [
          asset.name,
          v.name,
          v.kind,
          v.description ?? "",
          v.pose ? `pose: ${v.pose}` : "",
          v.outfit ? `outfit: ${v.outfit}` : "",
          v.expression ? `expression: ${v.expression}` : "",
          (v.tags ?? []).join(", "),
        ]
          .filter(Boolean)
          .join(". ");
        const embedding = await embedImageWithText(
          crop.buffer.toString("base64"),
          text,
        );
        await setVariantEmbedding(variant.id, embedding);
      } catch (err) {
        console.warn(
          `[v4 variants] embed failed for variant ${variant.id}: ${(err as Error).message}`,
        );
      }
    }

    created.push(variant);
  }

  return { created, skipped };
}

/** Delete a variant and its storage file. */
export async function deleteVariantWithStorage(
  variant: AssetVariant,
): Promise<void> {
  if (variant.imageKey) {
    try {
      await storageDelete(variant.imageKey);
    } catch (err) {
      console.warn(
        `[v4 variants] storage delete failed for ${variant.imageKey}: ${(err as Error).message}`,
      );
    }
  }
}
