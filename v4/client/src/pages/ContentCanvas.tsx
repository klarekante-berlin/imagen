import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { FrameInspector } from "../features/content-canvas/FrameInspector";
import { SceneColumn } from "../features/content-canvas/SceneColumn";
import { VariantTabs } from "../features/content-canvas/VariantTabs";
import { trpc } from "../lib/trpc";

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
        <div className="mt-1 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{story.title}</h1>
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            {story.kind}
          </span>
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

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="overflow-x-auto">
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
          {scenes.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
              No scenes yet. Add one to start building the canvas.
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
