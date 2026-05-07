import Anthropic from "@anthropic-ai/sdk";
import { Asset, ImageFormat } from "../drizzle/schema";
import type {
  ConsistencyContext,
  ConsistencyContextV1,
  ConsistencyContextV2,
  Scene,
} from "@shared/types";
import { storagePut, storageReadLocal } from "./storage";
import { ENV } from "./_core/env";
import { prepareImageForAtlasRef } from "./_core/imagePrep";

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
 * Visual style is DERIVED from the stil-referenz / typografie assets that
 * flow as reference_images, NOT from a hardcoded prompt string. A hardcoded
 * anchor would override what the refs are meant to dictate. Kept as an
 * empty string for legacy callers; the file used to export a Mitchell/Pixar
 * description that has now been removed.
 */
export const PROJECT_STYLE_ANCHOR = "";

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
        const refUrl = rawRefs[i];
        if (refUrl.startsWith("http")) {
          refs.push(refUrl);
        } else if (refUrl.startsWith("data:")) {
          const match = /^data:([^;]+);base64,(.+)$/.exec(refUrl);
          if (!match) throw new Error("malformed data: URI");
          const mime = match[1];
          const buffer = Buffer.from(match[2], "base64");
          const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
          refs.push(await atlasUploadMedia(buffer, mime, `ref-${Date.now()}-${i}.${ext}`));
        } else {
          throw new Error(`unsupported ref URL scheme: ${refUrl.slice(0, 30)}`);
        }
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
  // Split by sentence-ish boundaries, drop sentences containing a forbidden
  // phrase, rejoin. Conservative: only drops the offending sentence.
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
  const cleanedSlidePrompt = slidePrompt
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !FORBIDDEN_PROMPT_PHRASES.some((rx) => rx.test(s)))
    .join(" ")
    .trim();

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

  // Style refs (rendering look + typography) are the AUTHORITY for everything
  // visual. When they flow, the model must copy their render style and the
  // typography treatment for the in-image text overlay. No hardcoded style.
  const hasStyleRefs = styleReferenceUrls.length > 0;
  const styleRefHint = hasStyleRefs
    ? "STYLE AUTHORITY: the reference images marked as style/typography sheets define the visual identity. Copy their rendering style (cartoon look, color treatment, lighting), and copy their typography exactly for the in-image text overlay (font, weight, color, highlight bars, line breaks, placement). Do NOT invent a different rendering or typography style."
    : null;

  // Build the full prompt. NO hardcoded render-style anchor — style is the
  // authority of stil-referenz refs (typography, color, render look). Server
  // only contributes: scene/lock, characters, slide action, ref-authority hint.
  const fullPrompt = [
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
