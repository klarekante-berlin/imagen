import { describe, expect, it, vi } from "vitest";

// composeSlideAction's getAnthropicClient throws if ANTHROPIC_API_KEY is unset;
// the SDK itself is mocked below so the value isn't actually used.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key";

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { __testables as visionTestables } from "./_core/visionCategorize";
import { augmentImagePromptWithComposition } from "./storyService";
import { composeSlideAction } from "./storyPlanner";
import type { ComposeSlideActionResult } from "./storyPlanner";
import { cosine } from "./_core/voyage";

// Stub the Anthropic SDK so `composeSlideAction` (the only test that hits it
// with the real implementation) gets a deterministic tool_use response.
// Other paths that go through the SDK in this file are mocked at a higher
// level via `vi.mock("./storyPlanner", …)` / `vi.mock("./_core/visionCategorize", …)`.
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "tool_use",
            id: "tool_compose",
            name: "compose_slide_action",
            input: {
              variantsByCharacter: [
                { characterName: "Toni", variantName: "cooking-apron" },
                // hallucinated character — must be dropped by validation.
                { characterName: "Ghost", variantName: "winter-coat" },
                // hallucinated variant — must be dropped by validation.
                { characterName: "Mama", variantName: "non-existent" },
              ],
              activitiesByCharacter: [
                { characterName: "Toni", activity: "hält Grillzange, dreht Steak" },
                { characterName: "Mama", activity: "bereitet Salat vor" },
                { characterName: "Ghost", activity: "should be dropped" },
              ],
              sceneActivityNotes: "warmes Spätsommer-Sonnenlicht",
              reasoning: "test",
            },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    };
  }
  return { default: MockAnthropic };
});

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

// Keep `composeSlideAction` real (its test mocks the Anthropic SDK directly).
// Mock only the heavy planner helpers used by the router tests.
vi.mock("./storyPlanner", async () => {
  const real = await vi.importActual<typeof import("./storyPlanner")>("./storyPlanner");
  return {
    ...real,
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
  };
});

// `augmentImagePromptWithComposition` is a pure function — keep the real
// implementation alongside the mocked Atlas/storage helpers below.
vi.mock("./storyService", async () => {
  const real = await vi.importActual<typeof import("./storyService")>("./storyService");
  return {
    ...real,
    generateSlideImage: vi.fn().mockResolvedValue({ imageKey: "test/key.png", imageUrl: "/manus-storage/test/key.png" }),
    generateSlideImageFreepik: vi.fn().mockResolvedValue({ imageKey: "test/key.png", imageUrl: "/manus-storage/test/key.png" }),
    getPresignedStorageUrl: vi.fn().mockResolvedValue(null),
    normalizeConsistencyContext: vi.fn().mockImplementation((raw: unknown) => raw),
    findSceneForSlide: vi.fn().mockReturnValue(null),
    deriveSceneSlideRanges: vi.fn().mockImplementation((scenes: unknown) => scenes),
  };
});

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

describe("extractVariantsFromSheet validation", () => {
  it("normaliseVariant accepts a well-formed entry", () => {
    const v = visionTestables.normaliseVariant({
      name: "cooking-apron",
      axis: "outfit",
      description: "Schürze",
    });
    expect(v).not.toBeNull();
    expect(v?.name).toBe("cooking-apron");
    expect(v?.description).toBe("Schürze");
    // bbox is no longer extracted — should be undefined.
    expect(v?.bbox).toBeUndefined();
  });

  it("normaliseVariant rejects missing description", () => {
    const v = visionTestables.normaliseVariant({
      name: "x",
      axis: "outfit",
      description: "",
    });
    expect(v).toBeNull();
  });

  it("normaliseVariant rejects unknown axis", () => {
    const v = visionTestables.normaliseVariant({
      name: "x",
      axis: "weather",
      description: "d",
    });
    expect(v).toBeNull();
  });

  it("dedupeVariantNames suffixes collisions in order", () => {
    const out = visionTestables.dedupeVariantNames([
      { name: "outfit", axis: "outfit", description: "a" },
      { name: "outfit", axis: "outfit", description: "b" },
      { name: "other", axis: "outfit", description: "c" },
      { name: "outfit", axis: "outfit", description: "d" },
    ]);
    expect(out.map((v) => v.name)).toEqual(["outfit", "outfit-2", "other", "outfit-3"]);
  });
});

