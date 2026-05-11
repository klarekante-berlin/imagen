import { useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

type SuggestedFrame = {
  textOverlay?: string;
  caption?: string;
  imagePrompt: string;
};

type SuggestedScene = {
  title: string;
  environment?: string;
  environmentLockNotes?: string;
  transitionToNext?: string;
  characters: string[];
  frames: SuggestedFrame[];
};

type Props = {
  storyId: string;
  variantId: string;
  initialScenes: SuggestedScene[];
  reasoning: string;
  hasExistingScenes: boolean;
  onClose: () => void;
  onApplied: () => void;
};

export function OutlinePreview({
  storyId,
  variantId,
  initialScenes,
  reasoning,
  hasExistingScenes,
  onClose,
  onApplied,
}: Props) {
  const [scenes, setScenes] = useState<SuggestedScene[]>(initialScenes);
  const utils = trpc.useUtils();
  const apply = trpc.stories.applySplit.useMutation({
    onSuccess: (result) => {
      toast.success(
        "Outline applied",
        `${result.sceneCount} scene${result.sceneCount === 1 ? "" : "s"} · ${result.frameCount} frames`,
      );
      utils.scenes.listByVariant.invalidate({ storyVariantId: variantId });
      utils.frames.listByScene.invalidate();
      onApplied();
    },
    onError: (err) => toast.error("Apply failed", err.message),
  });

  function updateScene(idx: number, patch: Partial<SuggestedScene>) {
    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function updateFrame(sceneIdx: number, frameIdx: number, patch: Partial<SuggestedFrame>) {
    setScenes((prev) =>
      prev.map((s, i) =>
        i === sceneIdx
          ? { ...s, frames: s.frames.map((f, j) => (j === frameIdx ? { ...f, ...patch } : f)) }
          : s,
      ),
    );
  }
  function removeScene(idx: number) {
    setScenes((prev) => prev.filter((_, i) => i !== idx));
  }
  function removeFrame(sceneIdx: number, frameIdx: number) {
    setScenes((prev) =>
      prev.map((s, i) =>
        i === sceneIdx ? { ...s, frames: s.frames.filter((_, j) => j !== frameIdx) } : s,
      ),
    );
  }
  function moveScene(idx: number, delta: number) {
    setScenes((prev) => {
      const next = [...prev];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }
  function addFrame(sceneIdx: number) {
    setScenes((prev) =>
      prev.map((s, i) =>
        i === sceneIdx
          ? { ...s, frames: [...s.frames, { imagePrompt: "", textOverlay: "" }] }
          : s,
      ),
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 p-4">
      <div
        className="m-auto flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">Outline preview</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Edit, reorder or remove anything before committing. {scenes.length} scene
              {scenes.length === 1 ? "" : "s"} ·{" "}
              {scenes.reduce((n, s) => n + s.frames.length, 0)} frames total.
            </p>
            {reasoning && (
              <p className="mt-1 text-[11px] italic text-[var(--text-muted)]">
                Claude's reasoning: {reasoning}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {scenes.map((scene, si) => (
            <div
              key={si}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  Scene {si + 1}
                </span>
                <input
                  value={scene.title}
                  onChange={(e) => updateScene(si, { title: e.target.value })}
                  className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm font-medium"
                  placeholder="Scene title"
                />
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => moveScene(si, -1)}
                    disabled={si === 0}
                    className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScene(si, 1)}
                    disabled={si === scenes.length - 1}
                    className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeScene(si)}
                    className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  value={scene.environment ?? ""}
                  onChange={(e) => updateScene(si, { environment: e.target.value })}
                  placeholder="Environment (e.g. Berlin park)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                />
                <input
                  value={scene.environmentLockNotes ?? ""}
                  onChange={(e) => updateScene(si, { environmentLockNotes: e.target.value })}
                  placeholder="Lock notes (what stays consistent)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                />
              </div>
              {scene.characters.length > 0 && (
                <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Characters: {scene.characters.join(", ")}
                </div>
              )}

              <div className="mt-3 space-y-2">
                {scene.frames.map((frame, fi) => (
                  <div
                    key={fi}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        Frame {fi + 1}
                      </span>
                      <input
                        value={frame.textOverlay ?? ""}
                        onChange={(e) =>
                          updateFrame(si, fi, { textOverlay: e.target.value })
                        }
                        placeholder="Text overlay"
                        className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => removeFrame(si, fi)}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      value={frame.imagePrompt}
                      onChange={(e) => updateFrame(si, fi, { imagePrompt: e.target.value })}
                      rows={2}
                      placeholder="Image prompt — what the frame shows"
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addFrame(si)}
                  className="w-full rounded-md border border-dashed border-[var(--border)] py-1 text-[11px] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                >
                  + Frame
                </button>
              </div>
            </div>
          ))}
          {scenes.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
              Outline is empty. Cancel to start over.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">
            {hasExistingScenes && "Applying will replace the current scenes & frames."}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                apply.mutate({
                  storyId,
                  variantId,
                  scenes,
                })
              }
              disabled={apply.isPending || scenes.length === 0}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {apply.isPending ? "Applying…" : "Apply outline"}
            </button>
          </div>
        </div>
        {apply.error && (
          <div className="border-t border-[var(--border)] bg-red-50 px-4 py-2 text-xs text-[var(--danger)]">
            {apply.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
