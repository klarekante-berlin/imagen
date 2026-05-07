import Anthropic from "@anthropic-ai/sdk";
import { Asset, AiModel, ImageFormat } from "../drizzle/schema";
import { storagePut, storageReadLocal } from "./storage";
import { ENV } from "./_core/env";
import { prepareImageForAtlasRef } from "./_core/imagePrep";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Legacy v1 shape — single environment, fixed 10 slides. Kept for backcompat reads. */
export interface ConsistencyContextV1 {
  artStyle: string;
  colorPalette: string;
  environment: string;
  characters: Array<{
    assetId: number;
    name: string;
    outfit: string;
    visualDescription: string;
    referenceImageUrl?: string;
  }>;
  globalStylePrompt: string;
  styleReferenceUrls?: string[];
}

/** Multi-scene story v2. */
export interface Scene {
  id: string;                     // "scene-1" — stable across regenerates
  slideRange: [number, number];   // 1-indexed inclusive
  environment: string;            // location description
  environmentLockNotes: string;   // "same window, same coffee mug"
  transitionToNext?: string;      // bridge text on the last slide of this scene
  environmentRefAssetId?: number; // Phase-3: world-built env reference
}

export interface ConsistencyCharacterRef {
  characterId: number;            // FK to characters.id (0 = pre-v2 legacy)
  assetId: number;                // primary sheet
  name: string;
  outfit: string;
  visualDescription: string;
  referenceImageUrl?: string;
  worldBuilt?: boolean;
}

export interface ConsistencyContextV2 {
  version: 2;
  artStyle: string;
  colorPalette: string;
  scenes: Scene[];
  characters: ConsistencyCharacterRef[];
  globalStylePrompt: string;
  styleReferenceUrls?: string[];
  worldBuiltAssetIds: number[];
  slideCount: number;             // 3..10
}

/** Default export is v2. v1 kept under an explicit alias. */
export type ConsistencyContext = ConsistencyContextV2;

export interface SlideContent {
  slideNumber: number;
  textContent: string;
  caption: string;
  charactersInSlide: string[];
  imagePrompt: string;
  sceneId?: string;
}

export interface StoryContent {
  title: string;
  consistencyContext: ConsistencyContext;
  slides: SlideContent[];
  usedAssetIds: number[];
}

// ─── V1 → V2 normalize ────────────────────────────────────────────────────────

/**
 * Read-time adapter. v1 stories on disk get wrapped in a single all-encompassing
 * scene so callers only ever deal with v2.
 */
export function normalizeConsistencyContext(
  raw: unknown,
): ConsistencyContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ConsistencyContextV2 & ConsistencyContextV1>;

  if (r.version === 2 && Array.isArray(r.scenes)) {
    return r as ConsistencyContextV2;
  }

  // v1 → v2
  const characters = Array.isArray(r.characters)
    ? r.characters.map((c) => ({
        characterId: 0,
        assetId: c.assetId,
        name: c.name,
        outfit: c.outfit,
        visualDescription: c.visualDescription,
        referenceImageUrl: c.referenceImageUrl,
        worldBuilt: false,
      }))
    : [];

  return {
    version: 2,
    artStyle: r.artStyle ?? "",
    colorPalette: r.colorPalette ?? "",
    scenes: [
      {
        id: "scene-1",
        slideRange: [1, 10],
        environment: (r as ConsistencyContextV1).environment ?? "",
        environmentLockNotes: "",
      },
    ],
    characters,
    globalStylePrompt: r.globalStylePrompt ?? "",
    styleReferenceUrls: r.styleReferenceUrls,
    worldBuiltAssetIds: [],
    slideCount: 10,
  };
}

/** Find the scene containing a given slide number. Falls back to the first scene. */
export function findSceneForSlide(
  ctx: ConsistencyContext,
  slideNumber: number,
): Scene {
  return (
    ctx.scenes.find(
      (s) => slideNumber >= s.slideRange[0] && slideNumber <= s.slideRange[1],
    ) ?? ctx.scenes[0]
  );
}

