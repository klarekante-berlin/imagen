import { trpc } from "../lib/trpc";

function elapsedLabel(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export default function Jobs() {
  const pendingQuery = trpc.frames.listPending.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const utils = trpc.useUtils();
  const sync = trpc.frames.syncPending.useMutation({
    onSuccess: () => {
      utils.frames.listPending.invalidate();
      utils.frames.listByScene.invalidate();
    },
  });

  const pending = pendingQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Every frame waiting on an Atlas prediction. The background poller runs every
            7 seconds; you can force a check here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
        >
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {sync.data && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">
          last sync: polled {sync.data.polled} · ready {sync.data.ready} · running{" "}
          {sync.data.stillGenerating}
          {sync.data.failed > 0 && ` · failed ${sync.data.failed}`}
          {sync.data.skipped && " · (skipped — another poll was in flight)"}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
          No frames generating right now.
        </div>
      ) : (
        <ul className="space-y-2">
          {pending.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {f.textOverlay || `Frame ${f.orderIndex + 1}`}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                    {f.status}
                  </span>
                  <span>
                    elapsed: <strong>{elapsedLabel(f.pendingStartedAt)}</strong>
                  </span>
                  <code className="text-[10px]">
                    prediction: {f.pendingPredictionId?.slice(0, 12) ?? "—"}
                  </code>
                  <span className="text-[10px]">scene: {f.sceneId.slice(0, 8)}…</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
