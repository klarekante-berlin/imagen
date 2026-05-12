import { trpc } from "../../lib/trpc";

function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function LibraryStats() {
  const assetStats = trpc.assets.libraryStats.useQuery();
  const variantStats = trpc.assetVariants.stats.useQuery();
  const a = assetStats.data;
  const v = variantStats.data;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Library diagnostics</h3>
        <div className="flex gap-2 text-[10px]">
          <KeyBadge label="Voyage" ok={a?.voyageConfigured} />
          <KeyBadge label="Anthropic" ok={a?.anthropicConfigured} />
          <KeyBadge label="Atlas" ok={a?.atlasConfigured} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock
          label="Assets"
          value={a?.total ?? "—"}
          sub={
            a
              ? `${a.embedded} embedded · ${a.withVisualDescription} described`
              : "—"
          }
        />
        <StatBlock
          label="Pending vision"
          value={
            a
              ? a.total - a.withVisualDescription
              : "—"
          }
          sub={a ? `${a.total - a.withVisionConfidence} no confidence` : "—"}
        />
        <StatBlock
          label="Variants"
          value={v?.total ?? "—"}
          sub={
            v
              ? `${v.embedded} embedded · ${v.distinctParents} parents`
              : "—"
          }
        />
        <StatBlock
          label="Last asset update"
          value={relTime(a?.lastUpdated)}
          sub={
            a?.byKind
              ? Object.entries(a.byKind)
                  .map(([k, n]) => `${k.replace("_", " ")}:${n}`)
                  .join(" · ")
              : "—"
          }
        />
      </div>
      {a && !a.voyageConfigured && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-[11px] text-amber-700">
          VOYAGE_API_KEY not set — embeddings are skipped on upload and
          semantic search is disabled.
        </div>
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && (
        <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

function KeyBadge({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 ${
        ok
          ? "border-[var(--border)] text-[var(--text-muted)]"
          : "border-amber-400 text-amber-700"
      }`}
      title={`${label} API key ${ok ? "configured" : "MISSING"}`}
    >
      {label}: {ok ? "ok" : "off"}
    </span>
  );
}
