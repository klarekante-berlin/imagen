import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import type { Scene } from "../../../drizzle/schema";
import { AttachmentBar } from "../features/content-canvas/AttachmentBar";
import { FrameInspector } from "../features/content-canvas/FrameInspector";
import { ManuscriptUpload } from "../features/content-canvas/ManuscriptUpload";
import { SceneColumn } from "../features/content-canvas/SceneColumn";
import { ScriptPaste } from "../features/content-canvas/ScriptPaste";
import { StyleAnchorPanel } from "../features/content-canvas/StyleAnchorPanel";
import { VariantTabs } from "../features/content-canvas/VariantTabs";
import { trpc } from "../lib/trpc";

type MoveFrameMutation = ReturnType<typeof trpc.frames.move.useMutation>;
type AddSceneMutation = ReturnType<typeof trpc.scenes.create.useMutation>;

function renderFlatCanvas(
  scenes: Scene[],
  activeFrameId: string | null,
  setActiveFrameId: (id: string | null) => void,
  moveFrame: MoveFrameMutation,
  activeVariantId: string | null,
  addScene: AddSceneMutation,
) {
  return (
    <div className="flex items-start gap-4 pb-2">
      {scenes.map((scene) => (
        <SceneColumn
          key={scene.id}
          scene={scene}
          activeFrameId={activeFrameId}
          onSelectFrame={setActiveFrameId}
          onFrameDragStart={() => {}}
          onDropFrame={(frameId, targetSceneId, targetIndex) => {
            moveFrame.mutate({ frameId, targetSceneId, targetIndex });
          }}
        />
      ))}
      {activeVariantId && (
        <button
          type="button"
          onClick={() => addScene.mutate({ storyVariantId: activeVariantId })}
          disabled={addScene.isPending}
          className="flex h-12 w-72 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
        >
          + Scene
        </button>
      )}
    </div>
  );
}

function renderBookCanvas(
  scenes: Scene[],
  activeFrameId: string | null,
  setActiveFrameId: (id: string | null) => void,
  moveFrame: MoveFrameMutation,
  activeVariantId: string | null,
  addScene: AddSceneMutation,
) {
  // Group consecutive scenes by chapterTitle/sectionKind so each chapter gets
  // its own banner row. Frontmatter/backmatter use sectionKind as the heading.
  const groups: Array<{ heading: string; scenes: Scene[] }> = [];
  let lastHeading = "__init__";
  for (const s of scenes) {
    const heading =
      s.chapterTitle ??
      (s.sectionKind === "cover"
        ? "Front cover"
        : s.sectionKind === "toc"
          ? "Table of contents"
          : s.sectionKind === "endpage"
            ? "Endpage"
            : "Pages");
    if (heading !== lastHeading) {
      groups.push({ heading, scenes: [] });
      lastHeading = heading;
    }
    groups[groups.length - 1]!.scenes.push(s);
  }

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <section key={gi}>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {g.heading}
          </div>
          <div className="flex items-start gap-4 pb-2">
            {g.scenes.map((scene) => (
              <SceneColumn
                key={scene.id}
                scene={scene}
                activeFrameId={activeFrameId}
                onSelectFrame={setActiveFrameId}
                onFrameDragStart={() => {}}
                onDropFrame={(frameId, targetSceneId, targetIndex) => {
                  moveFrame.mutate({ frameId, targetSceneId, targetIndex });
                }}
              />
            ))}
          </div>
        </section>
      ))}
      {activeVariantId && (
        <button
          type="button"
          onClick={() => addScene.mutate({ storyVariantId: activeVariantId })}
          disabled={addScene.isPending}
          className="flex h-12 w-72 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
        >
          + Page
        </button>
      )}
    </div>
  );
}

