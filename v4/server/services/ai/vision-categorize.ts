import type {
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { Asset } from "../../../drizzle/schema";
import { ASSET_KINDS, type AssetKind } from "../../../shared/types/enums";
import { storageRead } from "../storage";
import { DEFAULT_MODEL, getClaude } from "./claude";

export type VisionCategorization = {
  suggestedKind: AssetKind;
  /** 0–100 confidence the suggested kind is right. */
  kindConfidence: number;
  visualDescription: string;
  tags: string[];
  dominantColors: string[];
  /** Only meaningful when suggestedKind === "character_sheet". */
  pose?: string;
  outfit?: string;
  /** General setting / environment if the image shows one. */
  setting?: string;
  /** Mood / register the image projects. */
  mood?: string;
  /** If the image is a character_sheet, the inferred name (e.g. read from a caption). */
  inferredCharacterName?: string;
};

export type VisionUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

const CATEGORIZE_TOOL: Tool = {
  name: "categorize_asset",
  description:
    "Describe the uploaded image and propose a kind + metadata that the storytelling pipeline can use.",
  input_schema: {
    type: "object",
    properties: {
      suggestedKind: {
        type: "string",
        enum: ASSET_KINDS.filter((k) => k !== "generated_frame") as string[],
        description:
          "Which library kind this image fits best. character_sheet for a portrait or pose grid of a single person/creature; environment for a place; style_ref for a typography or palette or rendering-style sheet (no subject); prop for an isolated item; otherwise pick the closest.",
      },
      kindConfidence: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "0–100 how confident you are about suggestedKind.",
      },
      visualDescription: {
        type: "string",
        description:
          "1–3 sentences describing what's IN the image — concrete nouns. Useful for the splitter to anchor scenes and for human browsing in the library.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "5–10 short tags (single words or 2-word phrases). Lowercase.",
      },
      dominantColors: {
        type: "array",
        items: { type: "string" },
        description:
          "2–4 dominant colors with role context — e.g. 'warm gold (subject)', 'deep navy (background)'.",
      },
      pose: {
        type: "string",
        description: "Only for character_sheet — main pose / framing of the subject.",
      },
      outfit: {
        type: "string",
        description: "Only for character_sheet — what they're wearing.",
      },
      setting: {
        type: "string",
        description: "If the image shows a place / setting, name it concretely.",
      },
      mood: {
        type: "string",
        description: "One word or short phrase — the emotional register.",
      },
      inferredCharacterName: {
        type: "string",
        description:
          "If the image contains a caption / label naming the character, return that exact name. Otherwise omit.",
      },
    },
    required: [
      "suggestedKind",
      "kindConfidence",
      "visualDescription",
      "tags",
      "dominantColors",
    ],
  },
};

const SYSTEM_PROMPT = `You are a library curator for a visual storytelling pipeline.

For each uploaded image, you produce a structured description that humans
browse and an image model consumes via reference at generate time.

Rules
- Be concrete. Concrete nouns over adjectives. "Wooden table, ceramic mug,
  warm afternoon light" beats "cozy scene".
- Keep visualDescription to 1–3 sentences. Tags 5–10. Colors 2–4.
- For character sheets (a person or recognizable creature is the subject):
  fill pose and outfit. For environment / style_ref / prop: skip pose/outfit
  and instead fill setting and mood where they apply.
- A style_ref is a sheet OF the visual register itself — typography, palette
  swatches, line-work specimens, layout systems. No real subject.
- If the image has a printed label/caption with a name on it (a character
  sheet often does), copy that into inferredCharacterName.
- Always call categorize_asset. Never return free prose.`;

async function buildImageBlock(asset: Asset): Promise<ImageBlockParam | null> {
  if (asset.imageUrl.startsWith("http") && !asset.imageUrl.startsWith("http://localhost")) {
    return { type: "image", source: { type: "url", url: asset.imageUrl } };
  }
  const file = await storageRead(asset.imageKey);
  if (!file) return null;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: file.contentType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
      data: file.buffer.toString("base64"),
    },
  };
}

export type CategorizeInput = {
  asset: Asset;
  model?: string;
};

export type CategorizeResult = {
  data: VisionCategorization;
  usage: VisionUsage;
};

export async function categorizeAsset(input: CategorizeInput): Promise<CategorizeResult> {
  const block = await buildImageBlock(input.asset);
  if (!block) {
    throw new Error(`Could not load image for asset ${input.asset.id}`);
  }

  const system: TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  const content: ContentBlockParam[] = [
    block,
    {
      type: "text",
      text: `The uploader marked this as kind="${input.asset.kind}", name="${input.asset.name}". Decide what it really is and fill the categorize_asset fields.`,
    },
  ];

  const client = getClaude();
  const response = await client.messages.create({
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: 1500,
    system,
    tools: [CATEGORIZE_TOOL],
    tool_choice: { type: "tool", name: "categorize_asset" },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return categorize_asset.");
  }
  const data = toolUse.input as VisionCategorization;
  if (!data.visualDescription?.trim()) {
    throw new Error("Vision categorization missing visualDescription.");
  }

  return {
    data,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    },
  };
}
