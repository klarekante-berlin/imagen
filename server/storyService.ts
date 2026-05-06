import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Asset, AiModel, ImageFormat, ImageProvider } from "../drizzle/schema";
import { storagePut } from "./storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsistencyContext {
  artStyle: string;
  colorPalette: string;
  environment: string;
  characters: Array<{
    assetId: number;
    name: string;
    outfit: string;
    visualDescription: string;
  }>;
  globalStylePrompt: string;
}

export interface SlideContent {
  slideNumber: number;
  textContent: string;
  caption: string;
  charactersInSlide: string[];
  imagePrompt: string;
}

export interface StoryContent {
  title: string;
  consistencyContext: ConsistencyContext;
  slides: SlideContent[];
  usedAssetIds: number[];
}

// ─── Claude Client ────────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({ apiKey });
}

// ─── Story Text Generation ────────────────────────────────────────────────────

export async function generateStoryText(
  theme: string,
  selectedAssets: Asset[],
  model: AiModel,
  imageFormat: ImageFormat
): Promise<StoryContent> {
  const client = getAnthropicClient();

  const assetDescriptions = selectedAssets.map((a) =>
    `- ${a.name} (${a.category}): ${a.visualDescription || a.description || "Kein Beschreibung"}`
  ).join("\n");

  const aspectRatio = imageFormat === "1:1" ? "quadratisch (1080x1080px)" : "hochformat (1080x1350px)";

  const systemPrompt = `Du bist ein kreativer Storyteller für Instagram Carousel Stories. 
Du erstellst in sich geschlossene, konsistente Geschichten mit genau 10 Slides.
Wichtig: Outfits, Umgebungen und Charaktereigenschaften bleiben in der gesamten Story konstant – kein Wechsel!
Die Bildformate sind ${aspectRatio}.
Antworte IMMER als valides JSON ohne Markdown-Codeblöcke.`;

  const userPrompt = `Erstelle eine Instagram Carousel Story zum Thema: "${theme}"

Verfügbare Charaktere und Assets:
${assetDescriptions || "Keine spezifischen Charaktere ausgewählt – erfinde passende Charaktere."}

Erstelle eine JSON-Antwort mit dieser exakten Struktur:
{
  "title": "Kurzer, einprägsamer Story-Titel",
  "consistencyContext": {
    "artStyle": "Detaillierter Kunststil für alle Bilder (z.B. 'flat design cartoon, bold outlines, vibrant colors, 2D animation style')",
    "colorPalette": "Farbpalette die durch alle Slides konsistent bleibt",
    "environment": "Hauptumgebung/Setting der Story",
    "characters": [
      {
        "assetId": <ID aus den verfügbaren Assets oder 0 wenn kein Asset>,
        "name": "Charaktername",
        "outfit": "Exakte Outfit-Beschreibung die in ALLEN Slides gleich bleibt",
        "visualDescription": "Vollständige visuelle Beschreibung des Charakters"
      }
    ],
    "globalStylePrompt": "Übergreifender Style-Prompt der in jeden Bildprompt eingefügt wird für maximale Konsistenz"
  },
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "Text/Dialog der auf dem Slide erscheint (max 3 kurze Sätze)",
      "caption": "Kurze Bildunterschrift oder Emoji-Caption für Instagram",
      "charactersInSlide": ["Name der Charaktere die in diesem Slide vorkommen"],
      "imagePrompt": "Detaillierter Bildprompt für diesen Slide (auf Englisch, da die Bild-API Englisch bevorzugt)"
    }
  ],
  "usedAssetIds": [<IDs der verwendeten Assets>]
}

Regeln:
- Genau 10 Slides
- Die Story muss einen klaren Anfang, Mittelteil und Ende haben
- Jeder imagePrompt muss den globalStylePrompt und die Outfit-Beschreibungen der vorkommenden Charaktere enthalten
- Dialoge sollen natürlich und unterhaltsam sein
- Slide 1: Hook/Einleitung, Slides 2-9: Story, Slide 10: Auflösung/Cliffhanger`;

  const claudeModel = model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-5";

  const response = await client.messages.create({
    model: claudeModel,
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type from Claude");

  // Strip potential markdown code blocks
  let jsonText = content.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(jsonText) as StoryContent;

  // Validate structure
  if (!parsed.title || !parsed.consistencyContext || !Array.isArray(parsed.slides) || parsed.slides.length !== 10) {
    throw new Error("Invalid story structure returned from Claude");
  }

  return parsed;
}

// ─── Image Generation via gpt-image-2 ────────────────────────────────────────

export async function generateSlideImage(
  slidePrompt: string,
  consistencyContext: ConsistencyContext,
  slideNumber: number,
  storyId: number,
  imageFormat: ImageFormat,
  referenceImageUrls: string[] = []
): Promise<{ imageKey: string; imageUrl: string }> {
  const client = getOpenAIClient();

  const size = imageFormat === "1:1" ? "1024x1024" : "1024x1536";

  // Build the full prompt with consistency context
  const fullPrompt = `${consistencyContext.globalStylePrompt}. ${slidePrompt}. Art style: ${consistencyContext.artStyle}. Color palette: ${consistencyContext.colorPalette}. Setting: ${consistencyContext.environment}. Instagram carousel slide ${slideNumber}/10. High quality, consistent character design throughout.`;

  let imageBuffer: Buffer;

  if (referenceImageUrls.length > 0) {
    // Use image editing endpoint with reference images
    const imageFiles = await Promise.all(
      referenceImageUrls.slice(0, 4).map(async (url) => {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        return new File([buffer], `ref-${Date.now()}.png`, { type: "image/png" });
      })
    );

    const editResponse = await client.images.edit({
      model: "gpt-image-2",
      image: imageFiles[0],
      prompt: fullPrompt,
      size: size as "1024x1024" | "1024x1536",
    });

    const imageData = editResponse.data?.[0];
    if (!imageData) throw new Error("No image data returned from gpt-image-2");

    if (imageData.b64_json) {
      imageBuffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData.url) {
      const imgResponse = await fetch(imageData.url);
      imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
    } else {
      throw new Error("No image data in response");
    }
  } else {
    // Generate from text only
    const genResponse = await client.images.generate({
      model: "gpt-image-2",
      prompt: fullPrompt,
      size: size as "1024x1024" | "1024x1536",
      response_format: "b64_json",
    });

    const imageData = genResponse.data?.[0];
    if (!imageData?.b64_json) throw new Error("No image data returned from gpt-image-2");
    imageBuffer = Buffer.from(imageData.b64_json, "base64");
  }

  // Upload to storage
  const key = `stories/${storyId}/slide-${slideNumber}-${Date.now()}.png`;
  const { url } = await storagePut(key, imageBuffer, "image/png");

  return { imageKey: key, imageUrl: url };
}

// ─── Freepik Image Generation ─────────────────────────────────────────────────

export async function generateSlideImageFreepik(
  slidePrompt: string,
  consistencyContext: ConsistencyContext,
  slideNumber: number,
  storyId: number,
  imageFormat: ImageFormat
): Promise<{ imageKey: string; imageUrl: string }> {
  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) throw new Error("FREEPIK_API_KEY not configured");

  const fullPrompt = `${consistencyContext.globalStylePrompt}. ${slidePrompt}. Art style: ${consistencyContext.artStyle}. Color palette: ${consistencyContext.colorPalette}.`;

  const aspectRatio = imageFormat === "1:1" ? "square_1_1" : "portrait_4_5";

  const response = await fetch("https://api.freepik.com/v1/ai/text-to-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-freepik-api-key": apiKey,
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      num_images: 1,
      image: { size: aspectRatio },
      styling: { style: "photo" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Freepik API error: ${err}`);
  }

  const data = await response.json() as { data: Array<{ base64: string }> };
  const base64 = data.data?.[0]?.base64;
  if (!base64) throw new Error("No image data from Freepik");

  const imageBuffer = Buffer.from(base64, "base64");
  const key = `stories/${storyId}/slide-${slideNumber}-${Date.now()}.png`;
  const { url } = await storagePut(key, imageBuffer, "image/png");

  return { imageKey: key, imageUrl: url };
}

// ─── Character Detection ──────────────────────────────────────────────────────

export function detectCharactersInText(text: string, characters: ConsistencyContext["characters"]): string[] {
  const found: string[] = [];
  for (const char of characters) {
    if (text.toLowerCase().includes(char.name.toLowerCase())) {
      found.push(char.name);
    }
  }
  return found;
}
