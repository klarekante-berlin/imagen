import "dotenv/config";

import { eq } from "drizzle-orm";
import { db } from "../server/_core/db";
import { templates, type InsertTemplate } from "./schema";

const seedTemplates: InsertTemplate[] = [
  {
    name: "Instagram Carousel",
    kind: "carousel",
    isBuiltIn: true,
    defaultsJson: {
      imageFormat: "4:5",
      frameCountMin: 6,
      frameCountMax: 10,
      transparency: "opaque",
      frameType: "slide",
      defaultPrompts: {
        plan: "Split the source text into 6–10 carousel slides. First slide is a hook, last is a CTA. Each slide gets a one-line text overlay and a short image prompt.",
        write: "Write each slide's textOverlay (max 12 words) and imagePrompt (one paragraph, concrete visual details). Keep continuity across slides.",
        style: "Klare-Kante editorial illustration: soft duotone, paper grain, hand-drawn outline, muted accent.",
        anticipate: "When a character is referenced but no sheet exists, draft a one-paragraph visual description from the story context and the project style.",
      },
    },
    uiHintsJson: { tagline: "Hook → Insights → CTA", exampleStructure: "1 hook, 4–8 insights, 1 CTA" },
  },
  {
    name: "TikTok Carousel",
    kind: "carousel",
    isBuiltIn: true,
    defaultsJson: {
      imageFormat: "9:16",
      frameCountMin: 5,
      frameCountMax: 8,
      transparency: "opaque",
      frameType: "slide",
      defaultPrompts: {
        plan: "Split into 5–8 vertical slides. Faster pacing than Instagram, bigger text, blunt voice. Hook in the first second.",
        write: "Write textOverlay (max 8 words) and imagePrompt. Use action verbs.",
        style: "Bold flat illustration, high-contrast palette, thick strokes, vertical composition.",
        anticipate: "Draft a punchy one-line visual description for missing characters.",
      },
    },
    uiHintsJson: { tagline: "Fast cuts, bold text" },
  },
  {
    name: "Book Artwork",
    kind: "book_artwork",
    isBuiltIn: true,
    defaultsJson: {
      imageFormat: "3:4",
      frameCountMin: 1,
      frameCountMax: 60,
      transparency: "full_bleed",
      frameType: "page",
      defaultPrompts: {
        plan: "Identify the printable pages in this manuscript. Each page gets one illustration that anchors the scene.",
        write: "Write a vivid imagePrompt describing the scene as a single full-bleed illustration. Avoid text overlays.",
        style: "Children's book illustration, watercolor textures, soft palette, painterly edges.",
        anticipate: "Sketch a one-paragraph description of new characters in storybook style.",
      },
    },
    uiHintsJson: { tagline: "Whole-page illustrations" },
  },
  {
    name: "Learning Slides",
    kind: "learning",
    isBuiltIn: true,
    defaultsJson: {
      imageFormat: "16:9",
      frameCountMin: 8,
      frameCountMax: 20,
      transparency: "opaque",
      frameType: "slide",
      defaultPrompts: {
        plan: "Structure as Concept → Example → Quick-check, repeating for each learning beat. 8–20 slides total.",
        write: "Each slide: short title, 2–3 lines of body, and an imagePrompt that visualises the concept literally.",
        style: "Clean infographic style, generous whitespace, single accent color, geometric icons.",
        anticipate: "Describe missing characters as friendly explainer avatars.",
      },
    },
    uiHintsJson: { tagline: "Concept → Example → Quiz" },
  },
  {
    name: "Single Illustration",
    kind: "illustration",
    isBuiltIn: true,
    defaultsJson: {
      imageFormat: "1:1",
      frameCountMin: 1,
      frameCountMax: 1,
      transparency: "alpha",
      frameType: "illustration",
      defaultPrompts: {
        plan: "Treat the entire input as one scene. Produce a single frame.",
        write: "Write one detailed imagePrompt. No text overlay.",
        style: "Painterly digital illustration, dramatic lighting, transparent background.",
        anticipate: "Describe any missing characters in one paragraph.",
      },
    },
    uiHintsJson: { tagline: "One-off image" },
  },
];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const tpl of seedTemplates) {
    const [existing] = await db
      .select()
      .from(templates)
      .where(eq(templates.name, tpl.name))
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(templates).values(tpl);
    inserted++;
  }
  console.log(`[v4 seed] templates: +${inserted}, skipped ${skipped}`);
}

main().catch((err) => {
  console.error("[v4 seed] Failed:", err);
  process.exit(1);
});