export interface DetectedCharacter {
  name: string;
  role: string; // e.g. "Podcast-Host", "Politiker", "Kind"
  suggestedAssetId: number | null;
  confidence: "high" | "medium" | "low";
}

// ─── Anthropic Client ─────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = ENV.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

// ─── Atlas Cloud Image Generation (gpt-image-2) ───────────────────────────────

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";
// text-to-image ignores reference_images. For ref-conditioned generation we
// must hit the edit endpoint with `images` (plural).
const ATLAS_MODEL_TEXT = "openai/gpt-image-2/text-to-image";
const ATLAS_MODEL_EDIT = "openai/gpt-image-2/edit";

/**
 * Project-wide visual DNA. Always prepended to every slide prompt so the
 * style stays locked across stories — Claude can add per-story flavor in
 * globalStylePrompt but cannot redefine the foundation.
 */
export const PROJECT_STYLE_ANCHOR =
  "3D cartoon render in the style of The Mitchells vs the Machines / Pixar — expressive faces, bold confident outlines, warm cinematic lighting, detailed fabric and skin textures, slightly stylized proportions. Always this exact rendering style.";

/**
 * Server-side scrubber for Claude's slidePrompt. Despite explicit prompt
 * rules, Claude occasionally re-adds render-style/format/lighting clauses
 * that conflict with our project anchor + scene block. Strip sentences
 * that contain those forbidden phrases before assembling the final prompt.
 */
const FORBIDDEN_PROMPT_PHRASES = [
  /\b(3d|cartoon)\s+(render|cartoon)/gi,
  /\bpixar[-\s]?style\b/gi,
  /\b1080\s*x\s*1080(?:px)?\b/gi,
  /\b1080\s*x\s*1350(?:px)?\b/gi,
  /\bsquare\s+format\b/gi,
  /\baspect\s+ratio\b/gi,
  /\bquadratisches\s+format\b/gi,
  /\bhochformat\b/gi,
];

function stripForbiddenStyleClauses(prompt: string): string {
  // Split by sentence-ish boundaries, drop sentences that match a forbidden
  // phrase, rejoin. Conservative: only drops the offending sentence, not the
  // whole prompt.
  const parts = prompt.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((s) => !FORBIDDEN_PROMPT_PHRASES.some((rx) => rx.test(s)));
  return kept.join(" ").trim();
}

function getAtlasKey(): string {
  const key = ENV.atlascloudApiKey || process.env.ATLASCLOUD_API_KEY;
  if (!key) throw new Error("ATLASCLOUD_API_KEY not configured");
  return key;
}

/**
 * Upload an image buffer to Atlas Cloud and return the public download URL,
 * which can then be used as a `images: [...]` entry on the edit endpoint.
 * Atlas requires HTTP URLs there — data: URIs do NOT work.
 */
