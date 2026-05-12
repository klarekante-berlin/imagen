import { getFrame } from "../db/frames";
import { getRendition } from "../db/renditions";
import { getScene, listScenesForVariant } from "../db/scenes";
import { getStory } from "../db/stories";
import { storagePut, storageRead } from "../storage";
import { composeBookPage } from "./book-page";
import { db } from "../../_core/db";
import { eq } from "drizzle-orm";
import { renditions } from "../../../drizzle/schema";

/**
 * Re-renders the page composition for an existing book-frame rendition. Uses
 * the stored raw illustration (no Atlas call). Replaces the rendition's
 * imageKey with the freshly composed page.
 */
export async function recomposeBookPageForFrame(frameId: string): Promise<void> {
  const frame = await getFrame(frameId);
  if (!frame) throw new Error(`Frame ${frameId} not found`);
  if (!frame.currentRenditionId) {
    throw new Error("Frame has no current rendition — generate one first");
  }
  const rendition = await getRendition(frame.currentRenditionId);
  if (!rendition) throw new Error("Current rendition not found");
  if (!rendition.rawIllustrationKey) {
    throw new Error(
      "This rendition was generated before the post-compose pipeline existed. Regenerate the frame to enable re-compose.",
    );
  }

  const scene = await getScene(frame.sceneId);
  if (!scene) throw new Error("Scene not found");
  if (!scene.sectionKind) {
    throw new Error("Scene has no section_kind — only book scenes can be re-composed");
  }
  const story = await getStory(scene.storyId);
  if (!story) throw new Error("Story not found");

  const file = await storageRead(rendition.rawIllustrationKey);
  if (!file) throw new Error("Raw illustration file missing from storage");

  let chapters: string[] | undefined;
  if (scene.sectionKind === "toc" && scene.storyVariantId) {
    const all = await listScenesForVariant(scene.storyVariantId);
    chapters = Array.from(
      new Set(
        all
          .map((s) => s.chapterTitle)
          .filter((c): c is string => !!c && c !== "(Front matter)"),
      ),
    );
  }

  const composed = await composeBookPage({
    illustrationBuffer: file.buffer,
    pageText: frame.caption ?? "",
    sectionKind: scene.sectionKind,
    pageNumber: scene.pageNumber ?? null,
    chapterTitle: scene.chapterTitle ?? null,
    bookTitle: story.title,
    chapters,
  });

  const stored = await storagePut(
    `renditions/${frame.sceneId}/${frame.id}-${Date.now()}-recompose.jpg`,
    composed,
  );
  await db
    .update(renditions)
    .set({ imageKey: stored.key, imageUrl: stored.url })
    .where(eq(renditions.id, rendition.id));
}
