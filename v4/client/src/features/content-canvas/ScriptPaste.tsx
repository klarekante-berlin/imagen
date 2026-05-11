import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";

type Props = {
  storyId: string;
  variantId: string | null;
  initialSourceText: string;
  hasScenes: boolean;
  onSplitDone: () => void;
};

export function ScriptPaste({
  storyId,
  variantId,
  initialSourceText,
  hasScenes,
  onSplitDone,
}: Props) {
  const [draft, setDraft] = useState(initialSourceText);
  const [open, setOpen] = useState(!hasScenes && initialSourceText.length === 0);
  const [error, setError] = useState<string | null>(null);

  // Sync when story changes
  useEffect(() => {
    setDraft(initialSourceText);
  }, [initialSourceText]);

  const utils = trpc.useUtils();
  const split = trpc.stories.split.useMutation({
    onSuccess: (result) => {
      setError(null);
      setOpen(false);
      utils.scenes.listByVariant.invalidate();
      utils.frames.listByScene.invalidate();
      utils.stories.get.invalidate({ id: storyId });
      onSplitDone();
      const cacheHit = result.usage.cacheReadInputTokens ?? 0;
      const cacheLine =
        cacheHit > 0
          ? ` · cache hit ${cacheHit.toLocaleString()} tokens`
          : "";
      // eslint-disable-next-line no-console
      console.log(
        `[split] ${result.sceneCount} scenes, ${result.frameCount} frames · ${result.usage.inputTokens} in / ${result.usage.outputTokens} out${cacheLine}`,
      );
    },
    onError: (err) => setError(err.message),
  });

  if (!variantId) return null;

  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Source script</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Paste your script here. Claude will split it into scenes and frames.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          {!open && initialSourceText && (
            <span>{initialSourceText.trim().split(/\s+/).length} words</span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-muted)]"
          >
            {open ? "Hide" : initialSourceText ? "Edit" : "Paste"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            placeholder="# EP01 — Dein Kind stolpert nicht…"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs"
          />
          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--text-muted)]">
              {wordCount > 0 ? `${wordCount} words` : "Empty"}
              {hasScenes && (
                <span className="ml-2 text-[var(--danger)]">
                  · running split will replace the current {hasScenes ? "scenes" : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                split.mutate({
                  storyId,
                  variantId,
                  sourceText: draft,
                });
              }}
              disabled={split.isPending || wordCount === 0}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {split.isPending ? "Splitting…" : hasScenes ? "Re-split" : "Split into scenes"}
            </button>
          </div>
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
        </div>
      )}
    </div>
  );
}
