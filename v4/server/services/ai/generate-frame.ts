import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assets as assetsTable,
  frames as framesTable,
  type Asset,
  type Frame,
  type Scene,
} from "../../../drizzle/schema";
import type { RenditionParams } from "../../../shared/types/domain";
import { updateCharacter } from "../db/characters";
import { getFrame, updateFrame } from "../db/frames";
import { createRendition, deleteRendition } from "../db/renditions";
import { getScene } from "../db/scenes";
import { getStory } from "../db/stories";
import { resolveStoryAttachmentContext } from "../db/story-context";
import { storageDelete, storagePut, storageRead } from "../storage";
import { atlasPoll, atlasSubmit, atlasUploadMedia } from "./atlas";

type ResolvedRef = {
  asset: Asset;
  source: "character_primary" | "attached_asset";
  characterName?: string;
};

async function loadAssetById(id: string): Promise<Asset | null> {
  const [a] = await db.select().from(assetsTable).where(eq(assetsTable.id, id)).limit(1);
  return a ?? null;
}

async function loadAssetByCharacter(characterId: string): Promise<Asset | null> {
  // First match wins. Cheap fallback when character.primaryAssetId is null.
  const [a] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.characterId, characterId), eq(assetsTable.kind, "character_sheet")))
    .limit(1);
  return a ?? null;
}

/**
 * Builds the final reference list for an Atlas edit call.
 *
 * Sources (deduplicated, preserving the first occurrence):
 *  1. For each character attached to the story (or to its project / world):
 *     use character.primaryAssetId if set; otherwise look up any
 *     character_sheet asset whose characterId points back at the character.
 *     If we find one this way, write the pointer back so the next run is
 *     direct.
 *  2. Every asset attached directly to the story or project, in any kind
 *     (character_sheet, environment, style_ref, prop, generated_frame).
 *
 * Up to 10 refs total (Atlas's edit cap). Order: character sheets first
 * (identity), then everything else.
 */
async function resolveReferenceAssets(
  scene: Scene,
  storyId: string,
  projectId: string | null,
): Promise<{
  refs: ResolvedRef[];
  attachedCharNames: string[];
}> {
  const ctx = await resolveStoryAttachmentContext(storyId, projectId);

  const refs: ResolvedRef[] = [];
  const seenAssetIds = new Set<string>();
  const attachedCharNames: string[] = [];

  // 1) Character primary sheets — with lazy backfill.
  for (const c of ctx.characters) {
    let asset: Asset | null = null;
    if (c.primaryAssetId) {
      asset = await loadAssetById(c.primaryAssetId);
    }
    if (!asset) {
      const fallback = await loadAssetByCharacter(c.id);
      if (fallback) {
        asset = fallback;
        // Backfill so subsequent runs hit the direct path.
        await updateCharacter(c.id, { primaryAssetId: fallback.id });
      }
    }
    if (!asset) continue;
    if (seenAssetIds.has(asset.id)) {
      attachedCharNames.push(c.name);
      continue;
    }
    seenAssetIds.add(asset.id);
    refs.push({ asset, source: "character_primary", characterName: c.name });
    attachedCharNames.push(c.name);
  }

  // 2) Directly attached assets — every kind passes through.
  for (const a of ctx.attachedAssets) {
    if (seenAssetIds.has(a.id)) continue;
    seenAssetIds.add(a.id);
    refs.push({ asset: a, source: "attached_asset" });
  }

  void scene;
  return { refs: refs.slice(0, 10), attachedCharNames };
}

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
 * poller (and explicit syncPending calls) finalize the rendition row.
 */
export async function submitFrameForGeneration(input: SubmitInput): Promise<void> {
  const frame = await getFrame(input.frameId);
  if (!frame) throw new Error(`Frame ${input.frameId} not found`);
  const scene = await getScene(frame.sceneId);
  if (!scene) throw new Error(`Scene ${frame.sceneId} not found`);
  const story = await getStory(scene.storyId);
  if (!story) throw new Error(`Story ${scene.storyId} not found`);

  const { refs, attachedCharNames } = await resolveReferenceAssets(
    scene,
    story.id,
    story.projectId,
  );
  const hasStyleRefs = refs.some((r) => r.asset.kind === "style_ref");

  const prompt = buildPrompt(
    frame,
    scene,
    story.title,
    hasStyleRefs,
    attachedCharNames,
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
