import { useMemo, useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import { ASSET_VARIANT_KINDS, type AssetVariantKind } from "@v4shared/types/enums";

export function VariantsGrid() {
  const [kind, setKind] = useState<AssetVariantKind | "all">("all");
  const [search, setSearch] = useState("");

  const variantsQuery = trpc.assetVariants.listAll.useQuery();
  const assetsQuery = trpc.assets.list.useQuery();
  const utils = trpc.useUtils();
  const remove = trpc.assetVariants.delete.useMutation({
    onSuccess: () => {
      utils.assetVariants.listAll.invalidate();
      utils.assetVariants.stats.invalidate();
      toast.note("Variant deleted");
    },
  });

  const variants = variantsQuery.data ?? [];
  const assetById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const a of assetsQuery.data ?? []) m.set(a.id, { id: a.id, name: a.name });
    return m;
  }, [assetsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return variants.filter((v) => {
      if (kind !== "all" && v.kind !== kind) return false;
      if (q) {
        const parentName = assetById.get(v.parentAssetId)?.name ?? "";
        if (!v.name.toLowerCase().includes(q) && !parentName.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [variants, kind, search, assetById]);

  if (variantsQuery.isLoading) {
    return <div className="text-sm text-[var(--text-muted)]">Loading variants…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">Search:</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="variant / parent…"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">Kind:</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AssetVariantKind | "all")}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          >
            <option value="all">all</option>
            {ASSET_VARIANT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[var(--text-muted)]">
          {filtered.length} / {variants.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          {variants.length === 0
            ? "No variants extracted yet. Open a character_sheet asset → Variants section → Extract."
            : "Nothing matches the filters."}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((v) => {
            const parent = assetById.get(v.parentAssetId);
            return (
              <li
                key={v.id}
                className="group relative overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
                title={v.metadataJson?.visualDescription ?? v.name}
              >
                <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                  {v.imageUrl ? (
                    <img
                      src={v.imageUrl}
                      alt={v.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
                      no crop
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-2 text-[11px]">
                  <div className="truncate font-medium">{v.name}</div>
                  <div className="flex flex-wrap gap-1 text-[9px] uppercase tracking-wide">
                    <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                      {v.kind}
                    </span>
                    {v.hasEmbedding && (
                      <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                        embedded
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-[var(--text-muted)]">
                    ← {parent?.name ?? v.parentAssetId.slice(0, 8)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Delete this variant?")) remove.mutate({ id: v.id });
                  }}
                  className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white opacity-0 group-hover:opacity-100"
                  title="Delete variant"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
