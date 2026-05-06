import { eq, desc, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, assets, stories, slides, InsertAsset, InsertStory, InsertSlide, Asset, Story, Slide } from "../drizzle/schema";
import { ENV } from "./_core/env";

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

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export async function createAsset(data: InsertAsset): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(assets).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getAssets(category?: string): Promise<Asset[]> {
  const db = await getDb();
  if (!db) return [];
  if (category && category !== "all") {
    return db.select().from(assets).where(eq(assets.category, category as Asset["category"])).orderBy(desc(assets.createdAt));
  }
  return db.select().from(assets).orderBy(desc(assets.createdAt));
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
