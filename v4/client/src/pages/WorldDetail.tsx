import { useState } from "react";
import { Link, useRoute } from "wouter";
import type { Character } from "../../../drizzle/schema";
import { AssetUploader } from "../features/asset-library/AssetUploader";
import { CharacterList } from "../features/character-studio/CharacterList";
import { trpc } from "../lib/trpc";

export default function WorldDetail() {
  const [, params] = useRoute("/worlds/:id");
  const worldId = params?.id ?? "";
  const world = trpc.worlds.get.useQuery({ id: worldId }, { enabled: !!worldId });
  const assets = trpc.assets.listByWorld.useQuery(
    { worldId },
    { enabled: !!worldId },
  );

  const [focusedCharacter, setFocusedCharacter] = useState<Character | null>(null);

  if (!worldId) return <div>World id missing.</div>;
  if (world.isLoading) return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!world.data) return <div>World not found.</div>;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/worlds" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          ← All worlds
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{world.data.name}</h1>
        {world.data.description && (
          <div className="mt-1 text-sm text-[var(--text-muted)]">{world.data.description}</div>
        )}
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
          <div>
            {focusedCharacter && (
              <div className="space-y-3">
                <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
                  <div className="font-medium">{focusedCharacter.name}</div>
                  {focusedCharacter.description && (
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {focusedCharacter.description}
                    </div>
                  )}
                </div>
                <AssetUploader
                  worldId={worldId}
                  characterId={focusedCharacter.id}
                  defaultKind="character_sheet"
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
          World assets ({assets.data?.length ?? 0})
        </h2>
        <div className="mt-3">
          <AssetUploader worldId={worldId} defaultKind="style_ref" />
        </div>
        {assets.data && assets.data.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.data.map((a) => (
              <li
                key={a.id}
                className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
              >
                <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                  <img src={a.imageUrl} alt={a.name} className="h-full w-full object-cover" />
                </div>
                <div className="p-3">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    {a.kind.replace("_", " ")}
                    {a.hasEmbedding ? " · embedded" : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
            No world-scoped assets yet.
          </div>
        )}
      </section>
    </div>
  );
}
