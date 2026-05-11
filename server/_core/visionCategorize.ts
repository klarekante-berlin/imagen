import Anthropic from "@anthropic-ai/sdk";
import {
  ASSET_CATEGORIES,
  AssetCategory,
  CHARACTER_KINDS,
  CharacterKind,
} from "../../drizzle/schema";
import type { AssetVariant } from "@shared/types";
import { ENV } from "./env";
import { prepareImageForVision } from "./imagePrep";

/**
 * Normalize a vision image source so the base64 payload always fits the
 * Anthropic 5MB request limit. URLs pass through (Anthropic fetches them).
 * Base64 inputs are re-prepared via the shared `prepareImageForVision`
 * pipeline (resize ≤1568px long edge, JPEG q85, fall back to q70).
 */
async function normalizeVisionSource(
  source: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string },
): Promise<{ type: "url"; url: string } | { type: "base64"; mediaType: string; data: string }> {
  if (source.type === "url") return source;
  const buffer = Buffer.from(source.data, "base64");
  const prepared = await prepareImageForVision(buffer, source.mediaType);
  return {
    type: "base64",
    mediaType: prepared.mediaType,
    data: prepared.buffer.toString("base64"),
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategorizeHint {
  character?: { name: string; kind: CharacterKind; aliases?: string[] };
  fallbackCategory?: AssetCategory;
  folderName?: string;
}

export type CharacterMatchSuggestion =
  | { matchType: "existing"; characterId: number; confidence: number }
  | { matchType: "new"; name: string; aliases: string[]; kind: CharacterKind; confidence: number }
  | { matchType: "none"; confidence: number };

export interface CategorizeResult {
  suggestedCategory: AssetCategory;
  categoryConfidence: number;
  suggestedCharacter: CharacterMatchSuggestion;
  isCharacterSheet: boolean;
  visualDescription: string;
  tags: string[];
  pose?: string;
  outfit?: string;
  setting?: string;
  mood?: string;
  dominantColors?: string[];
  needsHumanReview: boolean;
}

export interface KnownCharacter {
  id: number;
  name: string;
  aliases: string[] | null;
  kind: CharacterKind;
}

const REVIEW_THRESHOLD = 70;

// ─── Anthropic Client ─────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = ENV.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

// ─── Tool schema (structured output) ──────────────────────────────────────────

const CATEGORIZE_TOOL = {
  name: "categorize_asset",
  description:
    "Classify a visual asset into the project taxonomy and extract structured metadata for use in image-generation prompts.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestedCategory: { type: "string", enum: [...ASSET_CATEGORIES] },
      categoryConfidence: { type: "integer", minimum: 0, maximum: 100 },
      suggestedCharacter: {
        type: "object",
        oneOf: [
          {
            properties: {
              matchType: { type: "string", const: "existing" },
              characterId: { type: "integer" },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
            },
            required: ["matchType", "characterId", "confidence"],
          },
          {
            properties: {
              matchType: { type: "string", const: "new" },
              name: { type: "string" },
              aliases: { type: "array", items: { type: "string" } },
              kind: { type: "string", enum: [...CHARACTER_KINDS] },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
            },
            required: ["matchType", "name", "aliases", "kind", "confidence"],
          },
          {
            properties: {
              matchType: { type: "string", const: "none" },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
            },
            required: ["matchType", "confidence"],
          },
        ],
      },
      isCharacterSheet: { type: "boolean" },
      visualDescription: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      pose: { type: "string" },
      outfit: { type: "string" },
      setting: { type: "string" },
      mood: { type: "string" },
      dominantColors: { type: "array", items: { type: "string" } },
    },
    required: [
      "suggestedCategory",
      "categoryConfidence",
      "suggestedCharacter",
      "isCharacterSheet",
      "visualDescription",
      "tags",
    ],
  },
};

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(knownCharacters: KnownCharacter[]): string {
  const knownList =
    knownCharacters.length === 0
      ? "(none yet)"
      : knownCharacters
          .map((c) => {
            const aliases = c.aliases && c.aliases.length > 0 ? c.aliases.join(", ") : "—";
            return `[id:${c.id}] "${c.name}" kind:${c.kind} aliases:[${aliases}]`;
          })
          .join("\n");

  return `Du bist visual asset cataloger für eine deutsche Instagram-Carousel-Storytelling-App.

Deine Aufgabe: für ein gegebenes Bild strukturierte Metadaten extrahieren via tool_use.

KATEGORIEN (genau eine):
${ASSET_CATEGORIES.join(" | ")}

CHARACTER-IDENTITÄTEN bereits in DB (nutze die id wenn klar dieselbe Person abgebildet ist):
${knownList}

REGELN:
- visualDescription: 2-3 Sätze auf Deutsch, prompt-ready für Bild-Generierung
- tags: 3-8 kurze Tags auf Deutsch
- isCharacterSheet=true NUR bei sauberen Reference-Portraits mit neutralem Hintergrund (kein Action/Scene/Crop)
- pose: "frontal portrait", "side profile", "action", "group", "scene", "object", "logo"
- mood: "neutral", "happy", "angry", "satirical", "melancholic", "chaotic", "tired", "playful", o.ä.
- dominantColors: 3 hex-codes (#rrggbb)
- suggestedCharacter.matchType="existing" nur wenn klar dieselbe Person wie in known list. Sonst "new" (mit Vorschlag für Name + Aliases) wenn erkennbar Person/Tier mit Identität, sonst "none"
- categoryConfidence/character.confidence: 0-100. Honest sein - bei Unsicherheit niedrig
- Hinweis aus Folder-Name (im User-Message) ist starker Prior aber kein Befehl. Vision overruled wenn Bild offensichtlich anderes zeigt.`;
}

