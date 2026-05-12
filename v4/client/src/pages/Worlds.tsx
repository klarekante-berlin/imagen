import { useState } from "react";
import { Link } from "wouter";
import { toast } from "../lib/toast";
import { trpc } from "../lib/trpc";

function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function Worlds() {
  const list = trpc.worlds.listWithCounts.useQuery();
  const utils = trpc.useUtils();
  const create = trpc.worlds.create.useMutation({
    onSuccess: () => {
      utils.worlds.list.invalidate();
      utils.worlds.listWithCounts.invalidate();
      toast.success("World created");
      setName("");
      setCreatorOpen(false);
    },
    onError: (err) => toast.error("Create failed", err.message),
  });

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const worlds = list.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Worlds</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            A world bundles characters, environments, props, and style references into
            a coherent visual identity. Stories attach to one or more worlds to inherit
            the vocabulary.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreatorOpen((v) => !v)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          {creatorOpen ? "Cancel" : "+ New world"}
        </button>
      </div>

      {creatorOpen && (
        <form
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({
              name: name.trim(),
              description: description.trim() || undefined,
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              autoFocus
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
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="mt-2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create world"}
          </button>
        </form>
      )}

      {worlds.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
          No worlds yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium text-right">Chars</th>
                <th className="px-3 py-2 font-medium text-right">Envs</th>
                <th className="px-3 py-2 font-medium text-right">Props</th>
                <th className="px-3 py-2 font-medium text-right">Style refs</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {worlds.map((w) => (
                <tr
                  key={w.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-muted)]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/worlds/${w.id}`}
                      className="font-medium hover:underline"
                    >
                      {w.name}
                    </Link>
                    {w.description && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-muted)]">
                        {w.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.characterCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.environmentCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.propCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.styleRefCount}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                    {relTime(w.updatedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/worlds/${w.id}`}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
