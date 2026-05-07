import Anthropic from "@anthropic-ai/sdk";
import type { Asset, AiModel, ImageFormat, Character } from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  ConsistencyContext,
  ConsistencyCharacterRef,
  Scene,
  SlideContent,
  normalizeConsistencyContext,
} from "./storyService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanInput {
  theme: string;
  model: AiModel;
  characterLibrary: Pick<Character, "id" | "name" | "aliases" | "kind" | "defaultDescription">[];
  assetCatalog: Asset[];
}

export interface DetectedEntity {
  name: string;
  type: "character" | "object" | "place";
  matchedCharacterId?: number;
  matchedAssetIds: number[];
  needsWorldBuilding: boolean;
  draftVisualDescription?: string;
}

export interface StoryPlan {
  title: string;
  suggestedSlideCount: number;     // 3..10
  reasoning: string;
  scenes: Scene[];                 // covers [1..suggestedSlideCount] without gaps
  detectedEntities: DetectedEntity[];
}

export interface WriteInput {
  theme: string;
  plan: StoryPlan;
  resolvedCharacters: ConsistencyCharacterRef[];
  styleReferenceUrls?: string[];
  model: AiModel;
  imageFormat: ImageFormat;
}

// ─── Anthropic helpers ────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = ENV.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

async function callClaudeWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  label: string,
): Promise<Anthropic.Message> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const overloaded =
        lastError.message.includes("529") ||
        lastError.message.toLowerCase().includes("overloaded");
      if (!overloaded || attempt === 4) throw lastError;
      const delay = Math.pow(2, attempt) * 5000;
      console.log(`[${label}] overloaded, retry ${attempt}/4 in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── scoreCharacterMatches ────────────────────────────────────────────────────

/**
 * Pre-rank library characters by alias/name overlap with story text. Used to
 * narrow the set Claude sees in the planning step (cheaper + sharper matches).
 */
export function scoreCharacterMatches(
  text: string,
  library: Array<{ id: number; name: string; aliases: string[] | null }>,
): Array<{ characterId: number; score: number; matchedTokens: string[] }> {
  const lower = text.toLowerCase();
  const out: Array<{ characterId: number; score: number; matchedTokens: string[] }> = [];

  for (const c of library) {
    const matched: string[] = [];
    let score = 0;

    if (lower.includes(c.name.toLowerCase())) {
      score += 3;
      matched.push(c.name);
    }
    let aliasContrib = 0;
    for (const alias of c.aliases ?? []) {
      const a = alias.toLowerCase();
      if (a.length === 0) continue;
      if (lower.includes(a)) {
        // Multi-word aliases like "mein papa" are stronger signals.
        const weight = a.includes(" ") ? 2.5 : 1.0;
        aliasContrib += weight;
        matched.push(alias);
      }
    }
    score += Math.min(aliasContrib, 3); // cap alias contribution

    if (score > 0) {
      out.push({ characterId: c.id, score, matchedTokens: matched });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

// ─── planStory ────────────────────────────────────────────────────────────────

const PLAN_SYSTEM = `Du bist Story-Planer für Instagram-Carousels im Stil von klarekante.berlin.

DEIN STIL:
- Berliner Direktheit, satirisch trocken, Zahlen als Schockmomente
- Story-Bogen: HOOK → SETUP → ESKALATION → WENDEPUNKT → AUFLÖSUNG → CTA
- Mittlere Beats kannst du komprimieren oder erweitern je nach Komplexität

AUFGABE: Plane das Carousel BEVOR der eigentliche Slide-Text geschrieben wird.

SLIDE-COUNT (3-10):
- 3-4: kurze, einzelne Pointe, ein einziger Beat
- 5-6: klassischer Story-Bogen, ein Setting
- 7-8: mehrere Beats, evtl. Setting-Wechsel
- 9-10: längere Erzählung, mehrere Charaktere oder Locations

SCENES:
- Eine Story kann in 1-3 Scenes spielen
- Jede Scene hat eine spezifische Location die GLEICH bleibt für ihre Slides
- Wenn die Story Location wechselt: zweite Scene mit transitionToNext (Bridge-Beschreibung)

DETECTED ENTITIES:
- Identifiziere alle Personen, wichtigen Objekte und Orte die im Skript vorkommen
- Versuche jede zu existierenden characterId zu matchen (wenn klar)
- Wenn KEIN passender Character existiert: needsWorldBuilding=true mit draftVisualDescription
- Tiere als character zählen, generische Items als object/place

Antworte IMMER als valides JSON, kein Markdown.`;

const PLAN_USER_TEMPLATE = (theme: string, characterList: string, assetList: string) => `
THEMA / SKRIPT:
${theme}

VERFÜGBARE CHARAKTERE IN DER LIBRARY:
${characterList || "(noch keine in DB)"}

VERFÜGBARE ASSETS (für Items / Umgebungen / Style-Refs):
${assetList || "(keine)"}

Plane die Story. Antworte mit JSON in dieser exakten Struktur:
{
  "title": "Kurzer Carousel-Titel max 5 Wörter",
  "suggestedSlideCount": 3..10,
  "reasoning": "Kurze Begründung warum genau diese Anzahl. Z.B. 'Story funktioniert am besten als 6 Slides: 1 Hook, 2 Setup, 1 Eskalation, 1 Wendung, 1 CTA.'",
  "scenes": [
    {
      "id": "scene-1",
      "slideRange": [1, 6],
      "environment": "spezifische Location-Beschreibung in Deutsch",
      "environmentLockNotes": "was über alle Slides dieser Scene gleich bleibt (Möbel, Licht, etc.)",
      "transitionToNext": null
    }
  ],
  "detectedEntities": [
    {
      "name": "Papa",
      "type": "character",
      "matchedCharacterId": 1,
      "matchedAssetIds": [],
      "needsWorldBuilding": false,
      "draftVisualDescription": null
    }
  ]
}

REGELN:
- scenes[].slideRange muss exakt [1..suggestedSlideCount] lückenlos abdecken
- transitionToNext nur am letzten Slide einer Scene (außer der letzten Scene überhaupt)
- matchedCharacterId nur wenn ID in der Liste oben existiert
- Bei needsWorldBuilding=true MUSS draftVisualDescription gesetzt sein
- type: "character" für Personen/Tiere, "object" für Items, "place" für reine Orte

Rufe das Tool plan_story mit den entsprechenden Werten auf.`;

const PLAN_TOOL = {
  name: "plan_story",
  description: "Plane das Carousel: Slide-Count, Scenes (Locations), Detected Entities.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string" },
      suggestedSlideCount: { type: "integer", minimum: 3, maximum: 10 },
      reasoning: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            slideRange: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
            environment: { type: "string" },
            environmentLockNotes: { type: "string" },
            transitionToNext: { type: "string" },
          },
          required: ["id", "slideRange", "environment", "environmentLockNotes"],
        },
      },
      detectedEntities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["character", "object", "place"] },
            matchedCharacterId: { type: "integer" },
            matchedAssetIds: { type: "array", items: { type: "integer" } },
            needsWorldBuilding: { type: "boolean" },
            draftVisualDescription: { type: "string" },
          },
          required: ["name", "type", "matchedAssetIds", "needsWorldBuilding"],
        },
      },
    },
    required: ["title", "suggestedSlideCount", "reasoning", "scenes", "detectedEntities"],
  },
};

export async function planStory(input: PlanInput): Promise<StoryPlan> {
  const client = getAnthropicClient();

  // Pre-rank to put likely matches at the top of the list Claude sees
  const ranked = scoreCharacterMatches(
    input.theme,
    input.characterLibrary.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })),
  );
  const rankedIds = new Set(ranked.slice(0, 10).map((r) => r.characterId));
  const orderedLib = [
    ...input.characterLibrary.filter((c) => rankedIds.has(c.id)),
    ...input.characterLibrary.filter((c) => !rankedIds.has(c.id)).slice(0, 20),
  ];

  const characterList = orderedLib
    .map((c) => {
      const aliases = (c.aliases ?? []).join(", ") || "—";
      const desc = (c.defaultDescription ?? "").slice(0, 100);
      return `[id:${c.id}] ${c.name} (${c.kind}) aliases:[${aliases}] ${desc ? "— " + desc : ""}`;
    })
    .join("\n");

  const assetList = input.assetCatalog
    .filter((a) => a.category === "items" || a.category === "umgebungen" || a.category === "stil-referenz")
    .slice(0, 30)
    .map((a) => `[id:${a.id}] ${a.name} (${a.category})`)
    .join("\n");

  const claudeModel = input.model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-6";

  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 4000,
      system: PLAN_SYSTEM,
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: "plan_story" },
      messages: [{ role: "user", content: PLAN_USER_TEMPLATE(input.theme, characterList, assetList) }],
    },
    "planStory",
  );

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("planStory: no tool_use block in response");

  const raw = toolUse.input as StoryPlan;
  const parsed: StoryPlan = {
    title: raw.title,
    suggestedSlideCount: raw.suggestedSlideCount,
    reasoning: raw.reasoning,
    scenes: raw.scenes.map((s) => ({
      ...s,
      slideRange: [s.slideRange[0], s.slideRange[1]] as [number, number],
    })),
    detectedEntities: raw.detectedEntities ?? [],
  };

  validatePlan(parsed);
  return parsed;
}

function validatePlan(plan: StoryPlan): void {
  if (!plan.title || typeof plan.title !== "string") throw new Error("plan: missing title");
  const count = plan.suggestedSlideCount;
  if (!Number.isInteger(count) || count < 3 || count > 10) {
    throw new Error(`plan: suggestedSlideCount must be 3-10, got ${count}`);
  }
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new Error("plan: scenes must be non-empty");
  }

  // scenes must cover [1..count] contiguously
  const sorted = [...plan.scenes].sort((a, b) => a.slideRange[0] - b.slideRange[0]);
  let expected = 1;
  for (const s of sorted) {
    if (!Array.isArray(s.slideRange) || s.slideRange.length !== 2) {
      throw new Error(`plan: invalid slideRange in scene ${s.id}`);
    }
    if (s.slideRange[0] !== expected) {
      throw new Error(
        `plan: scene ${s.id} starts at ${s.slideRange[0]}, expected ${expected}`,
      );
    }
    if (s.slideRange[1] < s.slideRange[0]) {
      throw new Error(`plan: scene ${s.id} has end < start`);
    }
    expected = s.slideRange[1] + 1;
  }
  if (expected - 1 !== count) {
    throw new Error(
      `plan: scenes cover ${expected - 1} slides, expected ${count}`,
    );
  }
  if (!Array.isArray(plan.detectedEntities)) {
    throw new Error("plan: detectedEntities must be an array");
  }
}

// ─── writeStorySlides ─────────────────────────────────────────────────────────

const WRITE_SYSTEM = `Du bist Story-Texter für Instagram-Carousels im Stil von klarekante.berlin.

DEIN STIL:
- Berliner Direktheit, satirisch trocken (Ricky Gervais mit Herz)
- Zahlen als Schockmomente ("41 FUCKING PROZENT!")
- Persönliche Anekdoten als emotionale Auflösung
- textContent ist Text der DIREKT IM BILD erscheint, max 2-3 kurze Sätze

KONSISTENZ:
- Du bekommst einen Plan mit FEST DEFINIERTEN scenes und Charakteren — verwende sie
- Pro Slide gibt es eine sceneId — der image-Generator nutzt das Setting aus dem Plan
- Outfits/Visuals der Charaktere bleiben in allen Slides identisch (siehe character-Liste)
- Der Bildstil ist 3D-Cartoon-Render im Pixar/Mitchell-Stil

TEXT-OVERLAY:
- textContent muss auch ohne Bild verständlich sein
- imagePrompt MUSS textContent als großen Text-Overlay im Bild enthalten

Antworte IMMER als valides JSON, kein Markdown.`;

const WRITE_USER_TEMPLATE = (
  theme: string,
  plan: StoryPlan,
  characters: ConsistencyCharacterRef[],
  imageFormat: ImageFormat,
) => `
THEMA: ${theme}

PLAN:
- title: "${plan.title}"
- suggestedSlideCount: ${plan.suggestedSlideCount}
- reasoning: ${plan.reasoning}

SCENES (FEST):
${plan.scenes
  .map(
    (s) =>
      `- ${s.id} slides ${s.slideRange[0]}-${s.slideRange[1]}: ${s.environment}${s.transitionToNext ? ` → next: ${s.transitionToNext}` : ""}`,
  )
  .join("\n")}

CHARAKTERE (FEST):
${characters
  .map((c) => `- "${c.name}" (assetId:${c.assetId}) outfit: ${c.outfit} | ${c.visualDescription}`)
  .join("\n") || "(keine — Charaktere im imagePrompt selbst beschreiben)"}

Bildformat: ${imageFormat === "1:1" ? "quadratisch 1080x1080px" : "Hochformat 1080x1350px"}

Erstelle EXAKT ${plan.suggestedSlideCount} Slides und rufe das Tool write_story_slides auf.

REGELN:
- EXAKT ${plan.suggestedSlideCount} Slides
- Jeder Slide hat sceneId aus dem Plan (anhand slideRange zuordnen)
- imagePrompt MUSS Outfit-Details der vorkommenden Charaktere enthalten
- imagePrompt MUSS textContent als Text-Overlay-Anweisung enthalten`;

const WRITE_TOOL = {
  name: "write_story_slides",
  description: "Schreibe die Slide-Texte und den Image-Prompt für jeden Slide basierend auf dem bestätigten Plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      consistencyContext: {
        type: "object",
        properties: {
          artStyle: { type: "string" },
          colorPalette: { type: "string" },
          globalStylePrompt: { type: "string" },
        },
        required: ["artStyle", "colorPalette", "globalStylePrompt"],
      },
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slideNumber: { type: "integer" },
            sceneId: { type: "string" },
            textContent: { type: "string" },
            caption: { type: "string" },
            charactersInSlide: { type: "array", items: { type: "string" } },
            imagePrompt: { type: "string" },
          },
          required: ["slideNumber", "sceneId", "textContent", "caption", "charactersInSlide", "imagePrompt"],
        },
      },
    },
    required: ["consistencyContext", "slides"],
  },
};

export async function writeStorySlides(input: WriteInput): Promise<{
  consistencyContext: ConsistencyContext;
  slides: SlideContent[];
}> {
  const client = getAnthropicClient();
  const claudeModel = input.model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-6";

  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 8000,
      system: WRITE_SYSTEM,
      tools: [WRITE_TOOL],
      tool_choice: { type: "tool", name: "write_story_slides" },
      messages: [
        {
          role: "user",
          content: WRITE_USER_TEMPLATE(input.theme, input.plan, input.resolvedCharacters, input.imageFormat),
        },
      ],
    },
    "writeStorySlides",
  );

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("writeStorySlides: no tool_use block in response");

  const parsed = toolUse.input as {
    consistencyContext: { artStyle: string; colorPalette: string; globalStylePrompt: string };
    slides: SlideContent[];
  };

  if (!Array.isArray(parsed.slides) || parsed.slides.length !== input.plan.suggestedSlideCount) {
    throw new Error(
      `writeStorySlides: got ${parsed.slides?.length ?? 0} slides, expected ${input.plan.suggestedSlideCount}`,
    );
  }

  // Each slide must reference a real scene
  const sceneIds = new Set(input.plan.scenes.map((s) => s.id));
  for (const s of parsed.slides) {
    if (s.sceneId && !sceneIds.has(s.sceneId)) {
      throw new Error(`slide ${s.slideNumber}: unknown sceneId ${s.sceneId}`);
    }
  }

  // Assemble v2 ConsistencyContext from the plan + writer output
  const consistencyContext: ConsistencyContext = {
    version: 2,
    artStyle: parsed.consistencyContext.artStyle,
    colorPalette: parsed.consistencyContext.colorPalette,
    scenes: input.plan.scenes,
    characters: input.resolvedCharacters,
    globalStylePrompt: parsed.consistencyContext.globalStylePrompt,
    styleReferenceUrls: input.styleReferenceUrls ?? [],
    worldBuiltAssetIds: input.resolvedCharacters
      .filter((c) => c.worldBuilt && c.assetId > 0)
      .map((c) => c.assetId),
    slideCount: input.plan.suggestedSlideCount,
  };

  // Defensive: some legacy callers might pass v1-style; normalize again as identity
  const normalized = normalizeConsistencyContext(consistencyContext);
  if (!normalized) throw new Error("Failed to normalize newly-built consistency context");

  return { consistencyContext: normalized, slides: parsed.slides };
}
