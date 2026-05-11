import type {
  ContentBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  Asset,
  Character,
  Project,
  Story,
  Template,
  World,
} from "../../../drizzle/schema";
import type { PromptKey } from "../../../shared/types/enums";
import { DEFAULT_MODEL, getClaude } from "./claude";

export type SplitFrame = {
  textOverlay?: string;
  caption?: string;
  imagePrompt: string;
};

export type SplitScene = {
  title: string;
  environment: string;
  environmentLockNotes?: string;
  transitionToNext?: string;
  characters: string[];
  frames: SplitFrame[];
};

export type SplitResult = {
  scenes: SplitScene[];
  reasoning: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
};

const SPLIT_TOOL: Tool = {
  name: "split_content",
  description:
    "Break the user-supplied source text into scenes and frames for a visual storytelling pipeline.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description: "One short paragraph explaining the chosen scene boundaries.",
      },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short scene label, max 6 words.",
            },
            environment: {
              type: "string",
              description: "Where the scene takes place — concrete visual location.",
            },
            environmentLockNotes: {
              type: "string",
              description:
                "What stays consistent across this scene's frames (lighting, props, framing).",
            },
            transitionToNext: {
              type: "string",
              description:
                "How the next scene is reached. Omit for the last scene.",
            },
            characters: {
              type: "array",
              items: { type: "string" },
              description:
                "Names of characters present in this scene, as they appear in the source.",
            },
            frames: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  textOverlay: {
                    type: "string",
                    description:
                      "Short on-image text. Max 12 words. Omit for kinds that don't use overlays.",
                  },
                  caption: {
                    type: "string",
                    description: "Off-image text (alt / longer caption).",
                  },
                  imagePrompt: {
                    type: "string",
                    description:
                      "One paragraph describing the image: subjects, action, mood, framing.",
                  },
                },
                required: ["imagePrompt"],
              },
            },
          },
          required: ["title", "environment", "characters", "frames"],
        },
      },
    },
    required: ["reasoning", "scenes"],
  },
};

const DEFAULT_SYSTEM = `You are a visual storyboard planner.

Input: a script or text the user pasted into a story.
Output: a structured list of SCENES, each containing FRAMES, returned via the
"split_content" tool.

Rules
- Scene boundaries follow narrative beats and location changes — not paragraph
  breaks. Aim for 3–10 scenes for most stories.
- Each scene has a concrete environment (where it happens) and a lock-notes
  field (what stays consistent across the scene's frames).
- Frames within a scene depict moments. Choose granularity based on the
  story kind:
    - "story" / "reel": 1–3 frames per scene
    - "book": 1 frame per scene (one illustration per page)
    - "single": exactly 1 frame total
- For each frame: write a concrete imagePrompt (one short paragraph). If the
  format uses on-image text, add a punchy textOverlay (≤12 words).
- Identify the characters the source text actually names; do not invent new
  ones. List only individuals, not group nouns ("die Eltern", "Familie").
- Respect the project's plan/style prompts in the system message — they
  define voice and visual register.
- Keep transitions tight: transitionToNext describes how we arrive at the
  next scene. Omit for the final scene.

Always call the split_content tool. Do not return free prose.`;

function buildSystemBlocks(
  story: Story,
  project: Project | undefined,
  template: Template | undefined,
  prompts: Partial<Record<PromptKey, string>>,
): TextBlockParam[] {
  const blocks: TextBlockParam[] = [
    {
      type: "text",
      text: DEFAULT_SYSTEM,
      cache_control: { type: "ephemeral" },
    },
  ];

  const projectContext: string[] = [];
  if (template) {
    projectContext.push(`Template: ${template.name} (${template.kind})`);
    projectContext.push(
      `Format: ${template.defaultsJson.imageFormat}, frame count ${template.defaultsJson.frameCountMin}–${template.defaultsJson.frameCountMax}, transparency ${template.defaultsJson.transparency}`,
    );
  }
  if (project?.name) projectContext.push(`Project: ${project.name}`);
  projectContext.push(`Story kind: ${story.kind}`);

  if (projectContext.length > 0) {
    blocks.push({
      type: "text",
      text: `Project context\n${projectContext.join("\n")}`,
      cache_control: { type: "ephemeral" },
    });
  }

  const promptParts: string[] = [];
  if (prompts.plan) promptParts.push(`PLAN instructions\n${prompts.plan}`);
  if (prompts.style) promptParts.push(`STYLE instructions\n${prompts.style}`);
  if (prompts.write) promptParts.push(`WRITE instructions\n${prompts.write}`);
  if (promptParts.length > 0) {
    blocks.push({
      type: "text",
      text: promptParts.join("\n\n"),
      cache_control: { type: "ephemeral" },
    });
  }

  return blocks;
}

