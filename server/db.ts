import { eq, desc, and, inArray, gte, isNull, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  assets, stories, slides, characters,
  InsertAsset, InsertStory, InsertSlide, InsertCharacter,
  Asset, Story, Slide, Character, ReviewStatus,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export async function createAsset(data: InsertAsset): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(assets).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export interface AssetFilter {
  category?: string;
  characterId?: number | null;
  reviewStatus?: ReviewStatus;
}

export async function getAssets(filter?: AssetFilter): Promise<Asset[]> {
  const db = await getDb();
  if (!db) return [];
  const f: AssetFilter = filter ?? {};
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
  const query = db.select().from(assets).orderBy(desc(assets.createdAt));
  if (conds.length === 0) return query;
  return query.where(conds.length === 1 ? conds[0] : and(...conds)) as unknown as Promise<Asset[]>;
}
export async function getAssetByContentHash(hash: string): Promise<Asset | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(assets).where(eq(assets.contentHash, hash)).limit(1);
  return result[0];
}

export async function bulkApproveHighConfidence(minConfidence: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(assets)
    .set({ reviewStatus: "approved" })
    .where(
      and(
        eq(assets.reviewStatus, "needs_review"),
        gte(assets.visionConfidence, minConfidence)
      )
    );
  return (result[0] as { affectedRows: number }).affectedRows ?? 0;
}

export async function getAssetById(id: number): Promise<Asset | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return result[0];
}

export async function getAssetsByIds(ids: number[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(assets).where(inArray(assets.id, ids));
}

/**
 * Branch B retrieval: every asset whose sheet-level Voyage embedding has
 * been persisted. Caller computes cosine in process — keeps the SQL trivial
 * and avoids vector-column extensions.
 */
export async function getAssetsWithEmbedding(): Promise<Asset[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(assets).where(isNotNull(assets.embedding));
}

export async function updateAsset(id: number, data: Partial<InsertAsset>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(assets).set(data).where(eq(assets.id, id));
}

export async function deleteAsset(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(assets).where(eq(assets.id, id));
}

export async function bulkDeleteAssets(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDb();
  if (!db) return 0;
  const result = await db.delete(assets).where(inArray(assets.id, ids));
  // drizzle returns ResultSetHeader for mysql; affectedRows is what we want.
  return (result as unknown as { affectedRows?: number }).affectedRows ?? ids.length;
}

// ─── Characters ───────────────────────────────────────────────────────────────

export async function createCharacter(data: InsertCharacter): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(characters).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getCharacters(): Promise<Character[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(characters).orderBy(characters.name);
}

export async function getCharacterById(id: number): Promise<Character | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  return result[0];
}

export async function getCharactersByIds(ids: number[]): Promise<Character[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(characters).where(inArray(characters.id, ids)) as unknown as Promise<Character[]>;
}

export async function getCharacterByName(name: string): Promise<Character | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(characters).where(eq(characters.name, name)).limit(1);
  return result[0];
}

export async function updateCharacter(id: number, data: Partial<InsertCharacter>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(characters).set(data).where(eq(characters.id, id));
}

export type CharacterSuggestionInput =
  | { matchType: "existing"; characterId: number }
  | { matchType: "new"; name: string; aliases: string[]; kind: Character["kind"]; defaultDescription?: string }
  | { matchType: "none" };

/**
 * Returns characterId for the suggestion: looks up existing, inserts new, or returns null.
 * For "new" suggestions, dedupes by name (case-sensitive — the unique index handles it).
 */
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(stories).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getStories(): Promise<Story[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stories).orderBy(desc(stories.createdAt));
}

export async function getStoryById(id: number): Promise<Story | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stories).where(eq(stories.id, id)).limit(1);
  return result[0];
}

export async function updateStory(id: number, data: Partial<InsertStory>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stories).set(data).where(eq(stories.id, id));
}

export async function deleteStory(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(slides).where(eq(slides.storyId, id));
  await db.delete(stories).where(eq(stories.id, id));
}

// ─── Slides ───────────────────────────────────────────────────────────────────

export async function createSlides(storyId: number, count: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const slideData: InsertSlide[] = Array.from({ length: count }, (_, i) => ({
    storyId,
    slideNumber: i + 1,
    status: "pending" as const,
  }));
  await db.insert(slides).values(slideData);
}

export async function getSlidesByStoryId(storyId: number): Promise<Slide[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(slides).where(eq(slides.storyId, storyId)).orderBy(slides.slideNumber);
}

export async function getSlideById(id: number): Promise<Slide | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(slides).where(eq(slides.id, id)).limit(1);
  return result[0];
}

export async function updateSlide(id: number, data: Partial<InsertSlide>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(slides).set(data).where(eq(slides.id, id));
}

export async function updateSlideByStoryAndNumber(storyId: number, slideNumber: number, data: Partial<InsertSlide>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(slides).set(data).where(and(eq(slides.storyId, storyId), eq(slides.slideNumber, slideNumber)));
}

export async function deleteSlide(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(slides).where(eq(slides.id, id));
}

/**
 * Mark all slides in `storyId` whose `sceneId` matches as needing regen.
 * Used by `stories.updateScene` so every slide in the edited scene flips its
 * yellow "regenerate to apply" strip on. Returns affectedRows.
 */
export async function markSlidesNeedingRegen(storyId: number, sceneId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .update(slides)
    .set({ needsRegen: true })
    .where(and(eq(slides.storyId, storyId), eq(slides.sceneId, sceneId)));
  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}
