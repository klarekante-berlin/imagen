import { trpc } from "../../lib/trpc";
import type { Character } from "../../../../drizzle/schema";

type Props = {
  character: Character;
  isSelected: boolean;
  onSelect: () => void;
};

export function CharacterCard({ character, isSelected, onSelect }: Props) {
  const worldsQuery = trpc.worlds.list.useQuery();
  const usedByQuery = trpc.characters.usedBy.useQuery({ id: character.id });
  const primaryAssetQuery = trpc.assets.get.useQuery(
    { id: usedByQuery.data?.primaryAssetId ?? "" },
    { enabled: !!usedByQuery.data?.primaryAssetId },
  );

  const world = worldsQuery.data?.find((w) => w.id === character.worldId);
  const usedBy = usedByQuery.data;

  return (
    <li
      className={`cursor-pointer rounded-md border bg-[var(--surface)] transition hover:border-[var(--border-strong)] ${
        isSelected ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-[var(--surface-muted)]">
          {primaryAssetQuery.data ? (
            <img
              src={primaryAssetQuery.data.imageUrl}
              alt={character.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
              no sheet
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{character.name}</div>
          {character.description && (
            <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">
              {character.description}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] uppercase tracking-wide">
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
            {usedBy && (
              <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                {usedBy.sheetCount} sheet{usedBy.sheetCount === 1 ? "" : "s"}
              </span>
            )}
            {usedBy && usedBy.projectIds.length > 0 && (
              <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                {usedBy.projectIds.length} project{usedBy.projectIds.length === 1 ? "" : "s"}
              </span>
            )}
            {usedBy && !usedBy.primaryAssetId && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">
                no primary sheet
              </span>
            )}
            {character.origin !== "user" && (
              <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">
                {character.origin}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
