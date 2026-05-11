import { useEffect } from "react";
import type { Frame } from "../../../../drizzle/schema";
import { trpc } from "../../lib/trpc";

type Props = {
  frame: Frame;
  isActive: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
};

const statusColor: Record<Frame["status"], string> = {
  draft: "bg-[var(--surface-muted)] text-[var(--text-muted)]",
  queued: "bg-blue-100 text-blue-700",
  generating: "bg-amber-100 text-amber-700",
  ready: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
};

export function FrameCard({ frame, isActive, onClick, onDragStart }: Props) {
  const utils = trpc.useUtils();
  // Poll while generating so the card flips to ready on completion.
  useEffect(() => {
    if (frame.status !== "generating") return;
    const t = setInterval(() => {
      utils.frames.listByScene.invalidate({ sceneId: frame.sceneId });
    }, 5000);
    return () => clearInterval(t);
  }, [frame.status, frame.sceneId, utils]);

  const renditionQuery = trpc.renditions.get.useQuery(
    { id: frame.currentRenditionId ?? "" },
    { enabled: !!frame.currentRenditionId },
  );

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`w-full rounded-md border bg-[var(--surface)] p-2 text-left transition ${
        isActive
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]"
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded bg-[var(--surface-muted)]">
        {renditionQuery.data?.imageUrl ? (
          <img
            src={renditionQuery.data.imageUrl}
            alt={frame.textOverlay ?? "frame"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
            {frame.imagePrompt ? "(prompt set)" : "(empty)"}
          </div>
        )}
        {frame.status === "generating" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-[10px] font-medium uppercase tracking-wide text-white">
            generating…
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className="truncate text-xs">
          {frame.textOverlay?.slice(0, 30) ?? "—"}
        </span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${statusColor[frame.status]}`}
        >
          {frame.status}
        </span>
      </div>
    </button>
  );
}
