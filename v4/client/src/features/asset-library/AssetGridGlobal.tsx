import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { PublicAsset } from "@v4shared/types/asset-view";
import type { AssetKind } from "@v4shared/types/enums";
import { AssetDrawer } from "./AssetDrawer";

type Props = {
  kinds?: AssetKind[];
};

function formatBytes(b?: number | null): string | null {
  if (!b) return null;
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1_000) return `${Math.round(b / 1_000)} KB`;
  return `${b} B`;
}

export function AssetGridGlobal({ kinds }: Props) {
  const query = trpc.assets.list.useQuery(kinds ? { kinds } : undefined);
  const charactersQuery = trpc.characters.list.useQuery();
  const worldsQuery = trpc.worlds.list.useQuery();
  const assets: PublicAsset[] = query.data ?? [];
  const characters = charactersQuery.data ?? [];
  const worlds = worldsQuery.data ?? [];

  const [openAsset, setOpenAsset] = useState<PublicAsset | null>(null);

  if (query.isLoading) {
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  }
  if (assets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
        Library is empty.
      </div>
    );
  }

  return (
    <>
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
          return (
            <li
              key={a.id}
              className="cursor-pointer overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
              onClick={() => setOpenAsset(a)}
            >
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
