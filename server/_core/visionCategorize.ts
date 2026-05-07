import Anthropic from "@anthropic-ai/sdk";
import {
  ASSET_CATEGORIES,
  AssetCategory,
  CHARACTER_KINDS,
  CharacterKind,
} from "../../drizzle/schema";
import { ENV } from "./env";

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
    messages: [{ role: "user", content: buildUserContent(imageSource, hint) }],
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
