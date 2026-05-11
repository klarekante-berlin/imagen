import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../lib/trpc";

export default function Characters() {
  const list = trpc.characters.list.useQuery();
  const worldsQuery = trpc.worlds.list.useQuery();
  const projectsQuery = trpc.projects.list.useQuery();

  const [search, setSearch] = useState("");
  const [worldFilter, setWorldFilter] = useState<string>("all");

  const utils = trpc.useUtils();
  const create = trpc.characters.create.useMutation({
    onSuccess: () => {
      utils.characters.list.invalidate();
      setNewName("");
    },
  });

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWorldId, setNewWorldId] = useState("");

  const worlds = worldsQuery.data ?? [];
  const characters = list.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return characters.filter((c) => {
      if (worldFilter === "floating" && c.worldId) return false;
      if (worldFilter !== "all" && worldFilter !== "floating" && c.worldId !== worldFilter)
        return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [characters, search, worldFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Characters</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Global pool. A character can be shared across projects and worlds — one row
            here means one identity, not one usage. Click to open the detail view.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreatorOpen((v) => !v)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          {creatorOpen ? "Cancel" : "+ New character"}
        </button>
      </div>

      {creatorOpen && (
        <form
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            create.mutate({
              name: newName.trim(),
              worldId: newWorldId || undefined,
            });
            setCreatorOpen(false);
            setNewName("");
            setNewWorldId("");
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Character name"
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            />
            <select
              value={newWorldId}
              onChange={(e) => setNewWorldId(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            >
              <option value="">— no world (floating) —</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={create.isPending || !newName.trim()}
            className="mt-2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            Create
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">Search:</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name…"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">World:</span>
          <select
            value={worldFilter}
            onChange={(e) => setWorldFilter(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          >
            <option value="all">all</option>
            <option value="floating">— floating —</option>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[var(--text-muted)]">
          {filtered.length} / {characters.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          {characters.length === 0
            ? "No characters yet. Click + New character."
            : "Nothing matches the filters."}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CharacterRow key={c.id} characterId={c.id} worlds={worlds} projects={projectsQuery.data ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CharacterRow({
  characterId,
  worlds,
  projects,
}: {
  characterId: string;
  worlds: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const charQuery = trpc.characters.get.useQuery({ id: characterId });
  const usedByQuery = trpc.characters.usedBy.useQuery({ id: characterId });
  const primaryAssetQuery = trpc.assets.get.useQuery(
    { id: usedByQuery.data?.primaryAssetId ?? "" },
    { enabled: !!usedByQuery.data?.primaryAssetId },
  );
  const c = charQuery.data;
  const u = usedByQuery.data;
  if (!c) return null;
  const world = worlds.find((w) => w.id === c.worldId);
  const projectNames = (u?.projectIds ?? [])
    .map((pid) => projects.find((p) => p.id === pid)?.name)
    .filter(Boolean) as string[];

  return (
    <li className="rounded-md border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]">
      <Link
        href={`/characters/${c.id}`}
        className="block p-3"
      >
        <div className="flex items-start gap-3">
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-[var(--surface-muted)]">
            {primaryAssetQuery.data ? (
              <img
                src={primaryAssetQuery.data.imageUrl}
                alt={c.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
                no sheet
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{c.name}</div>
            {c.description && (
              <div className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
                {c.description}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-1 text-[9px] uppercase tracking-wide">
              {world && (
                <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {world.name}
                </span>
              )}
              {!world && (
                <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  floating
                </span>
              )}
              {u && (
                <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {u.sheetCount} sheet{u.sheetCount === 1 ? "" : "s"}
                </span>
              )}
              {projectNames.length > 0 && (
                <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {projectNames.length} project{projectNames.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
