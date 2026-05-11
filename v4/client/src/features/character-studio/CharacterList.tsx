import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { Character } from "../../../../drizzle/schema";

type Props = {
  projectId: string;
  onSelect?: (character: Character) => void;
  selectedId?: string | null;
};

export function CharacterList({ projectId, onSelect, selectedId }: Props) {
  const list = trpc.characters.listByProject.useQuery({ projectId });
  const utils = trpc.useUtils();
  const create = trpc.characters.create.useMutation({
    onSuccess: () => {
      utils.characters.listByProject.invalidate({ projectId });
      setName("");
      setDescription("");
    },
  });
  const remove = trpc.characters.delete.useMutation({
    onSuccess: () => utils.characters.listByProject.invalidate({ projectId }),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="space-y-4">
      <form
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate({
            projectId,
            name: name.trim(),
            description: description.trim() || undefined,
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
