import { and, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assets as assetsTable,
  type Asset,
} from "../../../drizzle/schema";
import { updateCharacter } from "../db/characters";
import { resolveStoryAttachmentContext } from "../db/story-context";

export type ResolvedRef = {
  asset: Asset;
  source: "character_primary" | "attached_asset";
  characterName?: string;
};

export type ResolvedReferences = {
  refs: ResolvedRef[];
  attachedCharNames: string[];
};

async function loadAssetById(id: string): Promise<Asset | null> {
  const [a] = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.id, id))
    .limit(1);
  return a ?? null;
}

async function loadAssetByCharacter(characterId: string): Promise<Asset | null> {
  const [a] = await db
    .select()
    .from(assetsTable)
    .where(
      and(
        eq(assetsTable.characterId, characterId),
        eq(assetsTable.kind, "character_sheet"),
      ),
    )
    .limit(1);
  return a ?? null;
}

/**
 * Builds the unified reference list both the image generator and the style
 * extractor consume.
 *
 * Sources (deduplicated, preserving first occurrence):
 *  1. For each character attached to the story / project / world:
 *     use character.primaryAssetId if set; otherwise look up any
 *     character_sheet asset whose characterId points at the character.
 *     If found via fallback, the pointer gets written back so the next call
 *     hits the direct path.
 *  2. Every asset attached directly to the story or project, in any kind.
 *
 * Clamped to `limit` (Atlas's edit endpoint cap is 10). Order: character
 * primaries first (identity), then everything else (style refs,
 * environments, props, character_sheets that aren't primary).
 */
export async function resolveStoryReferenceAssets(
  storyId: string,
  projectId: string | null,
  options: { limit?: number; persistBackfill?: boolean } = {},
): Promise<ResolvedReferences> {
  const limit = options.limit ?? 10;
  const persistBackfill = options.persistBackfill ?? true;

  const ctx = await resolveStoryAttachmentContext(storyId, projectId);

  const refs: ResolvedRef[] = [];
  const seenAssetIds = new Set<string>();
  const attachedCharNames: string[] = [];

  for (const c of ctx.characters) {
    let asset: Asset | null = null;
    if (c.primaryAssetId) {
      asset = await loadAssetById(c.primaryAssetId);
    }
    if (!asset) {
      const fallback = await loadAssetByCharacter(c.id);
      if (fallback) {
        asset = fallback;
        if (persistBackfill) {
          await updateCharacter(c.id, { primaryAssetId: fallback.id });
        }
      }
    }
    if (!asset) continue;
    if (seenAssetIds.has(asset.id)) {
      attachedCharNames.push(c.name);
      continue;
    }
    seenAssetIds.add(asset.id);
    refs.push({ asset, source: "character_primary", characterName: c.name });
    attachedCharNames.push(c.name);
  }

  for (const a of ctx.attachedAssets) {
    if (seenAssetIds.has(a.id)) continue;
    seenAssetIds.add(a.id);
    refs.push({ asset: a, source: "attached_asset" });
  }

  return {
    refs: refs.slice(0, limit),
    attachedCharNames,
  };
}