async function atlasUploadMedia(
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<string> {
  const key = getAtlasKey();
  const blob = new Blob([buffer as unknown as BlobPart], { type: mime });
  const form = new FormData();
  form.set("file", blob, fileName);
  const res = await fetch(`${ATLAS_BASE}/model/uploadMedia`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Atlas uploadMedia failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data?: { download_url?: string } };
  const url = json.data?.download_url;
  if (!url) throw new Error("Atlas uploadMedia: no download_url in response");
  return url;
}

/**
 * Convert any reference URL into something Atlas's edit endpoint accepts:
 * - http(s) URL → passed through unchanged
 * - data: URI → decoded, uploaded via uploadMedia, returns the resulting URL
 */
async function ensureAtlasUrl(refUrl: string, idx: number): Promise<string> {
  if (refUrl.startsWith("http")) return refUrl;
  if (!refUrl.startsWith("data:")) {
    throw new Error(`unsupported ref URL scheme: ${refUrl.slice(0, 30)}`);
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(refUrl);
  if (!match) throw new Error("malformed data: URI");
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return atlasUploadMedia(buffer, mime, `ref-${Date.now()}-${idx}.${ext}`);
}

async function atlasGenerateImage(params: {
  prompt: string;
  size: string;
  quality?: string;
  referenceImageUrls?: string[]; // Character sheets + style references
}): Promise<string> {
  const key = getAtlasKey();

  const useEdit = !!params.referenceImageUrls && params.referenceImageUrls.length > 0;

  const body: Record<string, unknown> = {
    model: useEdit ? ATLAS_MODEL_EDIT : ATLAS_MODEL_TEXT,
    prompt: params.prompt,
    size: params.size,
    quality: params.quality ?? "high",
    output_format: "jpeg",
    enable_base64_output: false,
    enable_sync_mode: false,
  };

  if (useEdit) {
    const rawRefs = params.referenceImageUrls!.slice(0, 4); // max 4
    // Atlas's edit endpoint only accepts HTTP(S) URLs in `images`. Any
    // data: URIs (local-storage backend) must be uploaded via uploadMedia first.
    const refs: string[] = [];
    for (let i = 0; i < rawRefs.length; i++) {
      try {
        refs.push(await ensureAtlasUrl(rawRefs[i], i));
      } catch (e) {
        console.error(`[atlas] failed to resolve ref #${i}:`, e);
      }
    }
    body.images = refs;
    body.input_fidelity = "high"; // preserve details from input refs
    console.log(
      `[atlas] EDIT endpoint, ${refs.length}/${rawRefs.length} ref URLs: [${refs.map((u) => u.slice(0, 80)).join(", ")}]`,
    );
  } else {
    console.log("[atlas] TEXT-TO-IMAGE endpoint, no refs");
  }

  // Step 1: Submit generation job
  const submitRes = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Atlas Cloud submit error ${submitRes.status}: ${err}`);
  }

  const submitData = await submitRes.json() as { code: number; msg: string; data?: { id: string } };
  if (!submitData.data?.id) {
    throw new Error(`Atlas Cloud submit failed: ${submitData.msg}`);
  }

  const predictionId = submitData.data.id;

  // Step 2: Poll for result. Edit jobs can take 5-8 min; bumped to 10 min total.
  const pollUrl = `${ATLAS_BASE}/model/prediction/${predictionId}`;
  const POLL_INTERVAL_MS = 5000;
  const MAX_POLLS = 120; // 10 minutes
  let lastStatus = "";
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!pollRes.ok) continue;

    const pollData = (await pollRes.json()) as {
      data?: { status: string; outputs?: string[]; error?: string };
    };
    const status = pollData.data?.status;
    if (status && status !== lastStatus) {
      console.log(`[atlas] prediction ${predictionId} status=${status} (${i * 5}s elapsed)`);
      lastStatus = status;
    }

    if (status === "completed") {
      const url = pollData.data?.outputs?.[0];
      if (!url) throw new Error("Atlas Cloud: completed but no output URL");
      return url;
    }
    if (status === "failed") {
      throw new Error(`Atlas Cloud generation failed: ${pollData.data?.error ?? "unknown"}`);
    }
  }

  throw new Error(`Atlas Cloud: generation timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60000} minutes`);
}

// ─── Auto Character Detection ─────────────────────────────────────────────────

/**
 * Uses Claude to detect characters in a script/theme and match them to assets.
 * Returns detected characters with suggested asset IDs.
 */
export async function detectCharactersFromScript(
  scriptOrTheme: string,
  availableAssets: Asset[]
): Promise<DetectedCharacter[]> {
  const client = getAnthropicClient();

  const assetList = availableAssets
    .map((a) => `ID:${a.id} | "${a.name}" | Kategorie: ${a.category} | ${a.description || ""}`)
    .join("\n");

  const prompt = `Analysiere dieses Skript/Thema und erkenne alle Charaktere darin.
Dann ordne jeden Charakter dem passendsten Asset aus der Liste zu.

SKRIPT/THEMA:
${scriptOrTheme}

VERFÜGBARE ASSETS:
${assetList}

Antworte als JSON-Array ohne Markdown:
[
  {
    "name": "Charaktername wie im Skript",
    "role": "Rolle/Funktion (z.B. Podcast-Host, Politiker, Kind, Hund)",
    "suggestedAssetId": <Asset-ID oder null wenn kein passendes Asset>,
    "confidence": "high|medium|low"
  }
]

Matching-Regeln:
- "Toni" oder "Host" oder "Moderator" → suche nach dad/family/host Assets
- Historische Persönlichkeiten (Scholz, Merkel, etc.) → historische-persoenlichkeit oder politiker Assets
- Sportler → sport-athleten Assets
- Musiker → musik-legenden oder moderne-popstars Assets
- Kinder → the-boy oder lily oder girl Assets
- Tiere → pug, cat, tiere Assets
- Nur Charaktere die wirklich im Skript vorkommen, keine erfundenen`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  try {
    return JSON.parse(cleaned) as DetectedCharacter[];
  } catch {
    return [];
  }
}

// ─── Story Text Generation ────────────────────────────────────────────────────

export async function generateStoryText(
  theme: string,
  selectedAssets: Asset[],
  model: AiModel,
  imageFormat: ImageFormat
): Promise<StoryContent> {
  const client = getAnthropicClient();

  const assetDescriptions = selectedAssets
    .map(
      (a) =>
        `- ID:${a.id} | "${a.name}" (${a.category}): ${a.visualDescription || a.description || "Keine Beschreibung"}`
    )
    .join("\n");

  const aspectRatio =
    imageFormat === "1:1" ? "quadratisch 1080x1080px" : "Hochformat 1080x1350px";

  const systemPrompt = `Du bist ein erfahrener Content-Stratege für Instagram Carousel Stories im Stil des Formats "Hey was war denn das?" von klarekante.berlin.

DEIN STIL:
- Berliner Direktheit: kein Bullshit, kein Wellness-Coach-Sprech
- Satirisch und trocken wie Ricky Gervais – aber mit Herz
- Zahlen und Fakten als Schockmomente ("41 FUCKING PROZENT!")
- Persönliche Anekdoten als emotionale Auflösung
- Jeder Slide hat eine klare Aussage – kein Fülltext
- Dialoge sind knapp, pointiert, real

CAROUSEL-STRUKTUR (10 Slides):
- Slide 1: HOOK – ein Satz der sofort trifft, Frage oder provokante These
- Slide 2-3: KONTEXT – das Problem in Zahlen/Fakten aufbauen
- Slide 4-5: ESKALATION – die Absurdität des Systems zeigen
- Slide 6-7: WENDEPUNKT – persönliche Geschichte oder konkretes Beispiel
- Slide 8-9: AUFLÖSUNG – die eigentliche Botschaft, ehrlich und direkt
- Slide 10: CTA – Aufruf zum Folgen, Kommentieren oder Teilen

KONSISTENZ-REGELN:
- Outfits, Umgebungen und Charaktere bleiben in ALLEN 10 Slides identisch
- Kein Outfit-Wechsel, kein Setting-Wechsel innerhalb einer Story
- Der Bildstil ist 3D-Cartoon-Render im Pixar/Mitchell's-Stil – warm, expressiv, detailreich

TEXT-OVERLAY-REGELN:
- textContent erscheint DIREKT IM BILD als großer, lesbarer Text
- Max 2-3 kurze Sätze – kein Fließtext
- Darf Zahlen, Ausrufezeichen, Kursivschrift-Hinweise enthalten
- Muss auch ohne Bild verständlich sein

Antworte IMMER als valides JSON ohne Markdown-Codeblöcke.`;

  const userPrompt = `Erstelle ein Instagram Carousel zum Thema: "${theme}"

${
  selectedAssets.length > 0
    ? `Charaktere und Assets für diese Story (verwende diese exakt):
${assetDescriptions}

WICHTIG: Die assetId in den Charakteren muss mit den IDs oben übereinstimmen!`
    : "Keine spezifischen Charaktere ausgewählt – erfinde passende Charaktere die zum Thema passen."
}

Bildformat: ${aspectRatio}

Erstelle eine JSON-Antwort mit dieser exakten Struktur:
{
  "title": "Kurzer, einprägsamer Carousel-Titel (max 5 Wörter)",
  "consistencyContext": {
    "artStyle": "3D cartoon render, Pixar animation style, expressive faces, bold outlines, warm cinematic lighting, detailed textures, Mitchell's vs the Machines aesthetic",
    "colorPalette": "Beschreibe die Farbpalette die zu diesem spezifischen Thema und Setting passt (aus der Szene entstehend, nicht aufgezwungen)",
    "environment": "Hauptumgebung/Setting das in ALLEN Slides gleich bleibt – sehr spezifisch beschreiben",
    "characters": [
      {
        "assetId": <ID aus den verfügbaren Assets oder 0 wenn kein Asset>,
        "name": "Charaktername",
        "outfit": "EXAKTE Outfit-Beschreibung die in ALLEN Slides identisch bleibt – sehr detailliert",
        "visualDescription": "Vollständige visuelle Beschreibung: Körperbau, Gesicht, Haare, Alter, Ausdruck – sehr detailliert für Bildgenerierung"
      }
    ],
    "globalStylePrompt": "Einziger konsistenter Style-String für ALLE Slides. Enthält: Rendering-Stil, Charakterbeschreibungen mit Outfits, Setting. Englisch. Max 100 Wörter."
  },
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "TEXT DER DIREKT IM BILD ERSCHEINT – max 2-3 kurze Sätze auf Deutsch. Provokant, witzig oder emotional.",
      "caption": "Instagram-Caption für diesen Slide (1-2 Sätze + Emojis)",
      "charactersInSlide": ["Namen der Charaktere in diesem Slide"],
      "imagePrompt": "Detaillierter Bildprompt auf Englisch. Szene + Charaktere + Aktion + Ausdruck. MUSS enthalten: 1) globalStylePrompt, 2) Outfit-Details der vorkommenden Charaktere, 3) die exakte Szene, 4) den deutschen textContent als großen lesbaren Text im Bild (bold, clear, readable font, positioned at bottom or top third)"
    }
  ],
  "usedAssetIds": [<IDs der verwendeten Assets>]
}

