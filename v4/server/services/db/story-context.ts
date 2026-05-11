import { db } from "../../_core/db";
import {
  assets as assetsTable,
  characters as charactersTable,
  worlds as worldsTable,
  type Asset,
  type Character,
  type World,
} from "../../../drizzle/schema";
import { inArray } from "drizzle-orm";
import { listByScope } from "./attachments";
import { listCharactersForWorld } from "./characters";

export type StoryAttachmentContext = {
  worlds: World[];
  characters: Character[];
  /** Every asset attached directly to the story or its project, regardless of kind. */
  attachedAssets: Asset[];
};

/**
 * Resolve everything attached to a story scope (and the project it belongs to,
 * if any) into concrete world/character/asset rows. Characters that are part
 * of an attached world are pulled in transitively. All attached assets are
 * returned regardless of kind — the caller (e.g. reference resolution for
 * image gen) decides how to use them.
 */
export async function resolveStoryAttachmentContext(
  storyId: string,
  projectId?: string | null,
): Promise<StoryAttachmentContext> {
  const scopes: Array<{ scope: "project" | "story"; id: string }> = [
    { scope: "story", id: storyId },
  ];
  if (projectId) scopes.push({ scope: "project", id: projectId });

  const worldIds = new Set<string>();
  const characterIds = new Set<string>();
  const assetIds = new Set<string>();

  for (const s of scopes) {
    const rows = await listByScope(s.scope, s.id);
    for (const r of rows) {
      if (r.ref === "world") worldIds.add(r.refId);
      else if (r.ref === "character") characterIds.add(r.refId);
      else if (r.ref === "asset") assetIds.add(r.refId);
    }
  }

  const worlds = worldIds.size > 0
    ? await db
        .select()
        .from(worldsTable)
        .where(inArray(worldsTable.id, Array.from(worldIds)))
    : [];

  // Transitively pull characters that live in attached worlds.
  for (const w of worlds) {
    const inhabitants = await listCharactersForWorld(w.id);
    for (const c of inhabitants) characterIds.add(c.id);
  }

  const characters = characterIds.size > 0
    ? await db
        .select()
        .from(charactersTable)
        .where(inArray(charactersTable.id, Array.from(characterIds)))
    : [];

  const attachedAssets = assetIds.size > 0
    ? await db
        .select()
        .from(assetsTable)
        .where(inArray(assetsTable.id, Array.from(assetIds)))
    : [];

  return { worlds, characters, attachedAssets };
}
