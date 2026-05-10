import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import type { Asset, AiModel, Character, Project, ImageFormat } from "../drizzle/schema";
import type {
  AssetVariant,
  ConsistencyCharacterRef,
  ConsistencyContext,
  DetectedEntity,
  Scene,
  SlideContent,
  StoryPlan,
} from "@shared/types";
import { ENV } from "./_core/env";
import { normalizeConsistencyContext } from "./storyService";
import { buildPlanSystemPrompt, buildPlanUserMessage, buildWriteSystemPrompt, buildWriteUserMessage } from "./promptBuilder";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanInput {
  theme: string;
  model: AiModel;
  project: Project;
  characterLibrary: Pick<Character, "id" | "name" | "aliases" | "kind" | "defaultDescription">[];
  assetCatalog: Asset[];
  /** If set, replaces PLAN_SYSTEM. Power-user override. */
  customSystemPrompt?: string;
  /** If set, prepended (with newline) before the auto-generated user template. */
  customUserPromptPrefix?: string;
}

export interface WriteInput {
  theme: string;
  plan: StoryPlan;
  resolvedCharacters: ConsistencyCharacterRef[];
  styleReferenceUrls?: string[];
  model: AiModel;
  project: Project;
  /** If set, replaces WRITE_SYSTEM. Power-user override. */
  customSystemPrompt?: string;
  /** If set, prepended (with newline) before the auto-generated user template. */
  customUserPromptPrefix?: string;
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

  const systemPrompt = input.customSystemPrompt?.trim()
    ? input.customSystemPrompt
    : buildPlanSystemPrompt(input.project);
  const userBody = buildPlanUserMessage({
    theme: input.theme,
    characterList,
    assetList,
    project: input.project,
  });
  const userContent = input.customUserPromptPrefix?.trim()
    ? `${input.customUserPromptPrefix}\n\n${userBody}`
    : userBody;

  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 4000,
      system: input.customSystemPrompt?.trim()
        ? systemPrompt
        : [
            {
              type: "text",
              text: PLAN_SYSTEM,
              cache_control: { type: "ephemeral" },
            },
          ],
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: "plan_story" },
      messages: [{ role: "user", content: userContent }],
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

SELBSTPRÜFUNG vor tool_call:
- Lese jeden imagePrompt nochmal: enthält er eine der ❌-Phrasen → korrigiere VOR Tool-Aufruf
- Lese textContent: enthält er Anweisungen die in den imagePrompt gehören (Kameraperspektive, Pose) → verschiebe sie
- Diese Selbstprüfung ist nicht optional

GUT: "Toni sits at the kitchen table, jaw dropped, pointing aggressively at the viewer.
       Text overlay shows: 'Sonntagsfrühstück. Alles perfekt. Noch.'"
SCHLECHT: "3D Pixar render, 1080x1080. Berliner Küche, warmes Licht. Toni (kahlköpfig,
            bärtig, blau-kariertes Hemd) sitzt am Tisch. Large bold white text
            in the upper third reads 'Sonntagsfrühstück'."

CHARAKTERE IM imagePrompt:
- Charaktere mit ✓ HAT REF → nur Name + Aktion ("Papa lacht", "Sohn rollt Augen")
- Charaktere mit ✗ keine Ref → trotzdem KURZ halten, max 5 Wörter Aussehen
  ("Mama, mid-40s in pajamas") — die volle Description ergänzt der Server

TEXT-OVERLAY:
- textContent muss auch ohne Bild verständlich sein
- imagePrompt MUSS erwähnen DASS textContent als Text-Overlay im Bild erscheint
- KEINE hardcoded Schrift/Farbe/Position — Typografie kommt aus den stil-referenz Assets
- Erwähne nur den Inhalt, keine "bold white", "upper third" etc — der Server delegiert das an die Refs

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

