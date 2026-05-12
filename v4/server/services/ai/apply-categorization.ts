import type { Asset } from "../../../drizzle/schema";
import {
  getAsset,
  setAssetEmbedding,
  updateAsset,
} from "../db/assets";
import { findCharacterByNameOrAlias } from "../db/characters";
import { categorizeAsset, type VisionUsage } from "./vision-categorize";
import { embedImageWithText } from "./voyage";
import { storageRead } from "../storage";

export type ApplyOptions = {
  /** Override the kind on the asset if Claude is confident enough. Default false
   * — we only fill metadata; the user can change the kind manually. */
  applyKindIfHighConfidence?: boolean;
  /** Re-run the multimodal embedding after writing the new description.
   * Default true so semantic search picks up the richer text immediately. */
  reembed?: boolean;
};

export type ApplyResult = {
  asset: Asset;
  usage: VisionUsage;
};

/**
 * Reads the asset, runs Claude vision, writes visualDescription / tags /
 * metadata back, and (optionally) re-embeds with the now-richer text.
 */
export async function applyVisionCategorization(
  assetId: string,
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const fresh = await getAsset(assetId);
  if (!fresh) throw new Error(`Asset ${assetId} not found`);

  const { data, usage } = await categorizeAsset({ asset: fresh });

  const newKind =
    opts.applyKindIfHighConfidence && data.kindConfidence >= 80 ? data.suggestedKind : fresh.kind;

  const mergedTags = Array.from(
    new Set([...(fresh.tagsJson ?? []), ...(data.tags ?? [])].map((t) => t.toLowerCase())),
  );

  // If Claude read a character name off the sheet and this asset is not
  // already bound, either auto-bind (existing character match) or stash the
  // name in metadata so the UI can offer "Create character X / Dismiss".
  let autoBoundCharacterId: string | null = null;
  let suggestedName: string | undefined;
  const inferred = data.inferredCharacterName?.trim();
  const isSheet = newKind === "character_sheet" || fresh.kind === "character_sheet";
  if (inferred && isSheet && !fresh.characterId) {
    const match = await findCharacterByNameOrAlias(inferred);
    if (match) {
      autoBoundCharacterId = match.id;
    } else if (!fresh.metadataJson?.inferredCharacterDismissed) {
      suggestedName = inferred;
    }
  }

  const mergedMetadata = {
    ...(fresh.metadataJson ?? {}),
    pose: data.pose ?? fresh.metadataJson?.pose,
    outfit: data.outfit ?? fresh.metadataJson?.outfit,
    setting: data.setting ?? fresh.metadataJson?.setting,
    dominantColors: data.dominantColors ?? fresh.metadataJson?.dominantColors,
    visionConfidence: data.kindConfidence,
    reviewStatus: data.kindConfidence >= 80 ? ("approved" as const) : ("needs_review" as const),
    inferredCharacterName: suggestedName,
    tagAxes: {
      ...(fresh.metadataJson?.tagAxes ?? {}),
      mood: data.mood ?? fresh.metadataJson?.tagAxes?.mood,
      location: data.setting ?? fresh.metadataJson?.tagAxes?.location,
    },
  };

  const updated = await updateAsset(assetId, {
    kind: newKind,
    characterId: autoBoundCharacterId ?? fresh.characterId,
    visualDescription: data.visualDescription,
    tagsJson: mergedTags,
    metadataJson: mergedMetadata,
  });
  if (!updated) throw new Error(`Asset ${assetId} update failed`);

  // Re-embed with the now-richer text so semantic search & RAG benefit.
  if (opts.reembed !== false && process.env.VOYAGE_API_KEY) {
    try {
      const file = await storageRead(updated.imageKey);
      if (file) {
        const text = [
          updated.name,
          data.visualDescription,
          mergedTags.join(", "),
          data.pose ? `pose: ${data.pose}` : "",
          data.outfit ? `outfit: ${data.outfit}` : "",
          data.setting ? `setting: ${data.setting}` : "",
          data.mood ? `mood: ${data.mood}` : "",
        ]
          .filter(Boolean)
          .join(". ");
        const embedding = await embedImageWithText(
          file.buffer.toString("base64"),
          text,
        );
        await setAssetEmbedding(assetId, embedding);
      }
    } catch (err) {
      console.warn(
        `[v4 categorize] re-embed failed for ${assetId}:`,
        (err as Error).message,
      );
    }
  }

  return { asset: updated, usage };
}
