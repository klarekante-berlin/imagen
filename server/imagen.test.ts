import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { prepareCroppedRefForAtlas } from "./_core/imagePrep";
import { __testables as visionTestables } from "./_core/visionCategorize";

// Mock DB helpers
vi.mock("./db", () => ({
  getAssets: vi.fn().mockResolvedValue([]),
  getAssetById: vi.fn().mockResolvedValue(undefined),
  getAssetsByIds: vi.fn().mockResolvedValue([]),
  createAsset: vi.fn().mockResolvedValue(1),
  updateAsset: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  getAssetByContentHash: vi.fn().mockResolvedValue(undefined),
  bulkApproveHighConfidence: vi.fn().mockResolvedValue(0),
  getCharacters: vi.fn().mockResolvedValue([]),
  getCharacterById: vi.fn().mockResolvedValue(undefined),
  getCharacterByName: vi.fn().mockResolvedValue(undefined),
  createCharacter: vi.fn().mockResolvedValue(1),
  updateCharacter: vi.fn().mockResolvedValue(undefined),
  resolveOrCreateCharacter: vi.fn().mockResolvedValue(null),
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
}));

vi.mock("./_core/visionCategorize", async () => {
  // Import the real module to keep `__testables` (pure validation) intact for
  // the variant tests below. The router test path replaces `categorizeImage`
  // and `extractVariantsFromSheet` with stubs.
  const real = await vi.importActual<typeof import("./_core/visionCategorize")>(
    "./_core/visionCategorize",
  );
  return {
    ...real,
    categorizeImage: vi.fn().mockResolvedValue({
      suggestedCategory: "sonstiges",
      categoryConfidence: 50,
      suggestedCharacter: { matchType: "none", confidence: 50 },
      isCharacterSheet: false,
      visualDescription: "test",
      tags: [],
      needsHumanReview: true,
    }),
    extractVariantsFromSheet: vi.fn().mockResolvedValue([]),
    reviewStatusFromResult: vi.fn().mockReturnValue("needs_review"),
  };
});

vi.mock("./storyPlanner", () => ({
  planStory: vi.fn().mockResolvedValue({
    title: "Test Plan",
    suggestedSlideCount: 6,
    reasoning: "test reasoning",
    scenes: [{ id: "scene-1", slideRange: [1, 6], environment: "Berlin", environmentLockNotes: "" }],
    detectedEntities: [],
  }),
  writeStorySlides: vi.fn().mockResolvedValue({
    consistencyContext: {
      version: 2,
      artStyle: "cartoon",
      colorPalette: "warm",
      scenes: [{ id: "scene-1", slideRange: [1, 6], environment: "Berlin", environmentLockNotes: "" }],
      characters: [],
      globalStylePrompt: "test",
      styleReferenceUrls: [],
      worldBuiltAssetIds: [],
      slideCount: 6,
    },
    slides: Array.from({ length: 6 }, (_, i) => ({
      slideNumber: i + 1,
      sceneId: "scene-1",
      textContent: `Slide ${i + 1}`,
      caption: `Cap ${i + 1}`,
      charactersInSlide: [],
      imagePrompt: `Prompt ${i + 1}`,
    })),
  }),
  scoreCharacterMatches: vi.fn().mockReturnValue([]),
}));

vi.mock("./storyService", () => ({
  generateSlideImage: vi.fn().mockResolvedValue({ imageKey: "test/key.png", imageUrl: "/manus-storage/test/key.png" }),
  generateSlideImageFreepik: vi.fn().mockResolvedValue({ imageKey: "test/key.png", imageUrl: "/manus-storage/test/key.png" }),
  getPresignedStorageUrl: vi.fn().mockResolvedValue(null),
  getVariantPresignedUrl: vi.fn().mockResolvedValue(null),
  normalizeConsistencyContext: vi.fn().mockImplementation((raw: unknown) => raw),
  findSceneForSlide: vi.fn().mockReturnValue(null),
  deriveSceneSlideRanges: vi.fn().mockImplementation((scenes: unknown) => scenes),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test/key.png", url: "/manus-storage/test/key.png" }),
}));

