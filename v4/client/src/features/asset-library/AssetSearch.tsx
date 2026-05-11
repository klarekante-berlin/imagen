import { useState } from "react";
import { trpc } from "../../lib/trpc";

type Hit = { id: string; name: string; imageUrl: string; kind: string; score: number };

export function AssetSearch({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const search = trpc.assets.search.useMutation({
    onSuccess: (data) =>
      setHits(
        data.map((d) => ({
          id: d.id,
          name: d.name,
          imageUrl: d.imageUrl,
          kind: d.kind,
          score: d.score,
        })),
      ),
  });

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-medium">Semantic search</h3>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!query.trim()) return;
          search.mutate({ projectId, query: query.trim(), topK: 8 });
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. "tired father in kitchen"'
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={search.isPending}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {search.isPending ? "Searching…" : "Search"}
        </button>
      </form>
      {search.error && (
        <div className="mt-2 text-xs text-[var(--danger)]">{search.error.message}</div>
      )}
      {hits.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {hits.map((h) => (
            <li
              key={h.id}
              className="overflow-hidden rounded-md border border-[var(--border)]"
            >
              <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                <img src={h.imageUrl} alt={h.name} className="h-full w-full object-cover" />
              </div>
              <div className="p-2">
                <div className="truncate text-xs font-medium">{h.name}</div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {h.kind.replace("_", " ")} · {h.score.toFixed(3)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
