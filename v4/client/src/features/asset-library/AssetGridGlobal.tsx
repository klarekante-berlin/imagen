import { useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import type { PublicAsset } from "@v4shared/types/asset-view";
import type { AssetKind } from "@v4shared/types/enums";
import { AssetDrawer } from "./AssetDrawer";

type Props = {
  /** Optional kind filter passed to the server. */
  kinds?: AssetKind[];
  /** Pre-filtered assets — when provided, skips the server query and renders these. */
  filteredAssets?: PublicAsset[];
};

function formatBytes(b?: number | null): string | null {
  if (!b) return null;
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1_000) return `${Math.round(b / 1_000)} KB`;
  return `${b} B`;
}

export function AssetGridGlobal({ kinds, filteredAssets }: Props) {
  const utils = trpc.useUtils();
  const query = trpc.assets.list.useQuery(kinds ? { kinds } : undefined, {
    enabled: !filteredAssets,
  });
  const charactersQuery = trpc.characters.list.useQuery();
  const worldsQuery = trpc.worlds.list.useQuery();
  const assets: PublicAsset[] = filteredAssets ?? query.data ?? [];
  const characters = charactersQuery.data ?? [];
  const worlds = worldsQuery.data ?? [];

  const [openAsset, setOpenAsset] = useState<PublicAsset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const invalidate = () => {
    utils.assets.list.invalidate();
    utils.assets.listByProject.invalidate();
    utils.assets.listByWorld.invalidate();
  };

  const bulkDelete = trpc.assets.bulkDelete.useMutation({
    onSuccess: (r) => {
      invalidate();
      setSelected(new Set());
      toast.success(
        `Deleted ${r.ok} asset${r.ok === 1 ? "" : "s"}`,
        r.failed ? `${r.failed} failed` : undefined,
      );
    },
    onError: (err) => toast.error("Bulk delete failed", err.message),
  });
  const bulkCategorize = trpc.assets.bulkCategorize.useMutation({
    onSuccess: (r) => {
      invalidate();
      setSelected(new Set());
      toast.success(
        `Re-categorized ${r.ok} asset${r.ok === 1 ? "" : "s"}`,
        r.failed ? `${r.failed} failed` : undefined,
      );
    },
    onError: (err) => toast.error("Bulk categorize failed", err.message),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!filteredAssets && query.isLoading) {
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  }
  if (assets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
        {filteredAssets ? "Nothing matches the filters." : "Library is empty."}
      </div>
    );
  }

  const allVisibleSelected =
    selected.size > 0 && assets.every((a) => selected.has(a.id));

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-sm">
          <span className="font-medium">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() =>
              setSelected(
                allVisibleSelected ? new Set() : new Set(assets.map((a) => a.id)),
              )
            }
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {allVisibleSelected ? "Clear" : `Select all ${assets.length}`}
          </button>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={bulkCategorize.isPending}
              onClick={() =>
                bulkCategorize.mutate({ ids: Array.from(selected) })
              }
              className="rounded-md border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50"
              title="Re-run Claude vision over each selected asset"
            >
              {bulkCategorize.isPending
                ? `Categorizing… (${selected.size})`
                : `✨ Re-categorize (${selected.size})`}
            </button>
            <button
              type="button"
              disabled={bulkDelete.isPending}
              onClick={() => {
                if (
                  !confirm(
                    `Delete ${selected.size} asset${selected.size === 1 ? "" : "s"}? This removes the files from storage too.`,
                  )
                )
                  return;
                bulkDelete.mutate({ ids: Array.from(selected) });
              }}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--surface-muted)] hover:text-red-700 disabled:opacity-50"
            >
              {bulkDelete.isPending ? `Deleting…` : `Delete (${selected.size})`}
            </button>
          </span>
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((a) => {
          const charName = a.characterId
            ? characters.find((c) => c.id === a.characterId)?.name
            : null;
          const worldName = a.worldId
            ? worlds.find((w) => w.id === a.worldId)?.name
            : null;
          const meta = a.metadataJson;
          const size = formatBytes(meta?.bytes);
          const dims = meta?.width && meta?.height ? `${meta.width}×${meta.height}` : null;
          const isSelected = selected.has(a.id);
          const hasSuggestion = !a.characterId && !!meta?.inferredCharacterName;
          return (
            <li
              key={a.id}
              className={`group relative cursor-pointer overflow-hidden rounded-md border bg-[var(--surface)] ${
                isSelected
                  ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                  : "border-[var(--border)] hover:border-[var(--border-strong)]"
              }`}
              onClick={(e) => {
                if (e.shiftKey || e.metaKey || e.ctrlKey || selected.size > 0) {
                  toggle(a.id);
                  return;
                }
                setOpenAsset(a);
              }}
            >
              <button
                type="button"
                aria-label={isSelected ? "Deselect" : "Select"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(a.id);
                }}
                className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-[var(--surface)] text-[10px] leading-none ${
                  isSelected
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-[var(--border)] opacity-0 group-hover:opacity-100"
                }`}
              >
                {isSelected ? "✓" : ""}
              </button>

              <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                <img
                  src={a.imageUrl}
                  alt={a.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="space-y-1.5 p-3">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="flex flex-wrap gap-1 text-[9px] uppercase tracking-wide">
                  <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                    {a.kind.replace("_", " ")}
                  </span>
                  {charName && (
                    <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                      char: {charName}
                    </span>
                  )}
                  {worldName && (
                    <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                      world: {worldName}
                    </span>
                  )}
                  {hasSuggestion && (
                    <span
                      className="rounded-full border border-[var(--accent)] bg-[var(--surface)] px-1.5 py-0.5 normal-case text-[var(--accent)]"
                      title={`Vision suggests binding to character "${meta?.inferredCharacterName}". Open to accept or dismiss.`}
                    >
                      ? bind {meta?.inferredCharacterName}
                    </span>
                  )}
                  {a.hasEmbedding && (
                    <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                      embedded
                    </span>
                  )}
                </div>
                {(dims || size) && (
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {dims}
                    {dims && size && " · "}
                    {size}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {openAsset && (
        <AssetDrawer
          asset={
            assets.find((x) => x.id === openAsset.id) ?? openAsset
          }
          onClose={() => setOpenAsset(null)}
        />
      )}
    </>
  );
}