const REFLECT_SYSTEM = `Du bist ein strenger Story-Editor. Du bekommst einen Slide-Entwurf und prüfst ihn nochmal.

Prüfe in dieser Reihenfolge:
1. Charakter-Konsistenz: gleiche Person, gleicher Name in allen Slides? (Vater ≠ Papa wenn beide auf dieselbe Person zeigen)
2. Szenen-Konsistenz: jede Slide hat sceneId aus dem Plan, in der richtigen slideRange?
3. imagePrompt-Sauberkeit: keine ❌-Phrasen (3D, Pixar, 1080x1080, Charakter-Aussehen, Setting-Re-Beschreibung, "warmes Licht")?
4. textContent: max 2-3 Sätze, im Bild als Overlay verständlich?

Wenn ALLES OK: gib EXAKT denselben Slide-Array zurück.
Wenn EINE Sache nicht stimmt: korrigiere SIE und gib korrigierten Array zurück.
Erfinde NICHTS neu — nur korrigieren.`;

const REFLECT_USER = `Prüfe deinen vorigen Slide-Entwurf gegen die Regeln und rufe write_story_slides erneut auf — entweder identisch (alles OK) oder mit Korrekturen.`;

/**
 * Extract slides + consistencyContext from a write_story_slides tool_use response.
 * Claude sometimes serializes the slides array as a JSON string inside tool_use
 * input (especially for 8-10 slide stories) — jsonrepair fallback handles malformed
 * unescaped quotes / German typography. Throws on unrecoverable shape errors.
 */
function parseWriteResponse(response: Anthropic.Message): {
  consistencyContext: { colorPalette: string; sceneToneNotes: string };
  slides: SlideContent[];
} {
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("writeStorySlides: no tool_use block in response");

  const parsed = toolUse.input as {
    consistencyContext: { colorPalette: string; sceneToneNotes: string };
    slides: SlideContent[] | string;
  };

  // Item 15 investigation (SDK 0.94.0): the slides-as-string fallback exists
  // because Claude has historically returned the slides array as a JSON string
  // for long outputs (8-10 slides). Could not be conclusively reproduced in
  // isolation here without live API calls; symptom is sporadic and likely
  // tied to (a) slides imagePrompt containing un-escaped quotes around
  // German dialog and (b) high output_token pressure. Schema already types
  // slides as `array`; further tightening of `imagePrompt` (e.g. description
  // forbidding quotes) might help but risks degrading prose. Leaving fallback
  // in place — cheap insurance, no observed downside. Re-investigate if the
  // string branch never fires across N=50 generations in prod.
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

  return { consistencyContext: parsed.consistencyContext, slides };
}

