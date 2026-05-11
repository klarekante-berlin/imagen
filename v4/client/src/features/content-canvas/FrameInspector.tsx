import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { TRANSPARENCY_MODES, type TransparencyMode } from "@v4shared/types/enums";

type Props = {
  frameId: string;
  onDeleted: () => void;
};

export function FrameInspector({ frameId, onDeleted }: Props) {
  const frameQuery = trpc.frames.get.useQuery(
    { id: frameId },
    {
      // Poll while generating so we flip back to ready on completion.
      refetchInterval: (q) => (q.state.data?.status === "generating" ? 5000 : false),
    },
  );

  const utils = trpc.useUtils();
  const update = trpc.frames.update.useMutation({
    onSuccess: () => {
      utils.frames.get.invalidate({ id: frameId });
      utils.frames.listByScene.invalidate();
    },
  });
  const remove = trpc.frames.delete.useMutation({
    onSuccess: () => {
      utils.frames.listByScene.invalidate();
      onDeleted();
    },
  });
  const generate = trpc.frames.generate.useMutation({
    onSuccess: () => {
      utils.frames.get.invalidate({ id: frameId });
      utils.frames.listByScene.invalidate();
    },
  });
  const swap = trpc.renditions.swapFavorite.useMutation({
    onSuccess: () => {
      utils.frames.get.invalidate({ id: frameId });
      utils.frames.listByScene.invalidate();
      utils.renditions.get.invalidate();
    },
  });
  const dropPrev = trpc.renditions.dropPrevious.useMutation({
    onSuccess: () => {
      utils.frames.get.invalidate({ id: frameId });
      utils.frames.listByScene.invalidate();
    },
  });

  const currentQuery = trpc.renditions.get.useQuery(
    { id: frameQuery.data?.currentRenditionId ?? "" },
    { enabled: !!frameQuery.data?.currentRenditionId },
  );
  const previousQuery = trpc.renditions.get.useQuery(
    { id: frameQuery.data?.previousRenditionId ?? "" },
    { enabled: !!frameQuery.data?.previousRenditionId },
  );

  const [prompt, setPrompt] = useState("");
  const [overlay, setOverlay] = useState("");
  const [caption, setCaption] = useState("");
  const [transparency, setTransparency] = useState<TransparencyMode>("opaque");

  useEffect(() => {
    if (!frameQuery.data) return;
    setPrompt(frameQuery.data.imagePrompt ?? "");
    setOverlay(frameQuery.data.textOverlay ?? "");
    setCaption(frameQuery.data.caption ?? "");
    setTransparency(frameQuery.data.transparencyMode);
  }, [frameQuery.data]);

  if (frameQuery.isLoading) {
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  }
  if (!frameQuery.data) {
    return <div className="text-sm text-[var(--text-muted)]">Frame not found.</div>;
  }

  const frame = frameQuery.data;

  function save(patch: {
    imagePrompt?: string;
    textOverlay?: string;
    caption?: string;
    transparencyMode?: TransparencyMode;
  }) {
    update.mutate({ id: frameId, ...patch });
  }

  const hasLivePrediction = !!frame.pendingPredictionId;
  const isGenerating = frame.status === "generating" && hasLivePrediction;
  const isStuck = frame.status === "generating" && !hasLivePrediction;
  const canGenerate = !!frame.imagePrompt?.trim() && !isGenerating;
  const elapsedMs = frame.pendingStartedAt
    ? Date.now() - new Date(frame.pendingStartedAt).getTime()
    : 0;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const elapsedLabel =
    elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Inspector</h3>
        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          {frame.status}
        </span>
      </div>

      {(currentQuery.data || isGenerating) && (
        <div className="space-y-2">
          <div className="aspect-square overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
            {currentQuery.data ? (
              <img
                src={currentQuery.data.imageUrl}
                alt="current rendition"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-muted)]">
                generating…
              </div>
            )}
          </div>
          {previousQuery.data && (
            <div className="flex items-center gap-2">
              <div className="h-12 w-12 overflow-hidden rounded border border-[var(--border)]">
                <img
                  src={previousQuery.data.imageUrl}
                  alt="previous rendition"
                  className="h-full w-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => swap.mutate({ frameId })}
                disabled={swap.isPending}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-muted)] disabled:opacity-50"
              >
                Swap to previous
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Drop the previous rendition permanently?")) {
                    dropPrev.mutate({ frameId });
                  }
                }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                Drop
              </button>
            </div>
          )}
        </div>
      )}

      {isGenerating && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">
          Atlas running · {elapsedLabel} elapsed · prediction{" "}
          <code className="text-[10px]">{frame.pendingPredictionId?.slice(0, 12)}</code>
        </div>
      )}
      {isStuck && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">
          This frame was generating when the server lost track of the prediction.
          Re-trigger to submit a fresh Atlas job.
        </div>
      )}

      <button
        type="button"
        onClick={() => generate.mutate({ id: frameId })}
        disabled={!canGenerate || generate.isPending}
        className="w-full rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
      >
        {isGenerating
          ? "Generating…"
          : isStuck
            ? "Re-trigger generation"
            : currentQuery.data
              ? "Regenerate"
              : "Generate"}
      </button>
      {generate.error && (
        <div className="text-xs text-[var(--danger)]">{generate.error.message}</div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-muted)]">Text overlay</span>
        <input
          value={overlay}
          onChange={(e) => setOverlay(e.target.value)}
          onBlur={() => save({ textOverlay: overlay })}
          placeholder="One-liner on the image"
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-muted)]">Caption</span>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => save({ caption })}
          placeholder="Off-image text (alt / IG caption fragment)"
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-muted)]">Image prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => save({ imagePrompt: prompt })}
          rows={6}
          placeholder="Describe the image. Concrete details, characters present, mood."
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm font-mono"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>Transparency:</span>
        <select
          value={transparency}
          onChange={(e) => {
            const mode = e.target.value as TransparencyMode;
            setTransparency(mode);
            save({ transparencyMode: mode });
          }}
          className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        >
          {TRANSPARENCY_MODES.map((m) => (
            <option key={m} value={m}>
              {m.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>

      <div className="border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => {
            if (confirm("Delete this frame?")) remove.mutate({ id: frameId });
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
        >
          Delete frame
        </button>
      </div>
    </div>
  );
}
