import { useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

type Hit = {
  type: "asset" | "variant";
  id: string;
  name: string;
  imageUrl: string;
  kind: string;
  parentAssetId: string | null;
  parentAssetName: string | null;
  score: number;
};

export function GlobalAssetSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [includeVariants, setIncludeVariants] = useState(true);

  const search = trpc.assets.searchGlobal.useMutation({
    onSuccess: (data) => setHits(data as Hit[]),
    onError: (err) => toast.error("Search failed", err.message),
  });

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-medium">Library-wide semantic search</h3>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        Cosine match over Voyage multimodal embeddings across all assets and
        variants — no project / world scoping. Score 0–1; higher is closer.
      </p>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!query.trim()) return;
          search.mutate({
            query: query.trim(),
            topK: 12,
            includeVariants,
          });
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. "papa lächelnd"'
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={includeVariants}
            onChange={(e) => setIncludeVariants(e.target.checked)}
          />
          variants
        </label>
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
      {search.isSuccess && hits.length === 0 && (
        <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
          No hits. Either no asset has an embedding (check stats panel above) or
          the query doesn't match any embedded item.
        </div>
      )}
      {hits.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {hits.map((h) => (
            <li
              key={`${h.type}:${h.id}`}
              className="overflow-hidden rounded-md border border-[var(--border)]"
            >
              <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                {h.imageUrl ? (
                  <img
                    src={h.imageUrl}
                    alt={h.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
                    no img
                  </div>
                )}
              </div>
              <div className="p-2 text-[11px]">
                <div className="flex items-center gap-1">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                      h.type === "variant"
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                    }`}
                  >
                    {h.type}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
                    {h.score.toFixed(3)}
                  </span>
                </div>
                <div className="mt-1 truncate font-medium">{h.name}</div>
                <div className="truncate text-[10px] text-[var(--text-muted)]">
                  {h.kind.replace("_", " ")}
                  {h.parentAssetName && (
                    <>
                      <br />← {h.parentAssetName}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
