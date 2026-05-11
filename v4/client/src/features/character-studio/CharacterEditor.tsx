import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AssetDropZone,
  AssetUploader,
} from "../asset-library/AssetUploader";
import { AssetGrid } from "../asset-library/AssetGrid";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

type Props = {
  characterId: string;
  /** When set, surfaces a link to the canonical /characters/:id detail page. */
  showDetailLink?: boolean;
  /** Called after the character is deleted (so the parent can clear selection). */
  onDeleted?: () => void;
};

/**
 * Single source of truth for character editing. Used by:
 *  - /characters/:id (CharacterDetail page)
 *  - ProjectDetail → Characters tab (right pane)
 *  - WorldDetail → Characters section (right pane)
 *
 * Renders: editable header (name, description, persona, aliases, world),
 * Used-by section, Sheets section with drop-zone + uploader + grid,
 * delete action.
 */
export function CharacterEditor({ characterId, showDetailLink, onDeleted }: Props) {
  const id = characterId;
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
    utils.characters.listByProject.invalidate();
    utils.characters.listByWorld.invalidate();
    utils.characters.usedBy.invalidate({ id });
    utils.assets.listByCharacter.invalidate({ characterId: id });
  };
  const update = trpc.characters.update.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast.error("Update failed", err.message),
  });
  const remove = trpc.characters.delete.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Character deleted");
      onDeleted?.();
    },
    onError: (err) => toast.error("Delete failed", err.message),
  });

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

  if (!id) return null;
  if (charQuery.isLoading)
    return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!c) return <div className="text-sm text-[var(--text-muted)]">Character not found.</div>;

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
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(c.name);
          }}
          className="flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none focus:underline"
        />
        {showDetailLink && (
          <Link
            href={`/characters/${id}`}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
          >
            Open detail page →
          </Link>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitBlock}
              rows={2}
              placeholder="Short visible description"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
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
              rows={3}
              placeholder="How they talk, what they care about."
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </label>
        </div>

        <div className="space-y-2">
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Aliases
            </span>
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              onBlur={commitBlock}
              placeholder="Vater, Papa, Toni"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
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
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            >
              <option value="">— floating —</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Used by
            </div>
            <div className="mt-1 space-y-1 text-xs">
              {u && u.projectIds.length === 0 && u.storyIds.length === 0 && (
                <div className="italic text-[var(--text-muted)]">
                  Not attached to any project or story yet.
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
                <Link
                  key={sid}
                  href={`/contents/${sid}`}
                  className="block rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-muted)]"
                >
                  story: {sid.slice(0, 8)}…
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Sheets ({sheets.length})
          </h3>
          <AssetUploader characterId={id} defaultKind="character_sheet" compact />
        </div>
        <div className="mt-2">
          <AssetDropZone characterId={id} defaultKind="character_sheet">
            {sheets.length > 0 ? (
              <AssetGrid characterId={id} />
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-xs text-[var(--text-muted)]">
                No sheets bound yet. Drag an image here or use the upload button.
              </div>
            )}
          </AssetDropZone>
        </div>
      </section>

      <div className="border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete character "${c.name}"? Sheets are NOT deleted.`))
              remove.mutate({ id });
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
        >
          Delete character
        </button>
      </div>
    </div>
  );
}
