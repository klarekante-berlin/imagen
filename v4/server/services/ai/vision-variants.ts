import type {
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { Asset } from "../../../drizzle/schema";
import { ASSET_VARIANT_KINDS, type AssetVariantKind } from "../../../shared/types/enums";
import { storageRead } from "../storage";
import { DEFAULT_MODEL, getClaude } from "./claude";

export type VariantBboxNormalized = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractedVariant = {
  kind: AssetVariantKind;
  name: string;
  bbox: VariantBboxNormalized;
  description?: string;
  pose?: string;
  outfit?: string;
  expression?: string;
  tags?: string[];
};

export type ExtractVariantsResult = {
  variants: ExtractedVariant[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

const EXTRACT_TOOL: Tool = {
  name: "extract_variants",
  description:
    "Identify discrete sub-views on a character sheet (separate poses, outfit changes, expressions, named crops) and return one entry per sub-view with a tight normalized bounding box.",
  input_schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ASSET_VARIANT_KINDS as unknown as string[],
              description:
                "pose = same outfit, different body posture/angle; outfit = same person, different clothing; expression = closeup with a clear emotional shift; crop = useful detail (hands, props, face) worth indexing separately; other = anything else useful.",
            },
            name: {
              type: "string",
              description:
                "Short label — 'frontal standing', 'three-quarter back', 'sad face', 'red coat'. Lowercased phrase, ≤30 chars.",
            },
            bbox: {
              type: "object",
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                width: { type: "number", minimum: 0, maximum: 1 },
                height: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["x", "y", "width", "height"],
              description:
                "Tight box around the variant, normalized 0–1 with (0,0) at the top-left of the image. Pad about 3% on each side so the crop doesn't clip; never exceed 1.",
            },
            description: {
              type: "string",
              description:
                "1 sentence concrete description of this sub-view, like the asset's visualDescription but variant-scoped.",
            },
            pose: { type: "string" },
            outfit: { type: "string" },
            expression: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "0–6 short tags specific to this variant.",
            },
          },
          required: ["kind", "name", "bbox"],
        },
      },
    },
    required: ["variants"],
  },
};

const SYSTEM_PROMPT = `You extract sub-variants from character sheets for a
visual storytelling RAG. A sheet is one image containing several discrete views
of the same subject (poses, outfits, expressions). Return ONE entry per
distinct view that would be useful as a reference image by itself.

Rules
- Only call extract_variants. Never return free prose.
- Skip the sheet itself — only return SUB-regions. If the sheet has just one
  view (single portrait, no grid), return an empty array.
- Bounding boxes are normalized 0–1 with origin top-left. Always tight around
  the subject, padded ~3%. Never go outside [0,1].
- Pick the kind that best fits: pose, outfit, expression, crop, or other.
- Names are short, lowercase, descriptive: 'frontal standing', 'three-quarter
  walking', 'angry face'. Avoid generic '1', 'a', 'left'.
- Limit to at most 12 variants per sheet — pick the most distinctive.`;

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

export async function extractVariants(
  asset: Asset,
  model?: string,
): Promise<ExtractVariantsResult> {
  const block = await buildImageBlock(asset);
  if (!block) throw new Error(`Could not load image for asset ${asset.id}`);

  const system: TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  const content: ContentBlockParam[] = [
    block,
    {
      type: "text",
      text: `Sheet name: "${asset.name}". Find the distinct sub-views worth indexing as their own references.`,
    },
  ];

  const client = getClaude();
  const response = await client.messages.create({
    model: model ?? DEFAULT_MODEL,
    max_tokens: 2500,
    system,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_variants" },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return extract_variants.");
  }
  const data = toolUse.input as { variants?: ExtractedVariant[] };
  const variants = (data.variants ?? []).filter((v) => {
    const b = v.bbox;
    return (
      b &&
      b.width > 0.02 &&
      b.height > 0.02 &&
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.width <= 1.001 &&
      b.y + b.height <= 1.001
    );
  });

  return {
    variants,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