function createPublicContext(): TrpcContext {
  return {
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

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

  it("upload succeeds", async () => {
    const caller = appRouter.createCaller(createPublicContext());
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

  it("plan returns proposed slide count and scenes", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.stories.plan({
      theme: "Test",
      model: "claude-sonnet-4-6",
    });
    expect(result.suggestedSlideCount).toBe(6);
    expect(result.scenes).toHaveLength(1);
    expect(result.title).toBe("Test Plan");
  });

  it("generate writes story from confirmed plan with variable count", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.stories.generate({
      theme: "Test theme",
      plan: {
        title: "Test",
        suggestedSlideCount: 6,
        reasoning: "test",
        scenes: [{ id: "scene-1", slideRange: [1, 6], environment: "Berlin", environmentLockNotes: "" }],
        detectedEntities: [],
      },
      model: "claude-sonnet-4-6",
      imageFormat: "1:1",
      imageProvider: "gpt-image-2",
    });
    expect(result.storyId).toBe(1);
    expect(result.title).toBe("Test");
  });
});

// ─── Variants infrastructure ──────────────────────────────────────────────────

describe("prepareCroppedRefForAtlas", () => {
  it("crops a region and returns a JPEG with the expected dimensions", async () => {
    // 200x100 white PNG.
    const sourcePng = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const out = await prepareCroppedRefForAtlas(sourcePng, "image/png", [50, 25, 100, 50]);
    expect(out.mediaType).toBe("image/jpeg");
    expect(out.buffer.length).toBeGreaterThan(0);

    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });

  it("rejects an out-of-bounds bbox", async () => {
    const sourcePng = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      prepareCroppedRefForAtlas(sourcePng, "image/png", [0, 0, 200, 200]),
    ).rejects.toThrow(/exceeds source/);
  });

  it("rejects a zero-area bbox", async () => {
    const sourcePng = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      prepareCroppedRefForAtlas(sourcePng, "image/png", [10, 10, 0, 10]),
    ).rejects.toThrow(/invalid bbox/);
  });
});

describe("extractVariantsFromSheet validation", () => {
  it("normaliseVariant accepts a well-formed entry", () => {
    const v = visionTestables.normaliseVariant(
      { name: "cooking-apron", axis: "outfit", bbox: [0, 0, 100, 100], description: "Schürze" },
      500,
      500,
    );
    expect(v).not.toBeNull();
    expect(v?.name).toBe("cooking-apron");
    expect(v?.bbox).toEqual([0, 0, 100, 100]);
  });

  it("normaliseVariant rejects out-of-bounds bbox", () => {
    const v = visionTestables.normaliseVariant(
      { name: "x", axis: "outfit", bbox: [0, 0, 600, 100], description: "d" },
      500,
      500,
    );
    expect(v).toBeNull();
  });

  it("normaliseVariant rejects unknown axis", () => {
    const v = visionTestables.normaliseVariant(
      { name: "x", axis: "weather", bbox: [0, 0, 10, 10], description: "d" },
      500,
      500,
    );
    expect(v).toBeNull();
  });

  it("dedupeVariantNames suffixes collisions in order", () => {
    const out = visionTestables.dedupeVariantNames([
      { name: "outfit", axis: "outfit", bbox: [0, 0, 1, 1], description: "a" },
      { name: "outfit", axis: "outfit", bbox: [0, 0, 1, 1], description: "b" },
      { name: "other", axis: "outfit", bbox: [0, 0, 1, 1], description: "c" },
      { name: "outfit", axis: "outfit", bbox: [0, 0, 1, 1], description: "d" },
    ]);
    expect(out.map((v) => v.name)).toEqual(["outfit", "outfit-2", "other", "outfit-3"]);
  });
});

