import { useMemo, useState } from "react";
import type { AttachmentRef } from "@v4shared/types/enums";
import { trpc } from "../../lib/trpc";

type Props = {
  storyId: string;
  attachedRefIds: Record<AttachmentRef, Set<string>>;
  onClose: () => void;
};

type Tab = AttachmentRef;

export function AttachmentPicker({ storyId, attachedRefIds, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("world");
  const [query, setQuery] = useState("");

  const worldsQuery = trpc.worlds.list.useQuery();
  const charactersQuery = trpc.characters.list.useQuery();
  const assetsQuery = trpc.assets.list.useQuery({ kinds: ["style_ref", "environment", "prop"] });

  const utils = trpc.useUtils();
  const attach = trpc.attachments.attach.useMutation({
    onSuccess: () => {
      utils.attachments.listByScope.invalidate({ scope: "story", scopeId: storyId });
      utils.stories.previewReferenceAssets.invalidate({ storyId });
    },
  });

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = <T extends { name: string; id: string }>(rows: T[]): T[] =>
      q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    if (tab === "world") return filter(worldsQuery.data ?? []);
    if (tab === "character") return filter(charactersQuery.data ?? []);
    return filter(assetsQuery.data ?? []);
  }, [tab, query, worldsQuery.data, charactersQuery.data, assetsQuery.data]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="mt-16 w-full max-w-2xl rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-medium">Attach to story</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-[var(--border)] px-4 pt-3">
          {(["world", "character", "asset"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-2 py-2 text-sm capitalize ${
                tab === t
                  ? "border-[var(--accent)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {t === "asset" ? "Style refs / assets" : `${t}s`}
            </button>
          ))}
        </div>

        <div className="space-y-3 p-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab}s…`}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />

          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
              Nothing matches.
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => {
                const isAttached = attachedRefIds[tab].has(item.id);
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      {"description" in item && item.description && (
                        <div className="truncate text-xs text-[var(--text-muted)]">
                          {item.description}
                        </div>
                      )}
                      {"kind" in item && (
                        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                          {String(item.kind).replace("_", " ")}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        !isAttached &&
                        attach.mutate({
                          scope: "story",
                          scopeId: storyId,
                          ref: tab,
                          refId: item.id,
                        })
                      }
                      disabled={isAttached || attach.isPending}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50 hover:bg-[var(--surface-muted)]"
                    >
                      {isAttached ? "Attached" : "Attach"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
