/**
 * Imagen V3 – Database layer (Turso / libSQL)
 *
 * Local dev: SQLite file at storage-data/imagen.db (auto-created)
 * Production: Turso cloud via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, desc, and, inArray, gte, isNull } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import {
  projects,
  characters,
  assets,
  stories,
  slides,
} from "../drizzle/schema";
import type {
  Project,
  InsertProject,
  Character,
  InsertCharacter,
  Asset,
  InsertAsset,
  ReviewStatus,
  Story,
  InsertStory,
  Slide,
  InsertSlide,
} from "../drizzle/schema";

// ─── Client singleton ─────────────────────────────────────────────────────────
let _db: ReturnType<typeof drizzle> | null = null;

function getDb(): ReturnType<typeof drizzle> {
  if (_db) return _db;
  const url =
    process.env.TURSO_DATABASE_URL ?? "file:./storage-data/imagen.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url, authToken });
  _db = drizzle(client, { schema });
  return _db;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  return getDb().select().from(projects).orderBy(projects.name);
}

export async function getProjectById(id: number): Promise<Project | undefined> {
  const result = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return result[0];
}

export async function createProject(data: InsertProject): Promise<number> {
  const result = await getDb().insert(projects).values(data);
  return Number((result as any).lastInsertRowid ?? 0);
}

export async function updateProject(
  id: number,
  data: Partial<InsertProject>
): Promise<void> {
  await getDb().update(projects).set(data).where(eq(projects.id, id));
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export interface AssetFilter {
  category?: string;
  characterId?: number | null;
  reviewStatus?: ReviewStatus;
}

export async function createAsset(data: InsertAsset): Promise<number> {
  const result = await getDb().insert(assets).values(data);
  return Number((result as any).lastInsertRowid ?? 0);
}

export async function getAssets(filter?: AssetFilter): Promise<Asset[]> {
  const f = filter ?? {};
  const conds = [];
  if (f.category && f.category !== "all") {
    conds.push(eq(assets.category, f.category as Asset["category"]));
  }
  if (f.characterId === null) {
    conds.push(isNull(assets.characterId));
  } else if (typeof f.characterId === "number") {
    conds.push(eq(assets.characterId, f.characterId));
  }
  if (f.reviewStatus) {
    conds.push(eq(assets.reviewStatus, f.reviewStatus));
  }
  const q = getDb().select().from(assets).orderBy(desc(assets.createdAt));
  if (conds.length === 0) return q;
  return q.where(conds.length === 1 ? conds[0] : and(...conds)) as unknown as Promise<Asset[]>;
}

export async function getAssetById(id: number): Promise<Asset | undefined> {
  const result = await getDb()
    .select()
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  return result[0];
}

export async function getAssetByContentHash(
  hash: string
): Promise<Asset | undefined> {
  const result = await getDb()
    .select()
    .from(assets)
    .where(eq(assets.contentHash, hash))
    .limit(1);
  return result[0];
}

export async function getAssetsByIds(ids: number[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  return getDb().select().from(assets).where(inArray(assets.id, ids));
}

export async function getAssetsByCharacterId(
  characterId: number
): Promise<Asset[]> {
  return getDb()
    .select()
    .from(assets)
    .where(eq(assets.characterId, characterId))
    .orderBy(assets.isCharacterSheet);
}

export async function updateAsset(
  id: number,
  data: Partial<InsertAsset>
): Promise<void> {
  await getDb().update(assets).set(data).where(eq(assets.id, id));
}

export async function deleteAsset(id: number): Promise<void> {
  await getDb().delete(assets).where(eq(assets.id, id));
}

export async function bulkDeleteAssets(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await getDb()
    .delete(assets)
    .where(inArray(assets.id, ids));
  return (result as any).rowsAffected ?? ids.length;
}

export async function bulkApproveHighConfidence(
  minConfidence: number
): Promise<number> {
  const result = await getDb()
    .update(assets)
    .set({ reviewStatus: "approved" })
    .where(
      and(
        eq(assets.reviewStatus, "needs_review"),
        gte(assets.visionConfidence, minConfidence)
      )
    );
  return (result as any).rowsAffected ?? 0;
}

// ─── Characters ───────────────────────────────────────────────────────────────

export async function createCharacter(
  data: InsertCharacter
): Promise<number> {
  const result = await getDb().insert(characters).values(data);
  return Number((result as any).lastInsertRowid ?? 0);
}

export async function getCharacters(): Promise<Character[]> {
  return getDb().select().from(characters).orderBy(characters.name);
}

export async function getCharacterById(
  id: number
): Promise<Character | undefined> {
  const result = await getDb()
    .select()
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  return result[0];
}

export async function getCharactersByIds(ids: number[]): Promise<Character[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(characters)
    .where(inArray(characters.id, ids)) as unknown as Promise<Character[]>;
}

export async function getCharacterByName(
  name: string
): Promise<Character | undefined> {
  const result = await getDb()
    .select()
    .from(characters)
    .where(eq(characters.name, name))
    .limit(1);
  return result[0];
}

export async function updateCharacter(
  id: number,
  data: Partial<InsertCharacter>
): Promise<void> {
  await getDb().update(characters).set(data).where(eq(characters.id, id));
}

export type CharacterSuggestionInput =
  | { matchType: "existing"; characterId: number }
  | {
      matchType: "new";
      name: string;
      aliases: string[];
      kind: Character["kind"];
      defaultDescription?: string;
    }
  | { matchType: "none" };

export async function resolveOrCreateCharacter(
  suggestion: CharacterSuggestionInput
): Promise<number | null> {
  if (suggestion.matchType === "none") return null;
  if (suggestion.matchType === "existing") return suggestion.characterId;
  const existing = await getCharacterByName(suggestion.name);
  if (existing) return existing.id;
  return createCharacter({
    name: suggestion.name,
    aliases: suggestion.aliases,
    kind: suggestion.kind,
    defaultDescription: suggestion.defaultDescription ?? null,
  });
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export async function createStory(data: InsertStory): Promise<number> {
  const result = await getDb().insert(stories).values(data);
  return Number((result as any).lastInsertRowid ?? 0);
}

export async function getStories(): Promise<Story[]> {
  return getDb().select().from(stories).orderBy(desc(stories.createdAt));
}

export async function getStoryById(id: number): Promise<Story | undefined> {
  const result = await getDb()
    .select()
    .from(stories)
    .where(eq(stories.id, id))
    .limit(1);
  return result[0];
}

export async function updateStory(
  id: number,
  data: Partial<InsertStory>
): Promise<void> {
  await getDb().update(stories).set(data).where(eq(stories.id, id));
}

export async function deleteStory(id: number): Promise<void> {
  await getDb().delete(slides).where(eq(slides.storyId, id));
  await getDb().delete(stories).where(eq(stories.id, id));
}

// ─── Slides ───────────────────────────────────────────────────────────────────

export async function createSlides(
  storyId: number,
  count: number
): Promise<void> {
  const slideData: InsertSlide[] = Array.from({ length: count }, (_, i) => ({
    storyId,
    slideNumber: i + 1,
    status: "pending" as const,
  }));
  await getDb().insert(slides).values(slideData);
}

export async function getSlidesByStoryId(storyId: number): Promise<Slide[]> {
  return getDb()
    .select()
    .from(slides)
    .where(eq(slides.storyId, storyId))
    .orderBy(slides.slideNumber);
}

export async function getSlideById(id: number): Promise<Slide | undefined> {
  const result = await getDb()
    .select()
    .from(slides)
    .where(eq(slides.id, id))
    .limit(1);
  return result[0];
}

export async function updateSlide(
  id: number,
  data: Partial<InsertSlide>
): Promise<void> {
  await getDb().update(slides).set(data).where(eq(slides.id, id));
}

export async function updateSlideByStoryAndNumber(
  storyId: number,
  slideNumber: number,
  data: Partial<InsertSlide>
): Promise<void> {
  await getDb()
    .update(slides)
    .set(data)
    .where(
      and(
        eq(slides.storyId, storyId),
        eq(slides.slideNumber, slideNumber)
      )
    );
}

export async function deleteSlide(id: number): Promise<void> {
  await getDb().delete(slides).where(eq(slides.id, id));
}

export async function markSlidesNeedingRegen(
  storyId: number,
  sceneId: string
): Promise<number> {
  const result = await getDb()
    .update(slides)
    .set({ needsRegen: true })
    .where(and(eq(slides.storyId, storyId), eq(slides.sceneId, sceneId)));
  return (result as any).rowsAffected ?? 0;
}
