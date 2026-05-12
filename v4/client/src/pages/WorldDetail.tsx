import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import type { Character } from "../../../drizzle/schema";
import type { PublicAsset } from "@v4shared/types/asset-view";
import type { AssetKind } from "@v4shared/types/enums";
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

type SectionKind = "environment" | "prop" | "style_ref";
const SECTIONS: Array<{ kind: SectionKind; label: string; hint: string }> = [
  {
    kind: "environment",
    label: "Environments",
    hint: "Streets, rooms, landscapes — places stories take place in.",
  },
  {
    kind: "prop",
    label: "Props & items",
    hint: "Objects characters interact with — vehicles, furniture, everyday objects.",
  },
  {
    kind: "style_ref",
    label: "Style references",
    hint: "Typography, palette, line-work sheets — the visual register itself.",
  },
];

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
      utils.worlds.listWithCounts.invalidate();
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

  const assetsByKind = useMemo(() => {
    const m: Record<string, PublicAsset[]> = {};
    for (const a of assets.data ?? []) {
      m[a.kind] = m[a.kind] ?? [];
      m[a.kind]!.push(a);
    }
    return m;
  }, [assets.data]);

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
              if (
                confirm(
                  `Delete world "${w.name}"? Characters and assets stay; they just become floating.`,
                )
              ) {
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
          Characters
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

      {SECTIONS.map(({ kind, label, hint }) => (
        <WorldAssetSection
          key={kind}
          worldId={worldId}
          kind={kind}
          label={label}
          hint={hint}
          items={assetsByKind[kind] ?? []}
        />
      ))}
    </div>
  );
}

function WorldAssetSection({
  worldId,
  kind,
  label,
  hint,
  items,
}: {
  worldId: string;
  kind: AssetKind;
  label: string;
  hint: string;
  items: PublicAsset[];
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
            {label} ({items.length})
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>
        </div>
        <AssetUploader worldId={worldId} defaultKind={kind} compact />
      </div>
      <div className="mt-3">
        <AssetDropZone worldId={worldId} defaultKind={kind}>
          {items.length > 0 ? (
            <AssetGridGlobal filteredAssets={items} />
          ) : (
            <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
              None yet. Drag {kind.replace("_", " ")} images here or use the upload button.
            </div>
          )}
        </AssetDropZone>
      </div>
    </section>
  );
}