export default function ContentCanvas() {
  const [, params] = useRoute("/contents/:storyId");
  const storyId = params?.storyId ?? "";

  const storyQuery = trpc.stories.get.useQuery({ id: storyId }, { enabled: !!storyId });
  const variantsQuery = trpc.stories.listVariants.useQuery(
    { storyId },
    { enabled: !!storyId },
  );

  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);

  // Default to primary variant once data lands
  useEffect(() => {
    if (activeVariantId) return;
    const list = variantsQuery.data ?? [];
    const primary = list.find((v) => v.isPrimary) ?? list[0];
    if (primary) setActiveVariantId(primary.id);
  }, [variantsQuery.data, activeVariantId]);

  const scenesQuery = trpc.scenes.listByVariant.useQuery(
    { storyVariantId: activeVariantId ?? "" },
    { enabled: !!activeVariantId },
  );

  const utils = trpc.useUtils();
  const addScene = trpc.scenes.create.useMutation({
    onSuccess: () => {
      if (activeVariantId) {
        utils.scenes.listByVariant.invalidate({ storyVariantId: activeVariantId });
      }
    },
  });
  const moveFrame = trpc.frames.move.useMutation({
    onSuccess: () => utils.frames.listByScene.invalidate(),
  });
  const syncPending = trpc.frames.syncPending.useMutation({
    onSuccess: () => {
      utils.frames.listByScene.invalidate();
      utils.frames.listPending.invalidate();
    },
  });
  const pendingQuery = trpc.frames.listPending.useQuery(undefined, {
    refetchInterval: 7000,
  });

  if (!storyId) return <div>Story id missing.</div>;
  if (storyQuery.isLoading) return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!storyQuery.data) return <div>Story not found.</div>;

  const story = storyQuery.data;
  const scenes = scenesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        {story.projectId ? (
          <Link
            href={`/projects/${story.projectId}`}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ← Project
          </Link>
        ) : (
          <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
            ← Projects
          </Link>
        )}
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{story.title}</h1>
            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {story.kind}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            {pendingQuery.data && pendingQuery.data.length > 0 && (
              <span>
                {pendingQuery.data.length} frame
                {pendingQuery.data.length === 1 ? "" : "s"} waiting on Atlas
              </span>
            )}
            <button
              type="button"
              onClick={() => syncPending.mutate()}
              disabled={syncPending.isPending}
              title="Force a poll of every pending Atlas prediction now"
              className="rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {syncPending.isPending ? "Syncing…" : "Sync with Atlas"}
            </button>
            {syncPending.data && (
              <span>
                polled {syncPending.data.polled} · ready {syncPending.data.ready} ·
                running {syncPending.data.stillGenerating}
                {syncPending.data.failed > 0 ? ` · failed ${syncPending.data.failed}` : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      <VariantTabs
        storyId={storyId}
        activeVariantId={activeVariantId}
        onSelect={(id) => {
          setActiveVariantId(id);
          setActiveFrameId(null);
        }}
      />

      <AttachmentBar storyId={storyId} />

      <StyleAnchorPanel storyId={storyId} projectId={story.projectId} />

      {story.kind === "book" ? (
        <ManuscriptUpload
          storyId={storyId}
          variantId={activeVariantId}
          initialSourceText={story.sourceText}
          hasScenes={scenes.length > 0}
          onSplitDone={() => setActiveFrameId(null)}
        />
      ) : (
        <ScriptPaste
          storyId={storyId}
          variantId={activeVariantId}
          initialSourceText={story.sourceText}
          hasScenes={scenes.length > 0}
          onSplitDone={() => setActiveFrameId(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="overflow-x-auto">
          {story.kind === "book"
            ? renderBookCanvas(
                scenes,
                activeFrameId,
                setActiveFrameId,
                moveFrame,
                activeVariantId,
                addScene,
              )
            : renderFlatCanvas(
                scenes,
                activeFrameId,
                setActiveFrameId,
                moveFrame,
                activeVariantId,
                addScene,
              )}
          {scenes.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
              No scenes yet. {story.kind === "book" ? "Upload a manuscript to populate the book." : "Add one to start building the canvas."}
            </div>
          )}
        </div>

        <aside className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          {activeFrameId ? (
            <FrameInspector
              frameId={activeFrameId}
              onDeleted={() => setActiveFrameId(null)}
            />
          ) : (
            <div className="text-sm text-[var(--text-muted)]">
              Select a frame to edit its prompt and overlay.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
