import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock DB helpers
vi.mock("./db", () => ({
  getAssets: vi.fn().mockResolvedValue([]),
  getAssetById: vi.fn().mockResolvedValue(undefined),
  getAssetsByIds: vi.fn().mockResolvedValue([]),
  createAsset: vi.fn().mockResolvedValue(1),
  updateAsset: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  getStories: vi.fn().mockResolvedValue([]),
  getStoryById: vi.fn().mockResolvedValue(undefined),
  createStory: vi.fn().mockResolvedValue(1),
  updateStory: vi.fn().mockResolvedValue(undefined),
  deleteStory: vi.fn().mockResolvedValue(undefined),
  createSlides: vi.fn().mockResolvedValue(undefined),
  getSlidesByStoryId: vi.fn().mockResolvedValue([]),
  getSlideById: vi.fn().mockResolvedValue(undefined),
  updateSlide: vi.fn().mockResolvedValue(undefined),
  updateSlideByStoryAndNumber: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./storyService", () => ({
  generateStoryText: vi.fn().mockResolvedValue({
    title: "Test Story",
    consistencyContext: {
      artStyle: "cartoon",
      colorPalette: "vibrant",
      environment: "Berlin",
      characters: [],
      globalStylePrompt: "cartoon style",
    },
    slides: Array.from({ length: 10 }, (_, i) => ({
      slideNumber: i + 1,
      textContent: `Slide ${i + 1} text`,
      caption: `Caption ${i + 1}`,
      charactersInSlide: [],
      imagePrompt: `Prompt for slide ${i + 1}`,
    })),
    usedAssetIds: [],
  }),
  generateSlideImage: vi.fn().mockResolvedValue({ imageKey: "test/key.png", imageUrl: "/manus-storage/test/key.png" }),
  generateSlideImageFreepik: vi.fn().mockResolvedValue({ imageKey: "test/key.png", imageUrl: "/manus-storage/test/key.png" }),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test/key.png", url: "/manus-storage/test/key.png" }),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("auth router", () => {
  it("me returns null for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("me returns user for authenticated users", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.auth.me();
    expect(result?.name).toBe("Test User");
  });

  it("logout clears session cookie", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});

describe("assets router", () => {
  it("list returns empty array when no assets", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.assets.list({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("categories returns all asset categories", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.assets.categories();
    expect(result).toContain("familie");
    expect(result).toContain("historisch");
    expect(result).toContain("sport");
  });

  it("upload requires authentication", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.assets.upload({
        name: "Test",
        category: "familie",
        imageData: "base64data",
      })
    ).rejects.toThrow();
  });

  it("upload succeeds for authenticated users", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.assets.upload({
      name: "Test Asset",
      category: "familie",
      imageData: "dGVzdA==", // base64 "test"
      mimeType: "image/png",
      fileName: "test.png",
    });
    expect(result.id).toBe(1);
    expect(result.imageUrl).toBeTruthy();
  });
});

describe("stories router", () => {
  it("list returns empty array when no stories", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.stories.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("get returns null for non-existent story", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.stories.get({ id: 999 });
    expect(result).toBeNull();
  });

  it("create requires authentication", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.stories.create({ theme: "Test theme" })
    ).rejects.toThrow();
  });

  it("create generates story with Claude", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.stories.create({
      theme: "Familie beim Frühstück",
      selectedAssetIds: [],
      model: "claude-sonnet-4-6",
      imageFormat: "1:1",
      imageProvider: "gpt-image-2",
    });
    expect(result.storyId).toBe(1);
    expect(result.title).toBe("Test Story");
  });
});

describe("export router", () => {
  it("getExportData returns null for non-existent story", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.export.getExportData({ id: 999 })).rejects.toThrow();
  });
});
