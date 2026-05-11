import { trpc } from "../../lib/trpc";
import type { PublicAsset } from "@v4shared/types/asset-view";

type Props = {
  projectId: string;
  characterId?: string;
};

export function AssetGrid({ projectId, characterId }: Props) {
  const projectQuery = trpc.assets.listByProject.useQuery(
    { projectId },
    { enabled: !characterId },
  );
  const charQuery = trpc.assets.listByCharacter.useQuery(
    { characterId: characterId ?? "" },
    { enabled: !!characterId },
  );
  const utils = trpc.useUtils();
  const remove = trpc.assets.delete.useMutation({
    onSuccess: () => {
      utils.assets.listByProject.invalidate({ projectId });
      if (characterId) utils.assets.listByCharacter.invalidate({ characterId });
    },
  });

  const assets: PublicAsset[] = (characterId ? charQuery.data : projectQuery.data) ?? [];
  const loading = characterId ? charQuery.isLoading : projectQuery.isLoading;

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  }
  if (assets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
        No assets yet.
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
          <div className="p-3">
            <div className="truncate text-sm font-medium">{a.name}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {a.kind.replace("_", " ")}
              {a.hasEmbedding ? " · embedded" : ""}
            </div>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${a.name}"?`)) remove.mutate({ id: a.id });
              }}
              className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
