import { useState } from "react";
import { AssetGridGlobal } from "../features/asset-library/AssetGridGlobal";
import { AssetUploader } from "../features/asset-library/AssetUploader";
import type { AssetKind } from "@v4shared/types/enums";
import { ASSET_KINDS } from "@v4shared/types/enums";

export default function Library() {
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Global pool of character sheets, environments, style references and props.
          Assets can be attached to projects, worlds, or characters from here.
        </p>
      </div>

      <AssetUploader />

      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--text-muted)]">Kind:</span>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as AssetKind | "all")}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
        >
          <option value="all">all</option>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <AssetGridGlobal kinds={kindFilter === "all" ? undefined : [kindFilter]} />
    </div>
  );
}