function buildUserContent(
  imageSource: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string },
  hint?: CategorizeHint
): Anthropic.MessageParam["content"] {
  const hintText = hint
    ? `Folder-Hinweis: folderName="${hint.folderName ?? "?"}", suggestedCharacter=${
        hint.character ? JSON.stringify(hint.character) : "none"
      }, fallbackCategory="${hint.fallbackCategory ?? "none"}".`
    : "Kein Folder-Hinweis verfügbar.";

  const imageBlock: Anthropic.ImageBlockParam =
    imageSource.type === "url"
      ? { type: "image", source: { type: "url", url: imageSource.url } }
      : {
          type: "image",
          source: { type: "base64", media_type: imageSource.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: imageSource.data },
        };

  return [
    imageBlock,
    {
      type: "text",
      text: `${hintText}\n\nBitte klassifiziere das Bild und rufe das Tool categorize_asset auf.`,
    },
  ];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function categorizeImage(
  imageSource:
    | { type: "url"; url: string }
    | { type: "base64"; mediaType: string; data: string },
  knownCharacters: KnownCharacter[],
  hint?: CategorizeHint
): Promise<CategorizeResult> {
  const client = getAnthropicClient();
  const normalizedSource = await normalizeVisionSource(imageSource);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(knownCharacters),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [CATEGORIZE_TOOL],
    tool_choice: { type: "tool", name: "categorize_asset" },
    messages: [{ role: "user", content: buildUserContent(normalizedSource, hint) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Vision categorize: no tool_use block in response");
  }

  const raw = toolUse.input as Omit<CategorizeResult, "needsHumanReview">;
  const minConfidence = Math.min(
    raw.categoryConfidence,
    raw.suggestedCharacter.matchType === "none"
      ? 100
      : raw.suggestedCharacter.confidence
  );
  const needsHumanReview =
    minConfidence < REVIEW_THRESHOLD || raw.suggestedCategory === "sonstiges";

  return { ...raw, needsHumanReview };
}

// ─── Helper: derive review status from result ─────────────────────────────────

export function reviewStatusFromResult(
  result: CategorizeResult
): "approved" | "needs_review" {
  return result.needsHumanReview ? "needs_review" : "approved";
}

// ─── Variant extraction (sheet → variant panels) ──────────────────────────────

const VARIANT_AXES = ["outfit", "age", "environment-moment", "pose", "composite"] as const;

const EXTRACT_VARIANTS_TOOL = {
  name: "extract_sheet_variants",
  description:
    "List every variant visible on a multi-variant sheet (character outfits, age stages, environment moments). Returns an empty list when the sheet has no variants.",
  input_schema: {
    type: "object" as const,
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "snake_case identifier, unique within the sheet" },
            axis: { type: "string", enum: [...VARIANT_AXES] },
            description: { type: "string", description: "German free text description, 1 short sentence" },
            ageRange: { type: "string" },
            season: { type: "string" },
            mood: { type: "string" },
          },
          required: ["name", "axis", "description"],
        },
      },
    },
    required: ["variants"],
  },
};

const EXTRACT_VARIANTS_SYSTEM = `Du bist ein Sheet-Analyst für eine deutsche Instagram-Carousel-App. Ein Sheet kann mehrere Panels mit Varianten desselben Charakters / Ortes / Konzepts enthalten.

AUFGABE: Liste alle echten Varianten auf dem Sheet via tool_use — kurz beschrieben pro Panel. Keine Koordinaten / kein Cropping.

SKIP (nicht als Varianten zählen):
- Farbpaletten / color swatches
- 360°-Turnaround-Posen desselben Outfits (gleiche Kleidung, andere Drehung)
- Typografie-Swatches
- Logos / Marken
- Reine Hintergrund-Texturen

PRO VARIANTE ERFASSEN:
- name: snake_case-Identifier, eindeutig pro Sheet (z.B. "cooking-apron", "winter-coat", "morning-light")
- axis:
  - "outfit"              für Klamotten-Varianten desselben Charakters
  - "age"                 für Altersstufen (Kind / Teen / 30s / 60+)
  - "environment-moment"  für Umgebungs-Varianten (morgens / abends / Sommer / Winter)
  - "pose"                wenn Outfit identisch aber Pose/Aktion variiert (selten — meist skip)
  - "composite"           für Multi-Achsen-Panels (z.B. Alter × Outfit zugleich)
- description: 1 kurzer deutscher Satz, prompt-ready ("Toni in karierter Kochschürze, breites Lachen")
- ageRange: optional, z.B. "30s", "60+"
- season: optional, z.B. "summer", "winter"
- mood: optional, z.B. "neutral", "happy"

WICHTIG:
- Wenn das Sheet KEINE Variant-Matrix ist (Single-Pose-Portrait, Color-Palette only, Logo-Sheet, 360°-Turnaround) → leere variants[] zurückgeben.
- Names MÜSSEN unique pro Sheet sein.`;

