import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import type { Character } from "../../../../drizzle/schema";

type Props = {
  character: Character;
  isSelected: boolean;
  onSelect: () => void;
};

export function CharacterCard({ character, isSelected, onSelect }: Props) {
  const utils = trpc.useUtils();
  const worldsQuery = trpc.worlds.list.useQuery();
  const usedByQuery = trpc.characters.usedBy.useQuery({ id: character.id });

  const invalidate = () => {
    utils.characters.list.invalidate();
    utils.characters.listByProject.invalidate();
    utils.characters.listByWorld.invalidate();
    utils.characters.usedBy.invalidate({ id: character.id });
  };
  const update = trpc.characters.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.characters.delete.useMutation({ onSuccess: invalidate });

  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description ?? "");
  const [persona, setPersona] = useState(character.persona ?? "");
  const [aliases, setAliases] = useState((character.aliasesJson ?? []).join(", "));
  const [worldId, setWorldId] = useState(character.worldId ?? "");

  useEffect(() => {
    setName(character.name);
    setDescription(character.description ?? "");
    setPersona(character.persona ?? "");
    setAliases((character.aliasesJson ?? []).join(", "));
    setWorldId(character.worldId ?? "");
  }, [character]);

  const world = worldsQuery.data?.find((w) => w.id === character.worldId);
  const usedBy = usedByQuery.data;

  function commitName() {
    if (name.trim() && name !== character.name) {
      update.mutate({ id: character.id, name: name.trim() });
    } else {
      setName(character.name);
    }
  }

  function saveAll() {
    const aliasArray = aliases
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    update.mutate({
      id: character.id,
      description: description.trim() || undefined,
      persona: persona.trim() || undefined,
      aliasesJson: aliasArray,
      worldId: worldId || null,
    });
  }

  return (
    <li
      className={`rounded-md border bg-[var(--surface)] ${
        isSelected ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setName(character.name);
            }}
            onClick={(e) => e.stopPropagation()}
            className="block w-full bg-transparent text-sm font-medium outline-none focus:underline"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5">
              {character.origin}
            </span>
            {world && (
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5">
                world: {world.name}
              </span>
            )}
            {usedBy && usedBy.projectIds.length > 0 && (
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5">
                {usedBy.projectIds.length} project
                {usedBy.projectIds.length === 1 ? "" : "s"}
              </span>
            )}
            {usedBy && usedBy.sheetCount > 0 && (
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5">
                {usedBy.sheetCount} sheet{usedBy.sheetCount === 1 ? "" : "s"}
              </span>
            )}
            {usedBy && !usedBy.primaryAssetId && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                no primary sheet
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {expanded ? "Hide" : "Edit"}
          </button>
          <button
            type="button"
            onClick={onSelect}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {isSelected ? "Open ✓" : "Open"}
          </button>
        </div>
      </div>

      {!expanded && character.description && (
        <div className="px-3 pb-3 text-xs text-[var(--text-muted)]">
          {character.description}
        </div>
      )}

      {expanded && (
        <div className="space-y-2 border-t border-[var(--border)] p-3 text-xs">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveAll}
              rows={2}
              placeholder="Short visible description (one or two sentences)"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Persona / voice
            </span>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              onBlur={saveAll}
              rows={2}
              placeholder="How they talk, what they care about — used by the splitter."
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Aliases (comma-separated)
            </span>
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              onBlur={saveAll}
              placeholder="Vater, Toni"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              World
            </span>
            <select
              value={worldId}
              onChange={(e) => {
                setWorldId(e.target.value);
                update.mutate({
                  id: character.id,
                  worldId: e.target.value || null,
                });
              }}
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            >
              <option value="">— floating —</option>
              {(worldsQuery.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete character "${character.name}"?`))
                  remove.mutate({ id: character.id });
              }}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              Delete character
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
