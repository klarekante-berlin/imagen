import { useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import type { Frame, Scene } from "../../../../drizzle/schema";
import { FrameCard } from "./FrameCard";

type Props = {
  scene: Scene;
  activeFrameId: string | null;
  onSelectFrame: (frameId: string) => void;
  onFrameDragStart: (frameId: string) => void;
  onDropFrame: (frameId: string, targetSceneId: string, targetIndex: number) => void;
};

export function SceneColumn({
  scene,
  activeFrameId,
  onSelectFrame,
  onFrameDragStart,
  onDropFrame,
}: Props) {
  const framesQuery = trpc.frames.listByScene.useQuery({ sceneId: scene.id });
  const utils = trpc.useUtils();
  const update = trpc.scenes.update.useMutation({
    onSuccess: () => utils.scenes.listByVariant.invalidate(),
  });
  const remove = trpc.scenes.delete.useMutation({
    onSuccess: () => utils.scenes.listByVariant.invalidate(),
  });
  const addFrame = trpc.frames.create.useMutation({
    onSuccess: () => utils.frames.listByScene.invalidate({ sceneId: scene.id }),
  });
  const suggestNext = trpc.frames.suggestNext.useMutation({
    onSuccess: async (suggestion) => {
      await addFrame.mutateAsync({
        sceneId: scene.id,
        textOverlay: suggestion.textOverlay,
        caption: suggestion.caption,
        imagePrompt: suggestion.imagePrompt,
      });
      toast.success("Frame suggested", suggestion.reasoning);
    },
    onError: (err) => toast.error("Suggest failed", err.message),
  });
  const generateScene = trpc.frames.generateScene.useMutation({
    onSuccess: (result) => {
      toast.success(
        "Scene generation submitted",
        `${result.submitted} frame${result.submitted === 1 ? "" : "s"} → Atlas`,
      );
      utils.frames.listByScene.invalidate({ sceneId: scene.id });
    },
    onError: (err) => toast.error("Generate scene failed", err.message),
  });

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(scene.title ?? "");
  const [draftEnv, setDraftEnv] = useState(scene.environment ?? "");
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const frames: Frame[] = framesQuery.data ?? [];

  function commitHeader() {
    setEditing(false);
    if (draftTitle !== (scene.title ?? "") || draftEnv !== (scene.environment ?? "")) {
      update.mutate({
        id: scene.id,
        title: draftTitle || undefined,
        environment: draftEnv || undefined,
      });
    }
  }

  return (
    <div
      className="flex w-72 flex-shrink-0 flex-col rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const frameId = e.dataTransfer.getData("text/frame-id");
        if (!frameId) return;
        const target = dragOverIdx ?? frames.length;
        setDragOverIdx(null);
        onDropFrame(frameId, scene.id, target);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="flex-1 space-y-1">
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Scene title"
              className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm font-medium"
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHeader();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <input
              value={draftEnv}
              onChange={(e) => setDraftEnv(e.target.value)}
              placeholder="Environment (e.g. Auto, dunkel)"
              className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
              onBlur={commitHeader}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHeader();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftTitle(scene.title ?? "");
              setDraftEnv(scene.environment ?? "");
              setEditing(true);
            }}
            className="flex-1 text-left"
            title="Click to edit"
          >
            <div className="flex flex-wrap items-baseline gap-1.5">
              {scene.pageNumber !== null && scene.pageNumber !== undefined && (
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  p{scene.pageNumber}
                </span>
              )}
              <div className="text-sm font-medium">
                {scene.title || `Scene ${scene.orderIndex + 1}`}
              </div>
              {scene.sectionKind && (
                <span className="rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                  {scene.sectionKind.replace("_", " ")}
                </span>
              )}
            </div>
            {scene.environment && (
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                {scene.environment}
              </div>
            )}
          </button>
        )}
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this scene with all its frames?")) {
                remove.mutate({ id: scene.id });
              }
            }}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
            title="Delete scene"
          >
            ×
          </button>
          <button
            type="button"
            onClick={() => generateScene.mutate({ sceneId: scene.id })}
            disabled={generateScene.isPending || frames.length === 0}
            title="Submit every frame in this scene to Atlas in parallel"
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {generateScene.isPending ? "submitting…" : "generate all"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {frames.map((f, i) => (
          <div
            key={f.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIdx(i);
            }}
            onDragLeave={() => setDragOverIdx((v) => (v === i ? null : v))}
          >
            {dragOverIdx === i && (
              <div className="mb-2 h-1 rounded bg-[var(--accent)]" />
            )}
            <FrameCard
              frame={f}
              isActive={f.id === activeFrameId}
              onClick={() => onSelectFrame(f.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/frame-id", f.id);
                e.dataTransfer.effectAllowed = "move";
                onFrameDragStart(f.id);
              }}
            />
          </div>
        ))}
        {dragOverIdx === frames.length && (
          <div className="h-1 rounded bg-[var(--accent)]" />
        )}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => suggestNext.mutate({ sceneId: scene.id })}
            disabled={suggestNext.isPending || addFrame.isPending}
            title="Let Claude propose the next frame based on the scene so far"
            className="flex-1 rounded-md border border-dashed border-[var(--border)] py-2 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {suggestNext.isPending ? "AI drafting…" : "✨ Suggest"}
          </button>
          {frames.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const last = frames[frames.length - 1];
                addFrame.mutate({
                  sceneId: scene.id,
                  cloneFromFrameId: last?.id,
                });
              }}
              disabled={addFrame.isPending}
              title="Add a frame pre-filled from the last one"
              className="rounded-md border border-dashed border-[var(--border)] px-2 py-2 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
            >
              clone
            </button>
          )}
          <button
            type="button"
            onClick={() => addFrame.mutate({ sceneId: scene.id })}
            disabled={addFrame.isPending}
            title="Add an empty frame"
            className="rounded-md border border-dashed border-[var(--border)] px-2 py-2 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
          >
            empty
          </button>
        </div>
        {suggestNext.error && (
          <div className="mt-1 text-[10px] text-[var(--danger)]">{suggestNext.error.message}</div>
        )}
      </div>
    </div>
  );
}
