import { useEffect, useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import type { PublicAsset } from "@v4shared/types/asset-view";

type Props = {
  asset: PublicAsset;
  onClose: () => void;
};

function formatBytes(b?: number): string {
  if (!b) return "—";
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1_000) return `${Math.round(b / 1_000)} KB`;
  return `${b} B`;
}

export function AssetDrawer({ asset, onClose }: Props) {
  const utils = trpc.useUtils();
  const charactersQuery = trpc.characters.list.useQuery();
  const worldsQuery = trpc.worlds.list.useQuery();
  const projectsQuery = trpc.projects.list.useQuery();
  const usedByQuery = trpc.assets.usedBy.useQuery({ id: asset.id });

  const invalidate = () => {
    utils.assets.list.invalidate();
    utils.assets.listByProject.invalidate();
    utils.assets.listByWorld.invalidate();
    utils.assets.usedBy.invalidate({ id: asset.id });
    utils.attachments.listByScope.invalidate();
  };
  const update = trpc.assets.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.assets.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const detach = trpc.attachments.detach.useMutation({ onSuccess: invalidate });
  const categorize = trpc.assets.categorize.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Vision-categorized", "Description, tags, and metadata refreshed");
    },
    onError: (err) => toast.error("Categorize failed", err.message),
  });

  const [name, setName] = useState(asset.name);
  const [description, setDescription] = useState(asset.visualDescription ?? "");
  const [tags, setTags] = useState((asset.tagsJson ?? []).join(", "));

  useEffect(() => {
    setName(asset.name);
    setDescription(asset.visualDescription ?? "");
    setTags((asset.tagsJson ?? []).join(", "));
  }, [asset]);

  const meta = asset.metadataJson;
  const characters = charactersQuery.data ?? [];
  const worlds = worldsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  function saveText() {
    const tagArray = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    update.mutate({
      id: asset.id,
      name: name.trim() || undefined,
      visualDescription: description.trim() || undefined,
      tags: tagArray,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-medium">Asset</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="aspect-square overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
            <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-contain" />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-muted)]">
            <div>
              kind: <span className="text-[var(--text)]">{asset.kind.replace("_", " ")}</span>
            </div>
            {meta?.width && meta?.height && (
              <div>
                dims: <span className="text-[var(--text)]">{meta.width}×{meta.height}</span>
              </div>
            )}
            {meta?.bytes && (
              <div>
                size: <span className="text-[var(--text)]">{formatBytes(meta.bytes)}</span>
              </div>
            )}
            <div>
              embedded:{" "}
              <span className="text-[var(--text)]">{asset.hasEmbedding ? "yes" : "no"}</span>
            </div>
          </div>

          {(meta?.pose || meta?.outfit || meta?.setting || meta?.dominantColors?.length || meta?.tagAxes?.mood) && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-[11px] text-[var(--text-muted)]">
              <div className="mb-1 text-[9px] uppercase tracking-wide">Vision details</div>
              <div className="space-y-0.5">
                {meta?.pose && (
                  <div>
                    pose: <span className="text-[var(--text)]">{meta.pose}</span>
                  </div>
                )}
                {meta?.outfit && (
                  <div>
                    outfit: <span className="text-[var(--text)]">{meta.outfit}</span>
                  </div>
                )}
                {meta?.setting && (
                  <div>
                    setting: <span className="text-[var(--text)]">{meta.setting}</span>
                  </div>
                )}
                {meta?.tagAxes?.mood && (
                  <div>
                    mood: <span className="text-[var(--text)]">{meta.tagAxes.mood}</span>
                  </div>
                )}
                {meta?.dominantColors && meta.dominantColors.length > 0 && (
                  <div>
                    colors:{" "}
                    <span className="text-[var(--text)]">{meta.dominantColors.join(" · ")}</span>
                  </div>
                )}
                {meta?.visionConfidence !== undefined && (
                  <div>
                    confidence:{" "}
                    <span className="text-[var(--text)]">{meta.visionConfidence}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveText}
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
            />
          </label>

          <label className="block text-xs">
            <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <span>Visual description</span>
              <button
                type="button"
                onClick={() => categorize.mutate({ id: asset.id })}
                disabled={categorize.isPending}
                className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] normal-case hover:bg-[var(--surface-muted)] disabled:opacity-50"
                title="Run Claude vision over the image and fill description, tags, pose, outfit, setting, mood, colors."
              >
                {categorize.isPending ? "✨ filling…" : "✨ Auto-fill"}
              </button>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveText}
              rows={3}
              placeholder="What's visually in this image — used by the splitter to anchor scenes."
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </label>

          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Tags (comma-separated)
            </span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={saveText}
              placeholder="warm, hand-drawn, …"
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </label>

          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Character
            </span>
            <select
              value={asset.characterId ?? ""}
              onChange={(e) =>
                update.mutate({
                  id: asset.id,
                  characterId: e.target.value === "" ? null : e.target.value,
                })
              }
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            >
              <option value="">— none —</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              World
            </span>
            <select
              value={asset.worldId ?? ""}
              onChange={(e) =>
                update.mutate({
                  id: asset.id,
                  worldId: e.target.value === "" ? null : e.target.value,
                })
              }
              className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            >
              <option value="">— none —</option>
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
              {usedByQuery.data?.projectIds.length === 0 &&
                usedByQuery.data?.storyIds.length === 0 && (
                  <div className="italic text-[var(--text-muted)]">
                    Not attached anywhere yet.
                  </div>
                )}
              {usedByQuery.data?.projectIds.map((pid) => {
                const p = projects.find((x) => x.id === pid);
                return (
                  <div
                    key={pid}
                    className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1"
                  >
                    <span>project: {p?.name ?? pid.slice(0, 8)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        detach.mutate({
                          scope: "project",
                          scopeId: pid,
                          ref: "asset",
                          refId: asset.id,
                        })
                      }
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)]"
                    >
                      detach
                    </button>
                  </div>
                );
              })}
              {usedByQuery.data?.storyIds.map((sid) => (
                <div
                  key={sid}
                  className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1"
                >
                  <span>story: {sid.slice(0, 8)}…</span>
                  <button
                    type="button"
                    onClick={() =>
                      detach.mutate({
                        scope: "story",
                        scopeId: sid,
                        ref: "asset",
                        refId: asset.id,
                      })
                    }
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    detach
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete asset "${asset.name}"?`)) {
                  remove.mutate({ id: asset.id });
                }
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              Delete asset
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
