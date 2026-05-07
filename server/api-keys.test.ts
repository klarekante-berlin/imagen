import { describe, expect, it } from "vitest";

describe("API Key Configuration", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)(
    "OPENAI_API_KEY is configured",
    () => {
      const key = process.env.OPENAI_API_KEY;
      expect(key).toBeTruthy();
      expect(key?.startsWith("sk-")).toBe(true);
    }
  );

  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    "ANTHROPIC_API_KEY is configured",
    () => {
      const key = process.env.ANTHROPIC_API_KEY;
      expect(key).toBeTruthy();
      expect(key?.startsWith("sk-ant-")).toBe(true);
    }
  );

  it("FREEPIK_API_KEY is configured (optional)", () => {
    // Freepik is optional – just check it's a string if set
    const key = process.env.FREEPIK_API_KEY;
    if (key) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
    // Pass even if not set
    expect(true).toBe(true);
  });
});