export async function writeStorySlides(input: WriteInput): Promise<{
  consistencyContext: ConsistencyContext;
  slides: SlideContent[];
}> {
  const client = getAnthropicClient();
  const claudeModel = input.model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-6";

  const userBody = buildWriteUserMessage({
    theme: input.theme,
    plan: input.plan,
    resolvedCharacters: input.resolvedCharacters,
    styleReferenceUrls: input.styleReferenceUrls ?? [],
    project: input.project,
  });
  const userContent = input.customUserPromptPrefix?.trim()
    ? `${input.customUserPromptPrefix}\n\n${userBody}`
    : userBody;

  const writeSystem = input.customSystemPrompt?.trim()
    ? input.customSystemPrompt
    : buildWriteSystemPrompt(input.project);

  // Per-slide tool-input is dense. Generous budget so 10-slide stories don't hit max_tokens.
  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: writeSystem,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [WRITE_TOOL],
      tool_choice: { type: "tool", name: "write_story_slides" },
      messages: [
        {
          role: "user",
          content: userContent,
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

  const parsed = parseWriteResponse(response);
  let slides: SlideContent[] = parsed.slides;

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

  // Reflection pass: have Claude self-critique and re-emit the slides if needed.
  // Single 1-pass — no iterative loop. ~10s extra latency, sharper output.
  // If parse/validation fails, fall back to first response's slides.
  // Anthropic requires that any assistant tool_use is followed by a user
  // message containing the matching tool_result blocks.
  try {
    const firstToolUseId = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    )?.id;
    const reflectUserContent: Anthropic.MessageParam["content"] = firstToolUseId
      ? [
          { type: "tool_result", tool_use_id: firstToolUseId, content: "Slides empfangen — bitte prüfen." },
          { type: "text", text: REFLECT_USER },
        ]
      : [{ type: "text", text: REFLECT_USER }];

    const reflection = await callClaudeWithRetry(
      client,
      {
        model: claudeModel,
        max_tokens: 16000,
        system: [
          { type: "text", text: REFLECT_SYSTEM, cache_control: { type: "ephemeral" } },
        ],
        tools: [WRITE_TOOL],
        tool_choice: { type: "tool", name: "write_story_slides" },
        messages: [
          { role: "user", content: userContent },
          { role: "assistant", content: response.content },
          { role: "user", content: reflectUserContent },
        ],
      },
      "writeStorySlides.reflect",
    );
    if (reflection.stop_reason !== "max_tokens") {
      const reflected = parseWriteResponse(reflection);
      if (
        reflected.slides.length === input.plan.suggestedSlideCount &&
        reflected.slides.every((s) => !s.sceneId || sceneIds.has(s.sceneId))
      ) {
        slides = reflected.slides;
      }
    }
  } catch (e) {
    console.log(`[writeStorySlides] reflection failed, using first-pass slides: ${(e as Error).message}`);
  }

  // Assemble v2 ConsistencyContext.
  // artStyle comes from the project — no hardcoding.
  const globalStylePrompt = `Color palette: ${parsed.consistencyContext.colorPalette}. Tone: ${parsed.consistencyContext.sceneToneNotes}.`;

  const consistencyContext: ConsistencyContext = {
    version: 2,
    artStyle: input.project.globalStylePrompt,
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

// ─── rewriteSlideImagePrompt ──────────────────────────────────────────────────

export interface RewriteSlideInput {
  slide: {
    slideNumber: number;
    textContent: string;
    caption: string;
    charactersInSlide: string[];
    sceneId: string | null;
  };
  scene: Scene | null;
  characters: ConsistencyCharacterRef[];
  storyTheme: string;
  imageFormat: ImageFormat;
  model: AiModel;
}

const REWRITE_IMAGE_PROMPT_SYSTEM = `Du schreibst EINEN neuen imagePrompt für genau EINEN Slide eines Instagram-Carousels (Stil klarekante.berlin).

Der Slide existiert bereits — Text und Caption stehen fest. Du bekommst die AKTUELLE Scene (kann nach einem Reassign anders sein als beim ursprünglichen Schreiben). Aufgabe: ein frischer imagePrompt, der zu dieser Scene passt.

imagePrompt FORMAT (STRENG):
imagePrompt darf NUR enthalten:
  1) was im Bild PASSIERT (Aktion, Pose, Gesichtsausdruck, Kameraperspektive)
  2) Text-Overlay-Anweisung mit dem textContent

imagePrompt darf NIEMALS enthalten:
  ❌ Render-Stil ("3D cartoon", "Pixar style", "render", "animation")
  ❌ Format-Angaben ("1080x1080", "square format", "aspect ratio")
  ❌ Charakter-Aussehen ("kahlköpfig", "blau-kariertes Hemd", "in his 40s")
       — die Refs zeigen das, das ist Server-Job
  ❌ Setting-Re-Beschreibung — das prependiert der Server aus der Scene
  ❌ Doppelt erwähnte Charaktere die dieselbe Person sind
  ❌ Beleuchtungs-Beschreibung ("warmes goldenes Sonnenlicht") — kommt aus sceneToneNotes

CHARAKTERE IM imagePrompt:
- Charaktere mit ✓ HAT REF → nur Name + Aktion ("Papa lacht", "Sohn rollt Augen")
- Charaktere mit ✗ keine Ref → trotzdem KURZ halten, max 5 Wörter Aussehen

TEXT-OVERLAY:
- imagePrompt MUSS erwähnen DASS textContent als Text-Overlay im Bild erscheint
- KEINE hardcoded Schrift/Farbe/Position — Typografie kommt aus stil-referenz Assets
- Erwähne nur den Inhalt, keine "bold white", "upper third"

WICHTIG ZU STRINGS:
- Verwende NIEMALS doppelte Anführungszeichen " innerhalb des imagePrompt — bricht JSON
- Für Zitate/Dialoge: einfache Anführungszeichen ' oder Gedankenstriche —

Antworte über das tool_use API mit { imagePrompt: string }.`;

const REWRITE_TOOL = {
  name: "rewrite_image_prompt",
  description: "Schreibe einen neuen imagePrompt für einen einzelnen Slide gegen die aktuelle Scene.",
  input_schema: {
    type: "object" as const,
    properties: {
      imagePrompt: { type: "string" },
    },
    required: ["imagePrompt"],
  },
};

const REWRITE_USER_TEMPLATE = (input: RewriteSlideInput) => {
  const { slide, scene, characters, storyTheme, imageFormat } = input;
  const charBlock = characters.length > 0
    ? characters
        .map((c) => {
          const refTag = c.referenceImageUrl ? "✓ HAT REFERENCE-IMAGE" : "✗ keine Reference";
          return `- "${c.name}" (assetId:${c.assetId}) [${refTag}] outfit: ${c.outfit || "—"} | ${c.visualDescription || "—"}`;
        })
        .join("\n")
    : "(keine — Charaktere im imagePrompt selbst beschreiben)";

  const sceneBlock = scene
    ? `- ${scene.id} slides ${scene.slideRange[0]}-${scene.slideRange[1]}: ${scene.environment}
- Lock: ${scene.environmentLockNotes || "—"}${scene.transitionToNext ? `\n- Transition zur nächsten Scene: ${scene.transitionToNext}` : ""}`
    : "(Slide hat keine Scene-Zuordnung — beschreibe das Setting kurz im imagePrompt)";

  return `THEMA: ${storyTheme}

AKTUELLE SCENE:
${sceneBlock}

CHARAKTERE (FEST):
${charBlock}

SLIDE:
- slideNumber: ${slide.slideNumber}
- textContent: ${slide.textContent}
- caption: ${slide.caption}
- charactersInSlide: ${slide.charactersInSlide.join(", ") || "(keine)"}

Bildformat: ${imageFormat === "1:1" ? "quadratisch 1080x1080px" : "Hochformat 1080x1350px"}

Schreibe einen neuen imagePrompt für diesen Slide, der zur AKTUELLEN Scene oben passt. Rufe das Tool rewrite_image_prompt auf.`;
};

/**
 * Single-slide rewrite: produce a fresh imagePrompt against the current
 * scene/character context. Used after a slide has been reassigned to a
 * different scene or its scene's environment was edited — the original
 * imagePrompt was written against stale context.
 */
export async function rewriteSlideImagePrompt(input: RewriteSlideInput): Promise<string> {
  const client = getAnthropicClient();
  const claudeModel = input.model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-6";

  const userContent = REWRITE_USER_TEMPLATE(input);

  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: REWRITE_IMAGE_PROMPT_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [REWRITE_TOOL],
      tool_choice: { type: "tool", name: "rewrite_image_prompt" },
      messages: [{ role: "user", content: userContent }],
    },
    "rewriteSlideImagePrompt",
  );

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("rewriteSlideImagePrompt: no tool_use block in response");

  const parsed = toolUse.input as { imagePrompt?: unknown };
  if (typeof parsed.imagePrompt !== "string" || parsed.imagePrompt.trim().length === 0) {
    throw new Error("rewriteSlideImagePrompt: tool_use returned empty imagePrompt");
  }
  return parsed.imagePrompt.trim();
}

// ─── composeSlideAction ───────────────────────────────────────────────────────

/**
 * Creative composer step: per slide, decide which variant best fits each
 * character + describe what they actually do. The output is later folded
 * into `imagePrompt` (full character sheets always go to Atlas — gpt-image-2
 * picks the variant from this prompt context, no panel cropping).
 *
 * This function is the drop-in replacement for the old per-axis selectors.
 * Branch B will pass `inspirationSheets` (Voyage RAG); Branch A leaves it
 * undefined and the result still works.
 */
export interface ComposeSlideActionInput {
  slide: {
    slideNumber: number;
    textContent: string;
    imagePrompt: string;
    charactersInSlide: string[];
    sceneId: string | null;
  };
  scene: Scene | null;
  storyTheme: string;
  charactersWithVariants: Array<{ name: string; variants: AssetVariant[] }>;
  sceneVariants?: AssetVariant[];
  inspirationSheets?: Array<{ assetId: number; visualDescription: string }>;
  model: AiModel;
}

export interface ComposeSlideActionResult {
  /** characterName → variantName. Characters without a good match are omitted. */
  variantsByCharacter: Record<string, string>;
  /** characterName → 1-sentence German activity description. */
  activitiesByCharacter: Record<string, string>;
  sceneVariant?: string;
  sceneActivityNotes?: string;
  reasoning: string;
}

const COMPOSE_SYSTEM = `Du bist creative composer für eine deutsche Instagram-Carousel-App. Pro Slide entscheidest du:
1) Welche variant aus den verfügbaren Sheets passt am besten zu jedem Charakter? (oder null wenn keine passt)
2) Was MACHT jeder Charakter konkret? (Pose, Gestik, Gegenstände, Blick) — 1 SATZ DEUTSCH

REGELN:
- Pro charakter pick die passendste variant ODER null (keine variant ≠ Fehler — manchmal gibt's einfach keinen guten Treffer)
- Pro charakter beschreibe in 1 SATZ DEUTSCH was er konkret macht: pose, gestik, gegenstände, blick. Sei konkret: 'hält Grillzange, dreht Steak' nicht 'beim grillen'
- Multi-Charakter: koordiniere — wenn alle in einer Szene, sollen sie verschiedene Sachen tun (nicht alle gucken in die Kamera). Die Szene soll lebendig wirken.
- Wenn inspirationSheets gegeben sind, nutze sie als Stil-/Szenen-Hinweis für die Aktivitäten (z.B. 'Strand-Sheet zeigt jemanden mit Sandeimer → Lily spielt mit Eimer')
- sceneVariant: optional, nur setzen wenn sceneVariants[] gegeben sind und eine wirklich passt
- sceneActivityNotes: optional, 1 Satz Stimmung/Licht ergänzend zur Szenenbeschreibung — nur wenn nützlich

OUTPUT-DISZIPLIN:
- variantName MUSS exakt aus der gegebenen Liste kommen — keine Erfindungen
- characterName MUSS exakt aus der gegebenen Liste kommen
- Charaktere ohne guten variant-Treffer einfach weglassen aus variantsByCharacter (NICHT mit leerem String mappen)
- activity ist auf Deutsch, kurz, konkret, ohne Render-Stil-Beschreibung

Antworte über das tool_use API.`;

const COMPOSE_TOOL = {
  name: "compose_slide_action",
  description: "Wähle pro Charakter die passende variant + beschreibe was er konkret macht.",
  input_schema: {
    type: "object" as const,
    properties: {
      variantsByCharacter: {
        type: "array",
        items: {
          type: "object",
          properties: {
            characterName: { type: "string" },
            variantName: { type: "string" },
          },
          required: ["characterName", "variantName"],
        },
      },
      activitiesByCharacter: {
        type: "array",
        items: {
          type: "object",
          properties: {
            characterName: { type: "string" },
            activity: { type: "string" },
          },
          required: ["characterName", "activity"],
        },
      },
      sceneVariant: { type: "string" },
      sceneActivityNotes: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["variantsByCharacter", "activitiesByCharacter", "reasoning"],
  },
};

function buildComposeUserMessage(input: ComposeSlideActionInput): string {
  const { slide, scene, storyTheme, charactersWithVariants, sceneVariants, inspirationSheets } = input;

  const sceneBlock = scene
    ? `- ${scene.id} slides ${scene.slideRange[0]}-${scene.slideRange[1]}
- Environment: ${scene.environment}
- Lock: ${scene.environmentLockNotes || "—"}${scene.transitionToNext ? `\n- Transition zur nächsten Scene: ${scene.transitionToNext}` : ""}`
    : "(keine Scene-Zuordnung)";

  const charBlocks = charactersWithVariants
    .filter((c) => slide.charactersInSlide.some((n) => n.toLowerCase() === c.name.toLowerCase()))
    .map((c) => {
      if (c.variants.length === 0) {
        return `Charakter: ${c.name}\n  (keine variants verfügbar — variantsByCharacter weglassen, nur activity beschreiben)`;
      }
      const variantList = c.variants
        .map((v) => `  - ${v.name} [${v.axis}]: ${v.description}`)
        .join("\n");
      return `Charakter: ${c.name}\n${variantList}`;
    })
    .join("\n\n");

  const sceneVariantBlock =
    sceneVariants && sceneVariants.length > 0
      ? `\n\nSCENE-VARIANTS (optional zu setzen):\n${sceneVariants
          .map((v) => `  - ${v.name} [${v.axis}]: ${v.description}`)
          .join("\n")}`
      : "";

  const inspirationBlock =
    inspirationSheets && inspirationSheets.length > 0
      ? `\n\nInspiration sheets aus der Library:\n${inspirationSheets
          .map((s) => `  - asset:${s.assetId} — ${s.visualDescription}`)
          .join("\n")}`
      : "";

  return `THEMA: ${storyTheme}

SCENE:
${sceneBlock}

SLIDE ${slide.slideNumber}:
- textContent: ${slide.textContent}
- imagePrompt (aktueller Entwurf): ${slide.imagePrompt}
- charactersInSlide: ${slide.charactersInSlide.join(", ") || "(keine)"}

CHARAKTERE + verfügbare VARIANTS:
${charBlocks || "(keine Charaktere mit Variants)"}${sceneVariantBlock}${inspirationBlock}

Rufe das Tool compose_slide_action auf. Pro Charakter: passende variant (oder weglassen) + 1 Satz Aktivität.`;
}

export async function composeSlideAction(
  input: ComposeSlideActionInput,
): Promise<ComposeSlideActionResult> {
  const client = getAnthropicClient();
  const claudeModel = input.model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-6";

  const response = await callClaudeWithRetry(
    client,
    {
      model: claudeModel,
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: COMPOSE_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [COMPOSE_TOOL],
      tool_choice: { type: "tool", name: "compose_slide_action" },
      messages: [{ role: "user", content: buildComposeUserMessage(input) }],
    },
    "composeSlideAction",
  );

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("composeSlideAction: no tool_use block in response");

  const raw = toolUse.input as {
    variantsByCharacter?: Array<{ characterName?: unknown; variantName?: unknown }>;
    activitiesByCharacter?: Array<{ characterName?: unknown; activity?: unknown }>;
    sceneVariant?: unknown;
    sceneActivityNotes?: unknown;
    reasoning?: unknown;
  };

  // Defensive: build lookup sets so we can drop hallucinated names.
  const validCharacterNames = new Set(input.slide.charactersInSlide);
  const variantNamesByCharacter = new Map<string, Set<string>>();
  for (const c of input.charactersWithVariants) {
    variantNamesByCharacter.set(c.name, new Set(c.variants.map((v) => v.name)));
  }
  const validSceneVariants = new Set((input.sceneVariants ?? []).map((v) => v.name));

  const variantsByCharacter: Record<string, string> = {};
  for (const entry of raw.variantsByCharacter ?? []) {
    if (typeof entry?.characterName !== "string" || typeof entry?.variantName !== "string") continue;
    const name = entry.characterName.trim();
    const variant = entry.variantName.trim();
    if (!validCharacterNames.has(name)) continue;
    const allowed = variantNamesByCharacter.get(name);
    if (!allowed || !allowed.has(variant)) continue;
    variantsByCharacter[name] = variant;
  }

  const activitiesByCharacter: Record<string, string> = {};
  for (const entry of raw.activitiesByCharacter ?? []) {
    if (typeof entry?.characterName !== "string" || typeof entry?.activity !== "string") continue;
    const name = entry.characterName.trim();
    const activity = entry.activity.trim();
    if (!validCharacterNames.has(name) || activity.length === 0) continue;
    activitiesByCharacter[name] = activity;
  }

  const sceneVariant =
    typeof raw.sceneVariant === "string" && validSceneVariants.has(raw.sceneVariant)
      ? raw.sceneVariant
      : undefined;
  const sceneActivityNotes =
    typeof raw.sceneActivityNotes === "string" && raw.sceneActivityNotes.trim()
      ? raw.sceneActivityNotes.trim()
      : undefined;

  return {
    variantsByCharacter,
    activitiesByCharacter,
    sceneVariant,
    sceneActivityNotes,
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
  };
}