WICHTIG:
- Genau 10 Slides
- Jeder imagePrompt MUSS den textContent als Text-Overlay im Bild enthalten
- Jeder imagePrompt MUSS die Outfit-Details der vorkommenden Charaktere enthalten
- Die Story muss einen echten narrativen Bogen haben: Hook → Aufbau → Eskalation → Wendung → Auflösung → CTA`;

  const claudeModel =
    model === "claude-opus-4-5" ? "claude-opus-4-5" : "claude-sonnet-4-6";

  // Retry with exponential backoff for overloaded errors (HTTP 529)
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await client.messages.create({
        model: claudeModel,
        max_tokens: 8000,
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

      const parsed = JSON.parse(jsonText) as {
        title: string;
        consistencyContext: ConsistencyContextV1 | ConsistencyContextV2;
        slides: SlideContent[];
        usedAssetIds: number[];
      };

      if (
        !parsed.title ||
        !parsed.consistencyContext ||
        !Array.isArray(parsed.slides) ||
        parsed.slides.length !== 10
      ) {
        throw new Error(
          `Invalid story structure: got ${parsed.slides?.length ?? 0} slides, expected 10`
        );
      }

      const normalized = normalizeConsistencyContext(parsed.consistencyContext);
      if (!normalized) throw new Error("Failed to normalize consistencyContext");

      return {
        title: parsed.title,
        consistencyContext: normalized,
        slides: parsed.slides,
        usedAssetIds: parsed.usedAssetIds,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isOverloaded =
        lastError.message.includes("529") || lastError.message.includes("overloaded");
      if (!isOverloaded || attempt === 4) throw lastError;
      const delay = Math.pow(2, attempt) * 5000; // 10s, 20s, 40s
      console.log(
        `[StoryService] Anthropic overloaded, retry ${attempt}/4 in ${delay / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ─── Image Generation via Atlas Cloud (gpt-image-2) with Reference Images ────

export async function generateSlideImage(
  slidePrompt: string,
  consistencyContext: ConsistencyContext,
  slideNumber: number,
  storyId: number,
  imageFormat: ImageFormat,
  characterReferenceUrls: string[] = [], // Character sheet URLs for this slide's characters
  styleReferenceUrls: string[] = [],     // Global style reference URLs
  slideCharacterNames: string[] = [],    // Names of characters appearing in this slide
): Promise<{ imageKey: string; imageUrl: string }> {

  const scene = findSceneForSlide(consistencyContext, slideNumber);
  const totalSlides = consistencyContext.slideCount;
  const sceneIdx = consistencyContext.scenes.findIndex((s) => s.id === scene.id);
  const nextScene = consistencyContext.scenes[sceneIdx + 1];
  const isLastOfScene = slideNumber === scene.slideRange[1];

  // Defensive: strip Claude-injected style/format clauses from slidePrompt.
  // These should be set by the project anchor + scene block, not Claude.
  const cleanedSlidePrompt = stripForbiddenStyleClauses(slidePrompt);

  // Build per-slide character block. When the character has a reference image
  // attached (via characterReferenceUrls), the model already sees the full
  // appearance — extra text just adds noise. When NO ref is available, we
  // include the full visualDescription + outfit so consistency holds via text.
  const hasAnyRefs = characterReferenceUrls.length > 0;
  const slideChars = slideCharacterNames
    .map((name) =>
      consistencyContext.characters.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      ),
    )
    .filter((c): c is NonNullable<typeof c> => !!c);

  const characterBlock = (() => {
    if (slideChars.length === 0) return null;
    if (hasAnyRefs) {
      // Refs carry the appearance — just name them + remind the model to use refs.
      return (
        "Characters: " +
        slideChars.map((c) => c.name).join(", ") +
        ". Match their appearance EXACTLY to the reference images provided."
      );
    }
    // No refs — describe everything in text.
    return (
      "Characters in this slide: " +
      slideChars
        .map((c) => {
          const parts = [`${c.name} — ${c.visualDescription}`];
          if (c.outfit) parts.push(`outfit: ${c.outfit}`);
          return parts.join("; ");
        })
        .join(" | ") +
      ". Keep their appearance/outfit identical across slides."
    );
  })();

  // Typography & overall style come from the stil-referenz / typografie assets.
  // When they flow, instruct the model to copy their typography treatment
  // (font, weight, color, highlights, layout) for the in-image text overlay.
  // No hardcoded "make it bold" rule — that conflicts with what the refs show.
  const hasStyleRefs = styleReferenceUrls.length > 0;
  const styleRefHint = hasStyleRefs
    ? "Some of the reference images are typography / brand-style sheets. Use them as the AUTHORITY for the in-image text overlay: font, weight, color, highlight treatment, line breaks and placement must match those references exactly. Do not invent a different typography style."
    : null;

  // Build the full prompt. PROJECT_STYLE_ANCHOR is prepended once (gpt-image-2
  // is LLM-like — start placement is enough, repeating it just bloats tokens).
  const fullPrompt = [
    PROJECT_STYLE_ANCHOR,
    consistencyContext.globalStylePrompt,
    characterBlock,
    `Setting: ${scene.environment}.`,
    scene.environmentLockNotes ? `Lock: ${scene.environmentLockNotes}.` : null,
    isLastOfScene && nextScene && scene.transitionToNext
      ? `Transition cue: ${scene.transitionToNext} (next scene: ${nextScene.environment}).`
      : null,
    cleanedSlidePrompt,
    styleRefHint,
  ]
    .filter(Boolean)
    .join(" ");

  // Combine reference images. Atlas hard-caps at 4 total. Characters first
  // (max 3 — most impactful for consistency), then fill remaining slots with
  // style references. So 1 char + up to 3 style refs, or 3 chars + 1 style.
  const charRefs = characterReferenceUrls.slice(0, 3);
  const remainingSlots = Math.max(0, 4 - charRefs.length);
  const styleRefs = styleReferenceUrls.slice(0, remainingSlots);
  const allReferenceUrls = [...charRefs, ...styleRefs].filter(Boolean).slice(0, 4);

  // gpt-image-2 via Atlas Cloud supports 1024x1024 and 1024x1536
  const size = imageFormat === "1:1" ? "1024x1024" : "1024x1536";

  console.log(
    `[StoryService] Slide ${slideNumber}/${totalSlides}: ${allReferenceUrls.length} ref images, ${slideChars.length} chars in text (${slideChars.map((c) => c.name).join(", ") || "none"})`,
  );

  // Generate via Atlas Cloud
  const atlasUrl = await atlasGenerateImage({
    prompt: fullPrompt,
    size,
    quality: "high",
    referenceImageUrls: allReferenceUrls.length > 0 ? allReferenceUrls : undefined,
  });

  // Download the image from Atlas CDN
  const imgResponse = await fetch(atlasUrl);
  if (!imgResponse.ok) throw new Error(`Failed to download image from Atlas CDN: ${imgResponse.status}`);
  const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

  // Upload to Manus storage
  const key = `stories/${storyId}/slide-${slideNumber}-${Date.now()}.jpg`;
  const { url } = await storagePut(key, imageBuffer, "image/jpeg");

  return { imageKey: key, imageUrl: url };
}

