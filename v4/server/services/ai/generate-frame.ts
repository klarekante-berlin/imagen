import { isNotNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  frames as framesTable,
  type Asset,
  type Frame,
  type Scene,
} from "../../../drizzle/schema";
import type { RenditionParams } from "../../../shared/types/domain";
import { getFrame, updateFrame } from "../db/frames";
import { getProject } from "../db/projects";
import { createRendition, deleteRendition } from "../db/renditions";
import { getScene } from "../db/scenes";
import { getStory } from "../db/stories";
import { storageDelete, storagePut, storageRead } from "../storage";
import { atlasPoll, atlasSubmit, atlasUploadMedia } from "./atlas";
import { resolveStoryReferenceAssets } from "./reference-resolver";

async function uploadRefToAtlas(asset: Asset): Promise<string | null> {
  if (asset.imageUrl.startsWith("http")) return asset.imageUrl;
  const file = await storageRead(asset.imageKey);
  if (!file) {
    console.warn(`[v4 generate] could not read asset ${asset.id} (${asset.name}) for ref upload`);
    return null;
  }
  const fileName = `${asset.id}.${file.contentType.split("/")[1] ?? "png"}`;
  return atlasUploadMedia(file.buffer, file.contentType, fileName);
}

function buildPrompt(
  frame: Frame,
  scene: Scene,
  storyTitle: string,
  hasStyleRefs: boolean,
  attachedCharNames: string[],
  styleAnchorText: string | null,
): string {
  const lines: string[] = [];
  if (styleAnchorText?.trim()) {
    lines.push(`STYLE: ${styleAnchorText.trim()}`);
  }
  if (scene.environment) lines.push(`Setting: ${scene.environment}.`);
  if (scene.environmentLockNotes) lines.push(`Consistency: ${scene.environmentLockNotes}.`);
  if (attachedCharNames.length > 0) {
    lines.push(
      `Characters in this image: ${attachedCharNames.join(", ")}. Match their appearance EXACTLY to the character reference images provided.`,
    );
  }
  if (frame.imagePrompt) lines.push(frame.imagePrompt);
  if (frame.textOverlay) {
    lines.push(
      `Include this text overlay on the image: "${frame.textOverlay}". Match the typography from the style reference sheets.`,
    );
  }
  if (hasStyleRefs) {
    lines.push(
      "STYLE AUTHORITY: the reference images marked as style sheets are the final word on rendering, color, lighting, and typography. Match them exactly. If they conflict with the STYLE anchor above, the images win for what they show; the anchor governs anything they don't.",
    );
  }
  lines.push(`(Story: "${storyTitle}", scene: "${scene.title ?? scene.environment ?? "scene"}".)`);
  return lines.join(" ");
}

export type SubmitInput = {
  frameId: string;
  aspect: string;
};

/**
 * Resolves references, builds the prompt, submits to Atlas, and persists the
 * prediction id on the frame. Does NOT block on completion — the periodic
 * poller (and explicit syncPending calls) finalize the rendition row.
 */
