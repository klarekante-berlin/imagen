import type {
  ContentBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  Frame,
  Project,
  Scene,
  Story,
} from "../../../drizzle/schema";
import type { PromptKey } from "../../../shared/types/enums";
import { DEFAULT_MODEL, getClaude } from "./claude";

export type FrameSuggestion = {
  textOverlay?: string;
  caption?: string;
  imagePrompt: string;
  reasoning: string;
};

const SUGGEST_TOOL: Tool = {
  name: "suggest_frame",
  description:
    "Propose the content of the next frame in a scene, given the story, scene, and frames so far.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description: "One short sentence on what this frame contributes to the scene flow.",
      },
      textOverlay: {
        type: "string",
        description:
          "Short on-image text (≤12 words). Omit if the format doesn't use overlays.",
      },
      caption: {
        type: "string",
        description: "Off-image text — alt or longer narration.",
      },
      imagePrompt: {
        type: "string",
        description:
          "One paragraph describing the image: subjects, action, mood, framing. Concrete nouns.",
      },
    },
    required: ["reasoning", "imagePrompt"],
  },
};

const SYSTEM_PROMPT = `You are a visual storyboard assistant proposing the next frame in a story.

Rules
- Read the story title, the scene context, the active style anchor (if any),
  and the frames in the scene so far. Propose what the NEXT frame should
  show — moving the narrative forward by one beat, not repeating prior frames.
- Match the voice of the previous frames' overlay text and the persona of the
  attached characters.
- imagePrompt: concrete nouns, one paragraph. No meta-language ("the next
  scene shows…"). Describe what's in the frame, period.
- textOverlay: ≤12 words. Punchy. Omit if the prior frames didn't use overlays.
- Always call suggest_frame.`;

export type SuggestInput = {
  story: Story;
  scene: Scene;
  project?: Project;
  prompts: Partial<Record<PromptKey, string>>;
  styleAnchorText: string | null;
  attachedCharNames: string[];
  framesSoFar: Frame[];
  model?: string;
};

export async function suggestNextFrame(input: SuggestInput): Promise<FrameSuggestion> {
  const system: TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  const lines: string[] = [];
  lines.push(`Story title: "${input.story.title}" (kind: ${input.story.kind})`);
  if (input.project?.name) lines.push(`Project: ${input.project.name}`);
  lines.push("");
  lines.push(`Scene title: ${input.scene.title ?? "(untitled)"}`);
  if (input.scene.environment) lines.push(`Scene environment: ${input.scene.environment}`);
  if (input.scene.environmentLockNotes)
    lines.push(`Scene consistency: ${input.scene.environmentLockNotes}`);
  if (input.attachedCharNames.length > 0) {
    lines.push(`Characters available: ${input.attachedCharNames.join(", ")}`);
  }
  if (input.styleAnchorText) {
    lines.push("");
    lines.push(`STYLE anchor (applied to every frame): ${input.styleAnchorText}`);
  }
  if (input.prompts.write) {
    lines.push("");
    lines.push(`Writer voice/style notes:\n${input.prompts.write}`);
  }
  lines.push("");
  if (input.framesSoFar.length === 0) {
    lines.push(
      "This will be the FIRST frame of the scene. Open the scene with a strong establishing shot or hook beat.",
    );
  } else {
    lines.push(`Frames in this scene so far (${input.framesSoFar.length}):`);
    for (let i = 0; i < input.framesSoFar.length; i++) {
      const f = input.framesSoFar[i]!;
      lines.push(`  ${i + 1}. overlay: "${f.textOverlay ?? ""}"`);
      lines.push(`     prompt: ${(f.imagePrompt ?? "").slice(0, 280)}`);
    }
  }
  lines.push("");
  lines.push("Propose the next frame. Call suggest_frame.");

  const userBlocks: ContentBlockParam[] = [{ type: "text", text: lines.join("\n") }];

  const client = getClaude();
  const response = await client.messages.create({
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: 1500,
    system,
    tools: [SUGGEST_TOOL],
    tool_choice: { type: "tool", name: "suggest_frame" },
    messages: [{ role: "user", content: userBlocks }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return suggest_frame.");
  }
  const parsed = toolUse.input as FrameSuggestion;
  if (!parsed.imagePrompt?.trim()) {
    throw new Error("Suggestion missing imagePrompt.");
  }
  return parsed;
}
