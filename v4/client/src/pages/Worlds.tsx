import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../lib/trpc";

export default function Worlds() {
  const list = trpc.worlds.list.useQuery();
  const utils = trpc.useUtils();
  const create = trpc.worlds.create.useMutation({
    onSuccess: () => {
      utils.worlds.list.invalidate();
      setName("");
      setDescription("");
    },
  });
  const remove = trpc.worlds.delete.useMutation({
    onSuccess: () => utils.worlds.list.invalidate(),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const worlds = list.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Worlds</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A world groups style tokens, characters, and reusable assets. Stories
          attach to one or more worlds to inherit their vocabulary.
        </p>
      </div>

      <form
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate({
            name: name.trim(),
            description: description.trim() || undefined,
          });
        }}
      >
        <h3 className="text-sm font-medium">New world</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Berliner Familienkosmos"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
        </div>
        {create.error && (
          <div className="mt-2 text-xs text-[var(--danger)]">{create.error.message}</div>
        )}
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="mt-3 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create world"}
        </button>
      </form>

      {worlds.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          No worlds yet.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {worlds.map((w) => (
            <li
              key={w.id}
              className="flex items-start justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div>
                <Link
                  href={`/worlds/${w.id}`}
                  className="text-base font-medium hover:underline"
                >
                  {w.name}
                </Link>
                {w.description && (
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    {w.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete world "${w.name}"?`)) remove.mutate({ id: w.id });
                }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
