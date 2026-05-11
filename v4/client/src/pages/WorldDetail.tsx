import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import type { Character } from "../../../drizzle/schema";
import { InlineEdit } from "../components/InlineEdit";
import { AssetGridGlobal } from "../features/asset-library/AssetGridGlobal";
import {
  AssetDropZone,
  AssetUploader,
} from "../features/asset-library/AssetUploader";
import { CharacterEditor } from "../features/character-studio/CharacterEditor";
import { CharacterList } from "../features/character-studio/CharacterList";
import { toast } from "../lib/toast";
import { trpc } from "../lib/trpc";

export default function WorldDetail() {
  const [, params] = useRoute("/worlds/:id");
  const [, setLocation] = useLocation();
  const worldId = params?.id ?? "";
  const world = trpc.worlds.get.useQuery({ id: worldId }, { enabled: !!worldId });
  const assets = trpc.assets.listByWorld.useQuery(
    { worldId },
    { enabled: !!worldId },
  );

  const utils = trpc.useUtils();
  const update = trpc.worlds.update.useMutation({
    onSuccess: () => {
      utils.worlds.get.invalidate({ id: worldId });
      utils.worlds.list.invalidate();
    },
    onError: (err) => toast.error("World update failed", err.message),
  });
  const remove = trpc.worlds.delete.useMutation({
    onSuccess: () => {
      toast.success("World deleted");
      setLocation("/worlds");
    },
    onError: (err) => toast.error("Delete failed", err.message),
  });

  const [focusedCharacter, setFocusedCharacter] = useState<Character | null>(null);

  if (!worldId) return <div>World id missing.</div>;
  if (world.isLoading) return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!world.data) return <div>World not found.</div>;

  const w = world.data;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/worlds" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          ← All worlds
        </Link>
        <div className="mt-1 space-y-1">
          <InlineEdit
            value={w.name}
            placeholder="World name"
            className="text-2xl font-semibold tracking-tight"
            onSave={(name) => update.mutateAsync({ id: worldId, name })}
          />
          <InlineEdit
            value={w.description ?? ""}
            placeholder="Add a description…"
            multiline
            className="text-sm text-[var(--text-muted)]"
            emptyClassName="text-xs italic text-[var(--text-muted)] underline-offset-2 hover:underline"
            onSave={(description) =>
              update.mutateAsync({ id: worldId, description })
            }
          />
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete world "${w.name}"? Characters with this world will become floating.`)) {
                remove.mutate({ id: worldId });
              }
            }}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)]"
          >
            Delete world
          </button>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Characters in this world
        </h2>
        <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_2fr]">
          <CharacterList
            worldId={worldId}
            onSelect={setFocusedCharacter}
            selectedId={focusedCharacter?.id}
          />
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            {focusedCharacter ? (
              <CharacterEditor
                characterId={focusedCharacter.id}
                showDetailLink
                onDeleted={() => setFocusedCharacter(null)}
              />
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
                Select a character to edit description, persona, aliases, world, and
                manage sheets.
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
            World assets ({assets.data?.length ?? 0})
          </h2>
          <AssetUploader worldId={worldId} defaultKind="style_ref" compact />
        </div>
        <div className="mt-3">
          <AssetDropZone worldId={worldId} defaultKind="style_ref">
            <AssetGridGlobal filteredAssets={assets.data ?? []} />
          </AssetDropZone>
        </div>
      </section>
    </div>
  );
}
