import { useMemo, useState } from "react";
import { AssetGridGlobal } from "../features/asset-library/AssetGridGlobal";
import {
  AssetDropZone,
  AssetUploader,
} from "../features/asset-library/AssetUploader";
import { GlobalAssetSearch } from "../features/asset-library/GlobalAssetSearch";
import { LibraryStats } from "../features/asset-library/LibraryStats";
import { VariantsGrid } from "../features/asset-library/VariantsGrid";
import type { AssetKind } from "@v4shared/types/enums";
import { ASSET_KINDS } from "@v4shared/types/enums";
import { trpc } from "../lib/trpc";

type Tab = "assets" | "variants" | "search";

export default function Library() {
  const [tab, setTab] = useState<Tab>("assets");
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

      <LibraryStats />

      <div className="border-b border-[var(--border)]">
        <nav className="flex gap-6 text-sm">
          {(["assets", "variants", "search"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-1 pb-3 capitalize ${
                tab === t
                  ? "border-[var(--accent)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "assets" && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">Filter name:</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="substring…"
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
        </>
      )}

      {tab === "variants" && <VariantsGrid />}

      {tab === "search" && <GlobalAssetSearch />}
    </div>
  );
}
