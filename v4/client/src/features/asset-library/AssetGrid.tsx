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
  const charactersQuery = trpc.characters.listByProject.useQuery(
    { projectId },
    { enabled: !characterId },
  );
  const utils = trpc.useUtils();
  const update = trpc.assets.update.useMutation({
    onSuccess: () => {
      utils.assets.listByProject.invalidate({ projectId });
      utils.assets.listByCharacter.invalidate();
    },
  });
  const remove = trpc.assets.delete.useMutation({
    onSuccess: () => {
      utils.assets.listByProject.invalidate({ projectId });
      if (characterId) utils.assets.listByCharacter.invalidate({ characterId });
    },
  });

  const assets: PublicAsset[] = (characterId ? charQuery.data : projectQuery.data) ?? [];
  const loading = characterId ? charQuery.isLoading : projectQuery.isLoading;
  const characters = charactersQuery.data ?? [];

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  }
  if (assets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
        {characterId
          ? "No sheets linked to this character yet. Upload one above — it’ll bind to this character automatically."
          : "No assets yet."}
      </div>
    );
  }

  const characterName = (id: string | null) =>
    id ? characters.find((c) => c.id === id)?.name ?? "Unknown" : null;

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
          <div className="p-3 space-y-2">
            <div className="truncate text-sm font-medium">{a.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {a.kind.replace("_", " ")}
              {a.hasEmbedding ? " · embedded" : ""}
            </div>
            {!characterId && (
              <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <span>Character:</span>
                <select
                  value={a.characterId ?? ""}
                  onChange={(e) =>
                    update.mutate({
                      id: a.id,
                      characterId: e.target.value === "" ? null : e.target.value,
                    })
                  }
                  className="flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[11px]"
                >
                  <option value="">— none —</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {characterId && a.characterId && a.characterId !== characterId && (
              <div className="text-[11px] text-[var(--text-muted)]">
                Also linked to: {characterName(a.characterId)}
              </div>
            )}
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
