import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import type { Asset, AiModel, ImageFormat, Character } from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  ConsistencyContext,
  ConsistencyCharacterRef,
  PROJECT_STYLE_ANCHOR,
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

DETECTED ENTITIES (KRITISCH):
- Nur INDIVIDUELLE Personen/Tiere/Objekte als character/object — niemals Gruppen-Begriffe
- "Familie", "Family", "Eltern", "Kinder", "die Klarekantes", "wir alle" sind GRUPPEN, NICHT als character listen!
  Stattdessen: einzelne family-kind Charaktere aus der Library expanden (Papa + Mama + Sohn + Tochter + Tier)
- "Wir", "ich", "uns", "ich erzähle" beziehen sich meist auf den Erzähler/Host = Toni / Papa
  → matched einen einzigen family-Character, nicht zwei
- DEDUPE: wenn zwei DB-Charaktere dieselbe Person sind (überlappende aliases wie beide "Papa"/"Vater"),
  pick NUR einen — bevorzuge den Eintrag wessen name im Skript wörtlich vorkommt
- Wenn KEIN passender Character existiert: needsWorldBuilding=true mit draftVisualDescription
- Maximal 6 detectedEntities (sonst wird das Carousel überladen)
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
- Zahlen als Schockmomente (z.B. 41 FUCKING PROZENT)
- Persönliche Anekdoten als emotionale Auflösung
- textContent ist Text der DIREKT IM BILD erscheint, max 2-3 kurze Sätze

KONSISTENZ:
- Du bekommst einen Plan mit FEST DEFINIERTEN scenes und Charakteren — verwende sie
- Pro Slide gibt es eine sceneId — der image-Generator nutzt das Setting aus dem Plan
- Outfits/Visuals der Charaktere bleiben in allen Slides identisch (siehe character-Liste)

imagePrompt FORMAT (STRENG):
imagePrompt darf NUR enthalten:
  1) was im Bild PASSIERT (Aktion, Pose, Gesichtsausdruck, Kameraperspektive)
  2) Text-Overlay-Anweisung mit dem textContent

imagePrompt darf NIEMALS enthalten:
  ❌ Render-Stil ("3D cartoon", "Pixar style", "render", "animation")
  ❌ Format-Angaben ("1080x1080", "square format", "aspect ratio")
  ❌ Charakter-Aussehen ("kahlköpfig", "blau-kariertes Hemd", "in his 40s")
       — die Refs zeigen das, das ist Server-Job
  ❌ Setting-Re-Beschreibung ("Berliner Küche am Morgen") — das prependiert der Server
  ❌ Doppelt erwähnte Charaktere die dieselbe Person sind
  ❌ Beleuchtungs-Beschreibung ("warmes goldenes Sonnenlicht") — kommt aus sceneToneNotes

GUT: "Toni sits at the kitchen table, jaw dropped, pointing aggressively at the viewer.
       Large bold text overlay above: 'Sonntagsfrühstück. Alles perfekt. Noch.'"
SCHLECHT: "3D Pixar render, 1080x1080. Berliner Küche, warmes Licht. Toni (kahlköpfig,
            bärtig, blau-kariertes Hemd) sitzt am Tisch …"

CHARAKTERE IM imagePrompt:
- Charaktere mit ✓ HAT REF → nur Name + Aktion ("Papa lacht", "Sohn rollt Augen")
- Charaktere mit ✗ keine Ref → trotzdem KURZ halten, max 5 Wörter Aussehen
  ("Mama, mid-40s in pajamas") — die volle Description ergänzt der Server

TEXT-OVERLAY:
- textContent muss auch ohne Bild verständlich sein
- imagePrompt MUSS textContent als großen Text-Overlay erwähnen
- Position: meist obere oder untere Drittel

WICHTIG ZU STRINGS:
- Verwende NIEMALS doppelte Anführungszeichen " innerhalb von String-Werten — bricht JSON
- Für Zitate/Dialoge: einfache Anführungszeichen ' oder Gedankenstriche —
- Newlines im textContent: \\n ist OK

Antworte über das tool_use API.`;

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
  .map((c) => {
    const refTag = c.referenceImageUrl ? "✓ HAT REFERENCE-IMAGE" : "✗ keine Reference";
    return `- "${c.name}" (assetId:${c.assetId}) [${refTag}] outfit: ${c.outfit || "—"} | ${c.visualDescription || "—"}`;
  })
  .join("\n") || "(keine — Charaktere im imagePrompt selbst beschreiben)"}

Bildformat: ${imageFormat === "1:1" ? "quadratisch 1080x1080px" : "Hochformat 1080x1350px"}

Erstelle EXAKT ${plan.suggestedSlideCount} Slides und rufe das Tool write_story_slides auf.

REGELN:
- EXAKT ${plan.suggestedSlideCount} Slides
- Jeder Slide hat sceneId aus dem Plan (anhand slideRange zuordnen)
- imagePrompt: Charaktere mit ✓-Tag nur kurz (Name + Aktion); Charaktere mit ✗-Tag voll beschreiben
- imagePrompt MUSS textContent als Text-Overlay-Anweisung enthalten
- imagePrompt soll keine Render-Stil-Beschreibung enthalten — der Server prependiert das`;

