import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { Character, World } from "../../../../drizzle/schema";

type Props = {
  /** When set, listing is scoped via attachments and creates auto-attach to this project. */
  projectId?: string;
  /** When set, listing is scoped via FK and creates set world_id directly. */
  worldId?: string;
  onSelect?: (character: Character) => void;
  selectedId?: string | null;
};

export function CharacterList({ projectId, worldId, onSelect, selectedId }: Props) {
  const projectQuery = trpc.characters.listByProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const worldQuery = trpc.characters.listByWorld.useQuery(
    { worldId: worldId ?? "" },
    { enabled: !!worldId },
  );
  const allQuery = trpc.characters.list.useQuery(undefined, {
    enabled: !projectId && !worldId,
  });
  const worldsQuery = trpc.worlds.list.useQuery();

  const list = projectId ? projectQuery : worldId ? worldQuery : allQuery;

  const utils = trpc.useUtils();
  const invalidate = () => {
    if (projectId) utils.characters.listByProject.invalidate({ projectId });
    if (worldId) utils.characters.listByWorld.invalidate({ worldId });
    utils.characters.list.invalidate();
    utils.characters.listFloating.invalidate();
  };
  const create = trpc.characters.create.useMutation({
    onSuccess: () => {
      invalidate();
      setName("");
      setDescription("");
    },
  });
  const remove = trpc.characters.delete.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pickedWorldId, setPickedWorldId] = useState<string>("");

  const worlds: World[] = worldsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <form
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate({
            name: name.trim(),
            description: description.trim() || undefined,
            worldId: worldId ?? (pickedWorldId || undefined),
            attachToProjectId: projectId ?? undefined,
          });
        }}
      >
        <h3 className="text-sm font-medium">New character</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Papa"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
          {!worldId && !projectId && (
            <select
              value={pickedWorldId}
              onChange={(e) => setPickedWorldId(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm sm:col-span-2"
            >
              <option value="">— no world (floating) —</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="mt-3 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Add character"}
        </button>
      </form>

      {list.isLoading ? (
        <div className="text-sm text-[var(--text-muted)]">Loading…</div>
      ) : list.data && list.data.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {list.data.map((c) => (
            <li
              key={c.id}
              className={`rounded-md border bg-[var(--surface)] p-3 ${
                selectedId === c.id
                  ? "border-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelect?.(c)}
                  className="text-left text-sm font-medium hover:underline"
                >
                  {c.name}
                </button>
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {c.origin}
                </span>
              </div>
              {c.description && (
                <div className="mt-1 text-xs text-[var(--text-muted)]">{c.description}</div>
              )}
              {c.worldId && (
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  World: {worlds.find((w) => w.id === c.worldId)?.name ?? "—"}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete character "${c.name}"?`)) remove.mutate({ id: c.id });
                }}
                className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          No characters yet.
        </div>
      )}
    </div>
  );
}