// ─── Freepik Image Generation (fallback) ─────────────────────────────────────

export async function generateSlideImageFreepik(
  slidePrompt: string,
  consistencyContext: ConsistencyContext,
  slideNumber: number,
  storyId: number,
  imageFormat: ImageFormat
): Promise<{ imageKey: string; imageUrl: string }> {
  const apiKey = process.env.FREEPIK_API_KEY;
  if (!apiKey) throw new Error("FREEPIK_API_KEY not configured");

  const fullPrompt = `${consistencyContext.globalStylePrompt}. ${slidePrompt}. Art style: ${consistencyContext.artStyle}.`;
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

  const data = (await response.json()) as { data: Array<{ base64: string }> };
  const base64 = data.data?.[0]?.base64;
  if (!base64) throw new Error("No image data from Freepik");

  const imageBuffer = Buffer.from(base64, "base64");
  const key = `stories/${storyId}/slide-${slideNumber}-${Date.now()}.png`;
  const { url } = await storagePut(key, imageBuffer, "image/png");

  return { imageKey: key, imageUrl: url };
}

// ─── Character Detection (simple text matching) ───────────────────────────────

export function detectCharactersInText(
  text: string,
  characters: ConsistencyContext["characters"]
): string[] {
  const found: string[] = [];
  for (const char of characters) {
    if (text.toLowerCase().includes(char.name.toLowerCase())) {
      found.push(char.name);
    }
  }
  return found;
}

