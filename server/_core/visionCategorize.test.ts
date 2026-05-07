import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: mockCreate };
  }
  return { default: FakeAnthropic };
});

import { categorizeImage, reviewStatusFromResult } from "./visionCategorize";

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  mockCreate.mockReset();
});

function fakeToolResponse(input: unknown) {
  return {
    content: [
      { type: "tool_use", id: "x", name: "categorize_asset", input },
    ],
  };
}

describe("categorizeImage", () => {
  it("returns parsed result and flags low-confidence as needsHumanReview", async () => {
    mockCreate.mockResolvedValue(
      fakeToolResponse({
        suggestedCategory: "familie",
        categoryConfidence: 92,
        suggestedCharacter: {
          matchType: "new",
          name: "Papa",
          aliases: ["Vater"],
          kind: "family",
          confidence: 88,
        },
        isCharacterSheet: true,
        visualDescription: "Mann mittleren Alters",
        tags: ["familie", "papa"],
        pose: "frontal portrait",
        outfit: "Lederjacke",
        setting: "neutraler Hintergrund",
        mood: "neutral",
        dominantColors: ["#553311", "#aabbcc", "#ffffff"],
      })
    );

    const result = await categorizeImage(
      { type: "url", url: "https://example.com/x.png" },
      []
    );

    expect(result.suggestedCategory).toBe("familie");
    expect(result.suggestedCharacter.matchType).toBe("new");
    expect(result.isCharacterSheet).toBe(true);
    expect(result.needsHumanReview).toBe(false);
    expect(reviewStatusFromResult(result)).toBe("approved");
  });

  it("flags low-confidence as needs_review", async () => {
    mockCreate.mockResolvedValue(
      fakeToolResponse({
        suggestedCategory: "sonstiges",
        categoryConfidence: 40,
        suggestedCharacter: { matchType: "none", confidence: 30 },
        isCharacterSheet: false,
        visualDescription: "unklar",
        tags: [],
      })
    );

    const result = await categorizeImage(
      { type: "url", url: "https://example.com/x.png" },
      []
    );

    expect(result.needsHumanReview).toBe(true);
    expect(reviewStatusFromResult(result)).toBe("needs_review");
  });

  it("throws when no tool_use block in response", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "nope" }] });

    await expect(
      categorizeImage({ type: "url", url: "https://example.com/x.png" }, [])
    ).rejects.toThrow(/no tool_use/);
  });
});