export type SplitInput = {
  story: Story;
  project?: Project;
  template?: Template;
  prompts: Partial<Record<PromptKey, string>>;
  sourceText: string;
  attachedWorlds?: World[];
  attachedCharacters?: Character[];
  attachedStyleAssets?: Asset[];
  model?: string;
};

function formatCharacter(c: Character): string {
  const aliases = (c.aliasesJson ?? []).join(", ");
  const desc = c.description?.trim();
  const parts: string[] = [`- ${c.name}`];
  if (aliases) parts.push(`(aliases: ${aliases})`);
  if (desc) parts.push(`— ${desc.slice(0, 200)}`);
  return parts.join(" ");
}

function formatAsset(a: Asset): string {
  const desc = a.visualDescription?.trim();
  return `- ${a.name} [${a.kind}]${desc ? ` — ${desc.slice(0, 160)}` : ""}`;
}

function buildAttachmentContext(input: SplitInput): string | null {
  const lines: string[] = [];
  if (input.attachedWorlds && input.attachedWorlds.length > 0) {
    lines.push("Worlds attached to this story");
    for (const w of input.attachedWorlds) {
      lines.push(`- ${w.name}${w.description ? ` — ${w.description.slice(0, 200)}` : ""}`);
    }
    lines.push("");
  }
  if (input.attachedCharacters && input.attachedCharacters.length > 0) {
    lines.push("Named characters available (use exact names in scene.characters[]; only invent new ones if the script references someone not listed):");
    for (const c of input.attachedCharacters) lines.push(formatCharacter(c));
    lines.push("");
  }
  if (input.attachedStyleAssets && input.attachedStyleAssets.length > 0) {
    lines.push("Style references attached (typography, palette, layout hints — apply their register without naming them in the output):");
    for (const a of input.attachedStyleAssets) lines.push(formatAsset(a));
    lines.push("");
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export async function splitContent(input: SplitInput): Promise<SplitResult> {
  if (!input.sourceText.trim()) {
    throw new Error("sourceText is empty — paste a script first.");
  }

  const client = getClaude();
  const system = buildSystemBlocks(
    input.story,
    input.project,
    input.template,
    input.prompts,
  );

  const attachmentContext = buildAttachmentContext(input);
  const userBlocks: ContentBlockParam[] = [];
  if (attachmentContext) {
    userBlocks.push({ type: "text", text: attachmentContext });
  }
  userBlocks.push({
    type: "text",
    text: `Story title: ${input.story.title}\nStory kind: ${input.story.kind}\n\n--- SOURCE TEXT ---\n${input.sourceText}\n--- END ---\n\nCall the split_content tool with the scenes you've extracted.`,
  });

  const response = await client.messages.create({
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: 8000,
    system,
    tools: [SPLIT_TOOL],
    tool_choice: { type: "tool", name: "split_content" },
    messages: [{ role: "user", content: userBlocks }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block");
  }

  const parsed = toolUse.input as {
    reasoning: string;
    scenes: SplitScene[];
  };

  return {
    scenes: parsed.scenes,
    reasoning: parsed.reasoning,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheCreationInputTokens:
        response.usage.cache_creation_input_tokens ?? undefined,
    },
  };
}
