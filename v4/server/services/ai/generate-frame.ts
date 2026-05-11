import { eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  assets as assetsTable,
  frames as framesTable,
  type Asset,
  type Frame,
  type Scene,
} from "../../../drizzle/schema";
import { getFrame, updateFrame } from "../db/frames";
import { createRendition, deleteRendition } from "../db/renditions";
import { getScene } from "../db/scenes";
import { getStory } from "../db/stories";
import { resolveStoryAttachmentContext } from "../db/story-context";
import { storageDelete, storagePut, storageRead } from "../storage";
import { atlasGenerate, atlasUploadMedia } from "./atlas";

type RefSource = { kind: "character_sheet" | "style_ref"; asset: Asset };

async function loadAttachedRefs(scene: Scene, storyId: string, projectId: string | null) {
  const ctx = await resolveStoryAttachmentContext(storyId, projectId);

  // 1. Character primary assets — up to 6 for identity
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

  // 2. Style refs from attached assets — fill remaining slots up to 10
  const styleRefs: RefSource[] = ctx.styleAssets
    .filter((a) => a.kind === "style_ref")
    .map((a) => ({ kind: "style_ref" as const, asset: a }));

  // Mark scene env so the caller can mention it (no asset for now; future:
  // pull scene.environmentRefAssetId once we add it).
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

type GenerateFrameInput = {
  frameId: string;
  aspect: string;
  variantName?: string;
};

export async function generateFrameInline(input: GenerateFrameInput): Promise<void> {
  const frame = await getFrame(input.frameId);
  if (!frame) throw new Error(`Frame ${input.frameId} not found`);
  const scene = await getScene(frame.sceneId);
  if (!scene) throw new Error(`Scene ${frame.sceneId} not found`);
  const story = await getStory(scene.storyId);
  if (!story) throw new Error(`Story ${scene.storyId} not found`);

  // Resolve refs (characters' primary sheets + style refs).
  const { charRefs, styleRefs, ctx } = await loadAttachedRefs(
    scene,
    story.id,
    story.projectId,
  );

  // Mention the characters whose sheets we're attaching.
  const attachedCharNames = ctx.characters
    .filter((c) => charRefs.some((r) => r.asset.characterId === c.id))
    .map((c) => c.name);

  // Build the prompt.
  const prompt = buildPrompt(
    frame,
    scene,
    story.title,
    styleRefs.length > 0,
    attachedCharNames,
  );

  // Upload refs to Atlas (or pass through if already http). Drop any that fail.
  const refUrls: string[] = [];
  for (const r of [...charRefs, ...styleRefs].slice(0, 10)) {
    const url = await uploadRefToAtlas(r.asset);
    if (url) refUrls.push(url);
  }

  console.log(
    `[v4 generate] frame=${frame.id} prompt=${prompt.length}ch refs=${refUrls.length} (chars=${charRefs.length}, style=${styleRefs.length})`,
  );

  const result = await atlasGenerate({
    prompt,
    aspect: input.aspect,
    referenceImageUrls: refUrls.length > 0 ? refUrls : undefined,
    transparency: frame.transparencyMode,
    onStatus: (status, elapsed) =>
      console.log(`[v4 generate] frame=${frame.id} ${status} (${elapsed}s)`),
  });

  // Download the image from Atlas CDN.
  const imgRes = await fetch(result.outputUrl);
  if (!imgRes.ok) throw new Error(`Atlas CDN download failed: ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Store locally + return a /v4-storage URL.
  const stored = await storagePut(
    `renditions/${frame.sceneId}/${frame.id}-${Date.now()}.jpg`,
    buffer,
  );

  // Persist the rendition + rotate frame's current/previous pointers.
  const rendition = await createRendition({
    frameId: frame.id,
    imageKey: stored.key,
    imageUrl: stored.url,
    model: result.model,
    paramsJson: {
      prompt,
      refs: refUrls,
      transparency: frame.transparencyMode,
      aspect: input.aspect,
    },
  });

  // Rotate: previous := old current; current := new. If there was an older
  // previous, delete it (its row and its image bytes).
  const olderPreviousId = frame.previousRenditionId;
  await updateFrame(frame.id, {
    currentRenditionId: rendition.id,
    previousRenditionId: frame.currentRenditionId,
    status: "ready",
    needsRegen: false,
  });

  if (olderPreviousId) {
    const removed = await deleteRendition(olderPreviousId);
    if (removed?.imageKey) await storageDelete(removed.imageKey);
  }

  // Mark frame as ready (already set above).
  await db
    .update(framesTable)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(framesTable.id, frame.id));
}
