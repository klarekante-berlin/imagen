import { trpc } from "../../lib/trpc";
import type { PublicAsset } from "@v4shared/types/asset-view";
import type { AssetKind } from "@v4shared/types/enums";
import { CharacterAssignCell } from "./CharacterAssignCell";

type Props = {
  kinds?: AssetKind[];
};

export function AssetGridGlobal({ kinds }: Props) {
  const query = trpc.assets.list.useQuery(kinds ? { kinds } : undefined);
  const worldsQuery = trpc.worlds.list.useQuery();
  const utils = trpc.useUtils();
  const update = trpc.assets.update.useMutation({
    onSuccess: () => utils.assets.list.invalidate(),
  });
  const remove = trpc.assets.delete.useMutation({
    onSuccess: () => utils.assets.list.invalidate(),
  });

  const assets: PublicAsset[] = query.data ?? [];
  const worlds = worldsQuery.data ?? [];

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
    <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {assets.map((a) => (
        <li
          key={a.id}
          className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
        >
          <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
            <img
              src={a.imageUrl}
              alt={a.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="space-y-2 p-3">
            <div className="truncate text-sm font-medium">{a.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {a.kind.replace("_", " ")}
              {a.hasEmbedding ? " · embedded" : ""}
            </div>
            <CharacterAssignCell asset={a} />
            <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span>World:</span>
              <select
                value={a.worldId ?? ""}
                onChange={(e) =>
                  update.mutate({
                    id: a.id,
                    worldId: e.target.value === "" ? null : e.target.value,
                  })
                }
                className="flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[11px]"
              >
                <option value="">—</option>
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${a.name}"?`)) remove.mutate({ id: a.id });
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