// ─── Composer ────────────────────────────────────────────────────────────────

describe("composeSlideAction", () => {
  it("returns shape with variants + activities, drops hallucinated names", async () => {
    const result = await composeSlideAction({
      slide: {
        slideNumber: 1,
        textContent: "Test",
        imagePrompt: "draft",
        charactersInSlide: ["Toni", "Mama"],
        sceneId: "scene-1",
      },
      scene: null,
      storyTheme: "Sommerfest",
      charactersWithVariants: [
        {
          name: "Toni",
          variants: [{ name: "cooking-apron", axis: "outfit", description: "Schürze" }],
        },
        {
          name: "Mama",
          variants: [{ name: "summer-dress", axis: "outfit", description: "Sommerkleid" }],
        },
      ],
      model: "claude-sonnet-4-6",
    });

    expect(result.variantsByCharacter).toEqual({ Toni: "cooking-apron" });
    expect(result.activitiesByCharacter).toEqual({
      Toni: "hält Grillzange, dreht Steak",
      Mama: "bereitet Salat vor",
    });
    expect(result.sceneActivityNotes).toBe("warmes Spätsommer-Sonnenlicht");
    expect(result.reasoning).toBe("test");
  });
});

describe("augmentImagePromptWithComposition", () => {
  it("appends character details + scene mood when both variant and activity exist", () => {
    const composition: ComposeSlideActionResult = {
      variantsByCharacter: { Toni: "cooking-apron", Mama: "summer-dress" },
      activitiesByCharacter: {
        Toni: "hält Grillzange, dreht Steak",
        Mama: "bereitet Salat in Schüssel vor",
        Lily: "sitzt auf Decke, malt mit Buntstiften",
      },
      sceneActivityNotes: "warmes Spätsommer-Sonnenlicht",
      reasoning: "",
    };
    const variantDescriptions = new Map<string, string>([
      ["Toni", "kariertes Hemd, weiße Schürze"],
      ["Mama", "leichtes Sommerkleid, Strohhut"],
    ]);

    const out = augmentImagePromptWithComposition(
      "Base prompt.",
      composition,
      ["Toni", "Mama", "Lily"],
      variantDescriptions,
    );

    expect(out).toContain("Base prompt.");
    expect(out).toContain("Character details:");
    expect(out).toContain(
      "- Toni: COOKING-APRON variant (kariertes Hemd, weiße Schürze) — hält Grillzange, dreht Steak",
    );
    expect(out).toContain(
      "- Mama: SUMMER-DRESS variant (leichtes Sommerkleid, Strohhut) — bereitet Salat in Schüssel vor",
    );
    expect(out).toContain("- Lily — sitzt auf Decke, malt mit Buntstiften");
    expect(out).toContain("Scene mood: warmes Spätsommer-Sonnenlicht");
  });

  it("returns base prompt unchanged when nothing to add", () => {
    const composition: ComposeSlideActionResult = {
      variantsByCharacter: {},
      activitiesByCharacter: {},
      reasoning: "",
    };
    const out = augmentImagePromptWithComposition("Just the base.", composition, ["Toni"], new Map());
    expect(out).toBe("Just the base.");
  });
});

// ─── Voyage cosine ───────────────────────────────────────────────────────────

describe("voyage.cosine", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosine([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it("is scale-invariant", () => {
    expect(cosine([1, 1, 1], [2, 2, 2])).toBeCloseTo(1, 10);
  });

  it("returns 0 on zero-norm input (no NaN)", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it("uses min length when arrays differ in size", () => {
    // Truncates [1,1,1,99] to [1,1,1] — score should match identical [1,1,1].
    expect(cosine([1, 1, 1, 99], [1, 1, 1])).toBeCloseTo(1, 10);
  });
});

