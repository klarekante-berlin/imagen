import { eq, isNotNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assets as assetsTable,
  frames as framesTable,
  type Asset,
  type Frame,
  type Scene,
} from "../../../drizzle/schema";
import type { RenditionParams } from "../../../shared/types/domain";
import { getFrame, updateFrame } from "../db/frames";
import { createRendition, deleteRendition } from "../db/renditions";
import { getScene } from "../db/scenes";
import { getStory } from "../db/stories";
import { resolveStoryAttachmentContext } from "../db/story-context";
import { storageDelete, storagePut, storageRead } from "../storage";
import { atlasPoll, atlasSubmit, atlasUploadMedia } from "./atlas";

type RefSource = { kind: "character_sheet" | "style_ref"; asset: Asset };

async function loadAttachedRefs(scene: Scene, storyId: string, projectId: string | null) {
  const ctx = await resolveStoryAttachmentContext(storyId, projectId);

  const charRefs: RefSource[] = [];
  for (const c of ctx.characters) {
    if (!c.primaryAssetId) continue;
    const [a] = await db
      .select()
      .from(assetsTable)
      .where(eq(assetsTable.id, c.primaryAssetId))
      .limit(1);
    if (a) charRefs.push({ kind: "character_sheet", asset: a });
  }

  const styleRefs: RefSource[] = ctx.styleAssets
    .filter((a) => a.kind === "style_ref")
    .map((a) => ({ kind: "style_ref" as const, asset: a }));

  void scene;

  return { charRefs: charRefs.slice(0, 6), styleRefs, ctx };
}

async function uploadRefToAtlas(asset: Asset): Promise<string | null> {
  if (asset.imageUrl.startsWith("http")) return asset.imageUrl;
  const file = await storageRead(asset.imageKey);
  if (!file) {
    console.warn(`[v4 generate] could not read asset ${asset.id} for ref upload`);
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
): string {
  const lines: string[] = [];
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
      "STYLE AUTHORITY: copy the rendering style, color treatment, lighting, and typography exactly from the reference images marked as style sheets.",
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
 * poller (and explicit pollFrame calls) finalize the rendition row.
 */
export async function submitFrameForGeneration(input: SubmitInput): Promise<void> {
  const frame = await getFrame(input.frameId);
  if (!frame) throw new Error(`Frame ${input.frameId} not found`);
  const scene = await getScene(frame.sceneId);
  if (!scene) throw new Error(`Scene ${frame.sceneId} not found`);
  const story = await getStory(scene.storyId);
  if (!story) throw new Error(`Story ${scene.storyId} not found`);

  const { charRefs, styleRefs, ctx } = await loadAttachedRefs(
    scene,
    story.id,
    story.projectId,
  );
  const attachedCharNames = ctx.characters
    .filter((c) => charRefs.some((r) => r.asset.characterId === c.id))
    .map((c) => c.name);

  const prompt = buildPrompt(
    frame,
    scene,
    story.title,
    styleRefs.length > 0,
    attachedCharNames,
  );

  const refUrls: string[] = [];
  for (const r of [...charRefs, ...styleRefs].slice(0, 10)) {
    const url = await uploadRefToAtlas(r.asset);
    if (url) refUrls.push(url);
  }

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
    `[v4 generate] frame=${frame.id} submitted prediction=${submitted.predictionId} refs=${refUrls.length} (chars=${charRefs.length}, style=${styleRefs.length})`,
  );
}

/**
 * Polls a single pending frame once. If Atlas reports completed, downloads
 * the image, stores it, creates the rendition, and rotates currentRenditionId
 * / previousRenditionId. Cleans up the third-oldest rendition's file + row.
 * Returns the new status so callers (worker, explicit sync) can log it.
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

  // completed — download + store
  const imgRes = await fetch(result.outputUrl);
  if (!imgRes.ok) {
    console.error(`[v4 poller] CDN download failed for ${frame.id}: ${imgRes.status}`);
    return "generating"; // retry next tick
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
