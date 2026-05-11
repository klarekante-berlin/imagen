import { useState } from "react";
import { trpc } from "../../lib/trpc";

type Props = {
  storyId: string;
  activeVariantId: string | null;
  onSelect: (variantId: string) => void;
};

export function VariantTabs({ storyId, activeVariantId, onSelect }: Props) {
  const variantsQuery = trpc.stories.listVariants.useQuery({ storyId });
  const utils = trpc.useUtils();
  const invalidate = () => utils.stories.listVariants.invalidate({ storyId });

  const addVariant = trpc.stories.addVariant.useMutation({
    onSuccess: (variant) => {
      invalidate();
      onSelect(variant.id);
    },
  });
  const setPrimary = trpc.stories.setPrimaryVariant.useMutation({
    onSuccess: invalidate,
  });
  const rename = trpc.stories.renameVariant.useMutation({ onSuccess: invalidate });
  const remove = trpc.stories.deleteVariant.useMutation({
    onSuccess: (_data, vars) => {
      invalidate();
      if (vars.id === activeVariantId) {
        const fallback = (variantsQuery.data ?? []).find((v) => v.id !== vars.id);
        if (fallback) onSelect(fallback.id);
      }
    },
  });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const variants = variantsQuery.data ?? [];

  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {variants.map((v) => {
          const isActive = v.id === activeVariantId;
          return (
            <div key={v.id} className="flex items-center">
              {renamingId === v.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    if (draft.trim() && draft.trim() !== v.name) {
                      rename.mutate({ id: v.id, name: draft.trim() });
                    }
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(v.id)}
                  onDoubleClick={() => {
                    setRenamingId(v.id);
                    setDraft(v.name);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
                    isActive
                      ? "bg-[var(--surface-muted)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  }`}
                  title="Double-click to rename"
                >
                  <span>{v.name}</span>
                  {v.isPrimary && (
                    <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--accent-fg)]">
                      primary
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            addVariant.mutate({
              storyId,
              copyFromVariantId: activeVariantId ?? undefined,
            })
          }
          disabled={addVariant.isPending}
          className="ml-1 rounded-md px-2 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)] disabled:opacity-50"
          title={activeVariantId ? "Duplicate active variant" : "Add new variant"}
        >
          + Variant
        </button>
      </div>

      {activeVariantId && (
        <div className="ml-auto flex items-center gap-2 text-xs">
          {(() => {
            const active = variants.find((v) => v.id === activeVariantId);
            if (!active) return null;
            return (
              <>
                {!active.isPrimary && (
                  <button
                    type="button"
                    onClick={() => setPrimary.mutate({ id: active.id })}
                    className="rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-muted)]"
                  >
                    Make primary
                  </button>
                )}
                {variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete variant "${active.name}" with all its scenes & frames?`)) {
                        remove.mutate({ id: active.id });
                      }
                    }}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    Delete variant
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
