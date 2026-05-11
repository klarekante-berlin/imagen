import { useMemo, useState } from "react";
import { AssetGridGlobal } from "../features/asset-library/AssetGridGlobal";
import {
  AssetDropZone,
  AssetUploader,
} from "../features/asset-library/AssetUploader";
import type { AssetKind } from "@v4shared/types/enums";
import { ASSET_KINDS } from "@v4shared/types/enums";
import { trpc } from "../lib/trpc";

export default function Library() {
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
  const [worldFilter, setWorldFilter] = useState<string>("all");
  const [characterFilter, setCharacterFilter] = useState<string>("all");
  const [embeddedFilter, setEmbeddedFilter] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");

  const allAssets = trpc.assets.list.useQuery().data ?? [];
  const worlds = trpc.worlds.list.useQuery().data ?? [];
  const characters = trpc.characters.list.useQuery().data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allAssets.filter((a) => {
      if (kindFilter !== "all" && a.kind !== kindFilter) return false;
      if (worldFilter === "none" && a.worldId) return false;
      if (worldFilter !== "all" && worldFilter !== "none" && a.worldId !== worldFilter)
        return false;
      if (characterFilter === "none" && a.characterId) return false;
      if (
        characterFilter !== "all" &&
        characterFilter !== "none" &&
        a.characterId !== characterFilter
      )
        return false;
      if (embeddedFilter === "yes" && !a.hasEmbedding) return false;
      if (embeddedFilter === "no" && a.hasEmbedding) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allAssets, kindFilter, worldFilter, characterFilter, embeddedFilter, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Global pool. Drag images anywhere to upload, or use{" "}
            <strong>+ Upload asset</strong>. Click a card to edit.
          </p>
        </div>
        <AssetUploader compact />
      </div>

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
          <span className="text-[var(--text-muted)]">Kind:</span>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as AssetKind | "all")}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          >
            <option value="all">all</option>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">World:</span>
          <select
            value={worldFilter}
            onChange={(e) => setWorldFilter(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          >
            <option value="all">all</option>
            <option value="none">— none —</option>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">Character:</span>
          <select
            value={characterFilter}
            onChange={(e) => setCharacterFilter(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          >
            <option value="all">all</option>
            <option value="none">— none —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[var(--text-muted)]">Embedded:</span>
          <select
            value={embeddedFilter}
            onChange={(e) => setEmbeddedFilter(e.target.value as "all" | "yes" | "no")}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          >
            <option value="all">all</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <span className="text-[var(--text-muted)]">
          {filtered.length} / {allAssets.length}
        </span>
      </div>

      <AssetDropZone>
        <AssetGridGlobal filteredAssets={filtered} />
      </AssetDropZone>
    </div>
  );
}