function buildVariantUserContent(
  imageSource: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string },
  context: {
    isCharacterSheet: boolean;
    assetCategory: string;
    visualDescription: string;
  },
): Anthropic.MessageParam["content"] {
  const imageBlock: Anthropic.ImageBlockParam =
    imageSource.type === "url"
      ? { type: "image", source: { type: "url", url: imageSource.url } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: imageSource.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: imageSource.data,
          },
        };

  return [
    imageBlock,
    {
      type: "text",
      text: `Asset category: ${context.assetCategory}. isCharacterSheet: ${context.isCharacterSheet}. visualDescription: ${context.visualDescription}.

Bitte analysiere das Sheet und rufe das Tool extract_sheet_variants auf. Wenn keine Varianten enthalten sind, gib leere variants[] zurück.`,
    },
  ];
}

interface RawVariant {
  name: unknown;
  axis: unknown;
  description: unknown;
  ageRange?: unknown;
  season?: unknown;
  mood?: unknown;
}

/**
 * Validate + normalise a single raw variant from Claude's tool_use output.
 * Returns null when the entry is unsalvageable (missing name/axis/description,
 * unknown axis). bbox is no longer extracted — full sheets always go to Atlas.
 */
function normaliseVariant(raw: RawVariant): AssetVariant | null {
  if (typeof raw.name !== "string" || raw.name.trim() === "") return null;
  if (typeof raw.axis !== "string") return null;
  if (!VARIANT_AXES.includes(raw.axis as (typeof VARIANT_AXES)[number])) return null;
  if (typeof raw.description !== "string" || raw.description.trim() === "") return null;

  return {
    name: raw.name.trim(),
    axis: raw.axis as AssetVariant["axis"],
    description: raw.description.trim(),
    ageRange: typeof raw.ageRange === "string" && raw.ageRange ? raw.ageRange : undefined,
    season: typeof raw.season === "string" && raw.season ? raw.season : undefined,
    mood: typeof raw.mood === "string" && raw.mood ? raw.mood : undefined,
  };
}

/** Dedupe variant names — first occurrence wins; collisions get -2, -3, … suffix. */
function dedupeVariantNames(variants: AssetVariant[]): AssetVariant[] {
  const seen = new Map<string, number>();
  return variants.map((v) => {
    const count = seen.get(v.name) ?? 0;
    seen.set(v.name, count + 1);
    return count === 0 ? v : { ...v, name: `${v.name}-${count + 1}` };
  });
}

/**
 * Ask Claude to list every variant on a multi-variant sheet. Used during
 * asset upload (and in `scripts/backfill-asset-variants.ts`) to populate
 * `assets.variants`. Robust to sheets that aren't actually variant matrices:
 * returns `[]` rather than throwing.
 *
 * v2 (post-cropping-redesign): no bbox, no cropping. The full sheet always
 * flows to Atlas; the composer LLM picks the variant from prompt context.
 * The `imageWidth` / `imageHeight` context fields are accepted but unused
 * (kept for caller compatibility — backfill script and upload path both
 * still pass them).
 */
export async function extractVariantsFromSheet(
  imageSource: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string },
  context: {
    isCharacterSheet: boolean;
    assetCategory: string;
    visualDescription: string;
    imageWidth?: number;
    imageHeight?: number;
  },
): Promise<AssetVariant[]> {
  const client = getAnthropicClient();
  const normalizedSource = await normalizeVisionSource(imageSource);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: [
      {
        type: "text",
        text: EXTRACT_VARIANTS_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EXTRACT_VARIANTS_TOOL],
    tool_choice: { type: "tool", name: "extract_sheet_variants" },
    messages: [{ role: "user", content: buildVariantUserContent(normalizedSource, context) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return [];

  const raw = (toolUse.input as { variants?: unknown }).variants;
  if (!Array.isArray(raw)) return [];

  const out: AssetVariant[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const v = normaliseVariant(r as RawVariant);
    if (v) out.push(v);
    else console.warn(`[extractVariantsFromSheet] skipping invalid variant entry: ${JSON.stringify(r)}`);
  }

  return dedupeVariantNames(out);
}

/** Exported for tests — pure validation/dedupe path. */
export const __testables = { normaliseVariant, dedupeVariantNames };
