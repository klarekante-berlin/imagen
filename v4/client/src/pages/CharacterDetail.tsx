import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  AssetDropZone,
  AssetUploader,
} from "../features/asset-library/AssetUploader";
import { AssetGrid } from "../features/asset-library/AssetGrid";
import { trpc } from "../lib/trpc";

export default function CharacterDetail() {
  const [, params] = useRoute("/characters/:id");
  const id = params?.id ?? "";

  const charQuery = trpc.characters.get.useQuery({ id }, { enabled: !!id });
  const worldsQuery = trpc.worlds.list.useQuery();
  const projectsQuery = trpc.projects.list.useQuery();
  const sheetsQuery = trpc.assets.listByCharacter.useQuery(
    { characterId: id },
    { enabled: !!id },
  );
  const usedByQuery = trpc.characters.usedBy.useQuery({ id }, { enabled: !!id });

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.characters.get.invalidate({ id });
    utils.characters.list.invalidate();
    utils.characters.usedBy.invalidate({ id });
    utils.assets.listByCharacter.invalidate({ characterId: id });
  };
  const update = trpc.characters.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.characters.delete.useMutation({ onSuccess: invalidate });

  const c = charQuery.data;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [persona, setPersona] = useState("");
  const [aliases, setAliases] = useState("");
  const [worldId, setWorldId] = useState("");

  useEffect(() => {
    if (!c) return;
    setName(c.name);
    setDescription(c.description ?? "");
    setPersona(c.persona ?? "");
    setAliases((c.aliasesJson ?? []).join(", "));
    setWorldId(c.worldId ?? "");
  }, [c]);

  if (!id) return <div>Character id missing.</div>;
  if (charQuery.isLoading) return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!c) return <div>Character not found.</div>;

  function commitName() {
    if (!c) return;
    if (name.trim() && name !== c.name) {
      update.mutate({ id, name: name.trim() });
    } else {
      setName(c.name);
    }
  }
  function commitBlock() {
    const aliasArray = aliases
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    update.mutate({
      id,
      description: description.trim() || undefined,
      persona: persona.trim() || undefined,
      aliasesJson: aliasArray,
      worldId: worldId || null,
    });
  }

  const worlds = worldsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const sheets = sheetsQuery.data ?? [];
  const u = usedByQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/characters"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ← All characters
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(c.name);
          }}
          className="mt-1 block w-full bg-transparent text-2xl font-semibold tracking-tight outline-none focus:underline"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitBlock}
              rows={3}
              placeholder="Short visible description"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Persona / voice
            </span>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              onBlur={commitBlock}
              rows={4}
              placeholder="How they talk, what they care about — used by the splitter."
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Aliases (comma-separated)
            </span>
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              onBlur={commitBlock}
              placeholder="Vater, Papa, Toni"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              World
            </span>
            <select
              value={worldId}
              onChange={(e) => {
                setWorldId(e.target.value);
                update.mutate({ id, worldId: e.target.value || null });
              }}
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
            >
              <option value="">— floating —</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Used by</h3>
            <div className="mt-1 space-y-1 text-xs">
              {u && u.projectIds.length === 0 && u.storyIds.length === 0 && (
                <div className="italic text-[var(--text-muted)]">
                  Not attached to any project or story.
                </div>
              )}
              {u?.projectIds.map((pid) => {
                const p = projects.find((x) => x.id === pid);
                return (
                  <Link
                    key={pid}
                    href={`/projects/${pid}`}
                    className="block rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-muted)]"
                  >
                    project: {p?.name ?? pid.slice(0, 8)}
                  </Link>
                );
              })}
              {u?.storyIds.map((sid) => (
                <div
                  key={sid}
                  className="rounded border border-[var(--border)] px-2 py-1"
                >
                  story: {sid.slice(0, 8)}…
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete character "${c.name}"?`)) remove.mutate({ id });
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              Delete character
            </button>
          </div>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Sheets ({sheets.length})
          </h2>
          <AssetUploader characterId={id} defaultKind="character_sheet" compact />
        </div>
        <div className="mt-3">
          <AssetDropZone characterId={id} defaultKind="character_sheet">
            {sheets.length > 0 ? (
              <AssetGrid characterId={id} />
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
                No sheets bound to this character yet. Drag an image anywhere on the
                page or use the upload button.
              </div>
            )}
          </AssetDropZone>
        </div>
      </section>
    </div>
  );
}