// ─── Reference Image URL Helper ───────────────────────────────────────────────

/**
 * Resolves a /manus-storage/<key> URL into something Atlas Cloud can fetch.
 *
 * - Already absolute http(s) URL → return as-is.
 * - STORAGE_BACKEND=forge → presigned CloudFront URL via Forge.
 * - STORAGE_BACKEND=local → read the file and return a `data:image/...;base64,...`
 *   URI. Avoids the chicken-and-egg of "Atlas can't reach localhost".
 */
export async function getPresignedStorageUrl(relativeOrAbsoluteUrl: string): Promise<string | null> {
  if (!relativeOrAbsoluteUrl) return null;
  if (relativeOrAbsoluteUrl.startsWith("http")) return relativeOrAbsoluteUrl;
  const key = relativeOrAbsoluteUrl.replace(/^\/manus-storage\//, "");
  if (!key) return null;

  if (ENV.storageBackend === "local") {
    const file = await storageReadLocal(key);
    if (!file) return null;
    // Atlas's edit endpoint chokes on multi-MB JSON bodies. ALWAYS downscale
    // to 1024px / JPEG q80 (typically 80–300KB), regardless of original size.
    const prepared = await prepareImageForAtlasRef(file.buffer, file.contentType);
    return `data:${prepared.mediaType};base64,${prepared.buffer.toString("base64")}`;
  }

  const forgeApiUrl = ENV.forgeApiUrl;
  const forgeApiKey = ENV.forgeApiKey;
  if (!forgeApiUrl || !forgeApiKey) return null;

  try {
    const forgeUrl = new URL("v1/storage/presign/get", forgeApiUrl.replace(/\/+$/, "") + "/");
    forgeUrl.searchParams.set("path", key);
    const res = await fetch(forgeUrl, {
      headers: { Authorization: `Bearer ${forgeApiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}