const WRITE_TOOL = {
  name: "write_story_slides",
  description: "Schreibe die Slide-Texte und den Image-Prompt für jeden Slide basierend auf dem bestätigten Plan. Der visuelle Render-Stil ist projektweit fest — nicht überschreiben.",
  input_schema: {
    type: "object" as const,
    properties: {
      consistencyContext: {
        type: "object",
        properties: {
          colorPalette: { type: "string", description: "Story-spezifische Farbpalette in 1 Satz." },
          sceneToneNotes: { type: "string", description: "Stimmung/Beleuchtung, ergänzend zum festen Render-Stil. 1-2 Sätze." },
        },
        required: ["colorPalette", "sceneToneNotes"],
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

  // Per-slide tool-input is dense (textContent + caption + imagePrompt). Generous budget
  // so 10-slide stories don't hit max_tokens — Anthropic returns truncated tool input
  // (slides becomes a partial string) when max_tokens trips.
  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 16000,
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

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `writeStorySlides: Claude hit max_tokens (${response.usage.output_tokens} output) — slides truncated. Increase max_tokens or shorten prompt.`,
    );
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("writeStorySlides: no tool_use block in response");

  const parsed = toolUse.input as {
    consistencyContext: { colorPalette: string; sceneToneNotes: string };
    slides: SlideContent[] | string;
  };

  // Claude sometimes serializes the slides array as a JSON string inside tool_use
  // input (especially for 8-10 slide stories). The string itself may contain
  // unescaped quotes / German typography. Use jsonrepair as fallback.
  let slides: SlideContent[];
  if (Array.isArray(parsed.slides)) {
    slides = parsed.slides;
  } else if (typeof parsed.slides === "string") {
    let parsedString: unknown;
    try {
      parsedString = JSON.parse(parsed.slides);
    } catch {
      try {
        parsedString = JSON.parse(jsonrepair(parsed.slides));
      } catch (e) {
        throw new Error(
          `writeStorySlides: slides string could not be parsed even after repair: ${(e as Error).message}`,
        );
      }
    }
    if (!Array.isArray(parsedString)) {
      throw new Error(`writeStorySlides: parsed slides string but not array: ${typeof parsedString}`);
    }
    slides = parsedString as SlideContent[];
  } else {
    throw new Error(`writeStorySlides: slides is ${typeof parsed.slides}, expected array or JSON string`);
  }
  if (slides.length !== input.plan.suggestedSlideCount) {
    throw new Error(
      `writeStorySlides: got ${slides.length} slides, expected ${input.plan.suggestedSlideCount}`,
    );
  }

  // Each slide must reference a real scene
  const sceneIds = new Set(input.plan.scenes.map((s) => s.id));
  for (const s of slides) {
    if (s.sceneId && !sceneIds.has(s.sceneId)) {
      throw new Error(`slide ${s.slideNumber}: unknown sceneId ${s.sceneId}`);
    }
  }

  // Assemble v2 ConsistencyContext. artStyle is now the project-wide anchor,
  // not Claude's invention. globalStylePrompt = anchor + per-story tone notes.
  const globalStylePrompt = `${PROJECT_STYLE_ANCHOR} Color palette: ${parsed.consistencyContext.colorPalette}. Tone: ${parsed.consistencyContext.sceneToneNotes}.`;

  const consistencyContext: ConsistencyContext = {
    version: 2,
    artStyle: PROJECT_STYLE_ANCHOR,
    colorPalette: parsed.consistencyContext.colorPalette,
    scenes: input.plan.scenes,
    characters: input.resolvedCharacters,
    globalStylePrompt,
    styleReferenceUrls: input.styleReferenceUrls ?? [],
    worldBuiltAssetIds: input.resolvedCharacters
      .filter((c) => c.worldBuilt && c.assetId > 0)
      .map((c) => c.assetId),
    slideCount: input.plan.suggestedSlideCount,
  };

  // Defensive: some legacy callers might pass v1-style; normalize again as identity
  const normalized = normalizeConsistencyContext(consistencyContext);
  if (!normalized) throw new Error("Failed to normalize newly-built consistency context");

  return { consistencyContext: normalized, slides };
}