export async function submitFrameForGeneration(input: SubmitInput): Promise<void> {
  const frame = await getFrame(input.frameId);
  if (!frame) throw new Error(`Frame ${input.frameId} not found`);
  const scene = await getScene(frame.sceneId);
  if (!scene) throw new Error(`Scene ${frame.sceneId} not found`);
  const story = await getStory(scene.storyId);
  if (!story) throw new Error(`Story ${scene.storyId} not found`);

  const resolved = await resolveStoryReferenceAssets(story.id, story.projectId);
  let refs = resolved.refs;
  let attachedCharNames = resolved.attachedCharNames;

  // Book-specific path: sanitize the prompt with the per-page cast, and
  // narrow the reference list to only the characters that appear on this page.
  let effectiveImagePrompt = frame.imagePrompt ?? "";
  if (story.kind === "book") {
    const { sanitizeBookPrompt, resolveCastNameMapping } = await import(
      "./sanitize-book-prompt"
    );
    const { listAllCharacters } = await import("../db/characters");
    const allChars = await listAllCharacters();
    const idToName = new Map(allChars.map((c) => [c.id, c.name]));
    const castNameMapping = resolveCastNameMapping(
      story.castMappingJson,
      idToName,
    );

    const pageCastIds = frame.castJson ?? [];
    const pageCastIdSet = new Set(pageCastIds);
    const pageCastNames = pageCastIds
      .map((id) => idToName.get(id))
      .filter((n): n is string => !!n);

    effectiveImagePrompt = sanitizeBookPrompt({
      originalPrompt: effectiveImagePrompt,
      castNameMapping,
      pageCastNames,
    });

    // Narrow refs: keep style_refs and any environment/prop, but for
    // character_primary refs only keep those whose character is in the
    // page cast. Empty page cast → keep all (fallback to story default).
    if (pageCastIds.length > 0) {
      refs = refs.filter((r) => {
        if (r.source === "character_primary") {
          return r.asset.characterId
            ? pageCastIdSet.has(r.asset.characterId)
            : false;
        }
        return true;
      });
      attachedCharNames = pageCastNames;
    }
  }

  const hasStyleRefs = refs.some((r) => r.asset.kind === "style_ref");

  // Effective style anchor: story override beats project default.
  let styleAnchorText: string | null = story.styleAnchorText ?? null;
  if (!styleAnchorText && story.projectId) {
    const project = await getProject(story.projectId);
    styleAnchorText = project?.styleAnchorText ?? null;
  }

  // For book pages the sanitizer already injected the cast line — skip the
  // generic one in buildPrompt to avoid duplication.
  const skipCastLine = story.kind === "book";
  const promptFrame =
    story.kind === "book"
      ? { ...frame, imagePrompt: effectiveImagePrompt }
      : frame;
  const prompt = buildPrompt(
    promptFrame,
    scene,
    story.title,
    hasStyleRefs,
    skipCastLine ? [] : attachedCharNames,
    styleAnchorText,
  );

  const refUrls: string[] = [];
  for (const r of refs) {
    const url = await uploadRefToAtlas(r.asset);
    if (url) refUrls.push(url);
  }

  const refSummary = refs
    .map((r, i) => {
      const tag =
        r.source === "character_primary"
          ? `char:${r.characterName ?? "?"}`
          : `attached:${r.asset.kind}`;
      const ok = i < refUrls.length;
      return `${tag}=${r.asset.name}${ok ? "" : " (upload failed)"}`;
    })
    .join(", ");

  console.log(
    `[v4 generate] frame=${frame.id} prompt=${prompt.length}ch refs=${refUrls.length}/${refs.length} [${refSummary || "none"}]`,
  );

  const submitted = await atlasSubmit({
    prompt,
    aspect: input.aspect,
    referenceImageUrls: refUrls.length > 0 ? refUrls : undefined,
    transparency: frame.transparencyMode,
  });

  const params: RenditionParams = {
    prompt,
    refs: refUrls,
    transparency: frame.transparencyMode,
    aspect: input.aspect,
  };

  await updateFrame(frame.id, {
    status: "generating",
    pendingPredictionId: submitted.predictionId,
    pendingModel: submitted.model,
    pendingParamsJson: params,
    pendingStartedAt: new Date().toISOString(),
  });

  console.log(
    `[v4 generate] frame=${frame.id} submitted prediction=${submitted.predictionId}`,
  );
}

/**
 * Polls a single pending frame once. If Atlas reports completed, downloads
 * the image, stores it, creates the rendition, and rotates currentRenditionId
 * / previousRenditionId. Cleans up the third-oldest rendition's file + row.
 */
export async function pollPendingFrame(frameId: string): Promise<Frame["status"] | "no_pending"> {
  const frame = await getFrame(frameId);
  if (!frame) return "no_pending";
  if (!frame.pendingPredictionId || !frame.pendingParamsJson) return "no_pending";

  const result = await atlasPoll(frame.pendingPredictionId);

  if (result.status !== "completed") {
    if (result.status === "failed") {
      await updateFrame(frame.id, {
        status: "error",
        pendingPredictionId: null,
        pendingModel: null,
        pendingParamsJson: null,
        pendingStartedAt: null,
      });
      console.error(`[v4 poller] frame=${frame.id} failed: ${result.error}`);
      return "error";
    }
    return "generating";
  }

  const imgRes = await fetch(result.outputUrl);
  if (!imgRes.ok) {
    console.error(`[v4 poller] CDN download failed for ${frame.id}: ${imgRes.status}`);
    return "generating";
  }
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const stored = await storagePut(
    `renditions/${frame.sceneId}/${frame.id}-${Date.now()}.jpg`,
    buffer,
  );

  const rendition = await createRendition({
    frameId: frame.id,
    imageKey: stored.key,
    imageUrl: stored.url,
    model: frame.pendingModel ?? "unknown",
    paramsJson: frame.pendingParamsJson,
  });

  const olderPreviousId = frame.previousRenditionId;
  await updateFrame(frame.id, {
    currentRenditionId: rendition.id,
    previousRenditionId: frame.currentRenditionId,
    status: "ready",
    needsRegen: false,
    pendingPredictionId: null,
    pendingModel: null,
    pendingParamsJson: null,
    pendingStartedAt: null,
  });

  if (olderPreviousId) {
    const removed = await deleteRendition(olderPreviousId);
    if (removed?.imageKey) await storageDelete(removed.imageKey);
  }

  console.log(`[v4 poller] frame=${frame.id} ready (rendition=${rendition.id})`);
  return "ready";
}

/** All frames currently waiting on an Atlas prediction. */
export async function listPendingFrames(): Promise<Frame[]> {
  return db
    .select()
    .from(framesTable)
    .where(isNotNull(framesTable.pendingPredictionId));
}
