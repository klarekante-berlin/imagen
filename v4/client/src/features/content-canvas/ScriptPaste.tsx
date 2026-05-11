import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { OutlinePreview } from "./OutlinePreview";

type Props = {
  storyId: string;
  variantId: string | null;
  initialSourceText: string;
  hasScenes: boolean;
  onSplitDone: () => void;
};

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
  const [preview, setPreview] = useState<
    | null
    | { scenes: SuggestedScene[]; reasoning: string }
  >(null);

  useEffect(() => {
    setDraft(initialSourceText);
  }, [initialSourceText]);

  const previewSplit = trpc.stories.previewSplit.useMutation({
    onSuccess: (result) => {
      setError(null);
      setPreview({ scenes: result.scenes, reasoning: result.reasoning });
      const cacheHit = result.usage.cacheReadInputTokens ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[preview] ${result.scenes.length} scenes · ${result.usage.inputTokens} in / ${result.usage.outputTokens} out${cacheHit > 0 ? ` · cache hit ${cacheHit.toLocaleString()}` : ""}`,
      );
    },
    onError: (err) => setError(err.message),
  });

  if (!variantId) return null;

  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <>
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Source script</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Paste your script. Click <strong>Preview outline</strong> to see Claude's plan
              and edit it before committing.
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
                    · applying an outline will replace current scenes
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  previewSplit.mutate({ storyId, sourceText: draft });
                }}
                disabled={previewSplit.isPending || wordCount === 0}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
              >
                {previewSplit.isPending ? "Drafting outline…" : "Preview outline"}
              </button>
            </div>
            {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          </div>
        )}
      </div>

      {preview && variantId && (
        <OutlinePreview
          storyId={storyId}
          variantId={variantId}
          initialScenes={preview.scenes}
          reasoning={preview.reasoning}
          hasExistingScenes={hasScenes}
          onClose={() => setPreview(null)}
          onApplied={() => {
            setPreview(null);
            setOpen(false);
            onSplitDone();
          }}
        />
      )}
    </>
  );
}
