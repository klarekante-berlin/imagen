import { useMemo, useState } from "react";
import { trpc } from "../../lib/trpc";
import type { PublicAsset } from "@v4shared/types/asset-view";

/**
 * Inline picker on an asset card. Lets the user
 *   (a) pick an existing character from the GLOBAL list,
 *   (b) create a new character bound to this sheet — with duplicate
 *       detection: if a character with the same name already exists,
 *       we surface a "Use existing" CTA instead of silently creating a
 *       second row.
 *
 * Characters are a single global pool. A project doesn't OWN a character —
 * it just attaches one via the `attachments` table. If two projects both
 * use "Papa", they should share the same character row, not each carry a
 * copy.
 */
type Props = {
  asset: PublicAsset;
  /** When set, a newly-created character (or the existing one chosen via
   * "Use existing") gets attached to this project so it shows up in the
   * project's character list. */
  attachToProjectId?: string;
};

export function CharacterAssignCell({ asset, attachToProjectId }: Props) {
  const characters = trpc.characters.list.useQuery().data ?? [];
  const worlds = trpc.worlds.list.useQuery().data ?? [];
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.characters.list.invalidate();
    utils.characters.listByProject.invalidate();
    utils.characters.listByWorld.invalidate();
    utils.attachments.listByScope.invalidate();
    utils.assets.list.invalidate();
    utils.assets.listByProject.invalidate();
    utils.assets.listByWorld.invalidate();
    utils.assets.listByCharacter.invalidate();
  };

  const updateAsset = trpc.assets.update.useMutation({ onSuccess: invalidate });
  const createCharacter = trpc.characters.create.useMutation();
  const updateCharacter = trpc.characters.update.useMutation();
  const attach = trpc.attachments.attach.useMutation();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);

  // Case-insensitive duplicate detection. Default name match wins; the user
  // can ignore by clicking "create anyway".
  const duplicate = useMemo(() => {
    const q = draftName.trim().toLowerCase();
    if (!q) return null;
    return characters.find((c) => c.name.toLowerCase() === q) ?? null;
  }, [draftName, characters]);

  const worldOf = (id: string | null) =>
    id ? worlds.find((w) => w.id === id)?.name ?? null : null;

  async function linkExisting(characterId: string) {
    setBusy(true);
    try {
      await updateAsset.mutateAsync({ id: asset.id, characterId });
      if (attachToProjectId) {
        await attach.mutateAsync({
          scope: "project",
          scopeId: attachToProjectId,
          ref: "character",
          refId: characterId,
        });
      }
      invalidate();
      setCreating(false);
      setDraftName("");
    } finally {
      setBusy(false);
    }
  }

  async function commitCreate() {
    const name = draftName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    setBusy(true);
    try {
      const newChar = await createCharacter.mutateAsync({
        name,
        worldId: asset.worldId ?? undefined,
        attachToProjectId,
      });
      await updateAsset.mutateAsync({ id: asset.id, characterId: newChar.id });
      await updateCharacter.mutateAsync({
        id: newChar.id,
        primaryAssetId: asset.id,
      });
      invalidate();
      setCreating(false);
      setDraftName("");
    } catch (err) {
      console.error("[v4 CharacterAssignCell] create failed:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
      <div className="flex items-center gap-1">
        <span>Character:</span>
        <select
          value={asset.characterId ?? ""}
          onChange={(e) =>
            updateAsset.mutate({
              id: asset.id,
              characterId: e.target.value === "" ? null : e.target.value,
            })
          }
          className="flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[11px]"
        >
          <option value="">—</option>
          {characters.map((c) => {
            const world = worldOf(c.worldId);
            return (
              <option key={c.id} value={c.id}>
                {c.name}
                {world ? ` · ${world}` : ""}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          onClick={() => {
            setDraftName(asset.name);
            setCreating(true);
          }}
          className="rounded border border-[var(--border)] px-1.5 py-0.5 hover:bg-[var(--surface-muted)]"
          title="Create a new character from this sheet"
        >
          +
        </button>
      </div>

      {creating && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (duplicate) void linkExisting(duplicate.id);
                  else void commitCreate();
                }
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Character name"
              className="flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[11px]"
            />
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-muted)]"
              title="Cancel"
            >
              ✕
            </button>
          </div>

          {duplicate ? (
            <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] p-1.5">
              <div className="text-[10px] text-[var(--text)]">
                <strong>{duplicate.name}</strong>
                {worldOf(duplicate.worldId)
                  ? ` already exists in world “${worldOf(duplicate.worldId)}”.`
                  : " already exists."}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void linkExisting(duplicate.id)}
                  className="rounded border border-[var(--border)] bg-[var(--accent)] px-1.5 py-0.5 text-[var(--accent-fg)] disabled:opacity-50"
                >
                  {busy ? "…" : "Use existing"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void commitCreate()}
                  className="rounded border border-[var(--border)] px-1.5 py-0.5 hover:bg-[var(--surface)] disabled:opacity-50"
                  title="Create a duplicate anyway"
                >
                  Create anyway
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !draftName.trim()}
              onClick={() => void commitCreate()}
              className="w-full rounded border border-[var(--border)] bg-[var(--accent)] px-1.5 py-0.5 text-[var(--accent-fg)] disabled:opacity-50"
            >
              {busy ? "…" : "Create"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
