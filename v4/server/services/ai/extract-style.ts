import type {
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { Asset } from "../../../drizzle/schema";
import { storageRead } from "../storage";
import { DEFAULT_MODEL, getClaude } from "./claude";

export type StyleAnchor = {
  artStyle: string;
  colorPalette: string[];
  typography?: string;
  lineWork?: string;
  composition?: string;
  mood?: string;
  /** One-paragraph distilled style anchor that's safe to prepend to a prompt. */
  summary: string;
};

export type ExtractStyleResult = {
  structured: StyleAnchor;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
};

const EXTRACT_TOOL: Tool = {
  name: "report_style",
  description:
    "Distill the shared visual style of the reference images into a structured spec plus a one-paragraph summary that can be reused as a prompt prefix.",
  input_schema: {
    type: "object",
    properties: {
      artStyle: {
        type: "string",
        description:
          "Concrete render style: e.g. 'flat editorial illustration, paper grain, hand-drawn outline'. Avoid generic words.",
      },
      colorPalette: {
        type: "array",
        items: { type: "string" },
        description:
          "2–5 dominant colors with role context, e.g. 'warm gold (subject)', 'deep navy (background)'.",
      },
      typography: {
        type: "string",
        description:
          "If the references include typography or in-image text, describe the type treatment: weight, casing, color, highlight bars, line breaks, placement.",
      },
      lineWork: {
        type: "string",
        description:
          "Line weight, contour style, hand-drawn vs vector vs painterly.",
      },
      composition: {
        type: "string",
        description:
          "Framing tendencies: subject placement, negative space, perspective, scale conventions.",
      },
      mood: {
        type: "string",
        description: "Emotional register the style projects.",
      },
      summary: {
        type: "string",
        description:
          "ONE paragraph (≤ 60 words) capturing all of the above. This goes verbatim at the top of every frame prompt, so write it as instructions to an image model — concrete nouns, no meta-talk.",
      },
    },
    required: ["artStyle", "colorPalette", "summary"],
  },
};

const SYSTEM_PROMPT = `You are a visual style analyst. Given a set of reference images, your job is to articulate the SHARED visual style they convey, so an image model can replicate it consistently.

Rules
- Treat the images as a single style brief. Find what's common across them, not their individual subject matter.
- Do NOT describe the subjects (characters, environments, scenes). Only describe the rendering style, color treatment, line work, typography, composition tendencies.
- The summary you return will be prepended to every frame prompt downstream — write it as an instruction, not a description.
- If references disagree on a dimension (e.g. line weight), pick the dominant one and ignore the outlier.
- Avoid vague adjectives ("beautiful", "stylish"). Use concrete render terms ("flat duotone", "paper-grain texture", "thick hand-drawn outline").
- Always call the report_style tool. Never return free prose.`;

async function buildImageBlock(asset: Asset): Promise<ImageBlockParam | null> {
  if (asset.imageUrl.startsWith("http") && !asset.imageUrl.startsWith("http://localhost")) {
    return {
      type: "image",
      source: { type: "url", url: asset.imageUrl },
    };
  }
  // Local — read bytes and inline as base64.
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

export type ExtractStyleInput = {
  assets: Asset[];
  model?: string;
};

export async function extractStyleFromReferences(
  input: ExtractStyleInput,
): Promise<ExtractStyleResult> {
  if (input.assets.length === 0) {
    throw new Error("No reference assets provided.");
  }

  const client = getClaude();
  const limited = input.assets.slice(0, 10);

  // Build image blocks + an instruction tail in one user message.
  const content: ContentBlockParam[] = [];
  for (const a of limited) {
    const block = await buildImageBlock(a);
    if (block) content.push(block);
  }
  if (content.length === 0) {
    throw new Error("No reference images could be loaded.");
  }
  content.push({
    type: "text",
    text: `Analyse the ${content.length} reference image${content.length === 1 ? "" : "s"} above. Identify the shared visual register and call report_style. Remember: describe the STYLE, not the subjects.`,
  });

  const system: TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  const response = await client.messages.create({
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: 1200,
    system,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "report_style" },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return report_style.");
  }
  const structured = toolUse.input as StyleAnchor;
  if (!structured.summary?.trim()) {
    throw new Error("Style extraction missing summary.");
  }

  return {
    structured,
    text: structured.summary.trim(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    },
  };
}
