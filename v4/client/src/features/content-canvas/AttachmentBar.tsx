import { useMemo, useState } from "react";
import type { AttachmentRef } from "@v4shared/types/enums";
import { trpc } from "../../lib/trpc";
import { AttachmentPicker } from "./AttachmentPicker";

type Props = {
  storyId: string;
};

type PillKind = AttachmentRef;

export function AttachmentBar({ storyId }: Props) {
  const attachQuery = trpc.attachments.listByScope.useQuery({
    scope: "story",
    scopeId: storyId,
  });
  const worldsQuery = trpc.worlds.list.useQuery();
  const charactersQuery = trpc.characters.list.useQuery();
  const assetsQuery = trpc.assets.list.useQuery({
    kinds: ["style_ref", "environment", "prop"],
  });
  const utils = trpc.useUtils();
  const detach = trpc.attachments.detach.useMutation({
    onSuccess: () =>
      utils.attachments.listByScope.invalidate({ scope: "story", scopeId: storyId }),
  });

  const [pickerOpen, setPickerOpen] = useState(false);

  const attachments = attachQuery.data ?? [];

  const attachedByRef = useMemo(() => {
    const m: Record<PillKind, Set<string>> = {
      world: new Set(),
      character: new Set(),
      asset: new Set(),
    };
    for (const a of attachments) m[a.ref].add(a.refId);
    return m;
  }, [attachments]);

  const lookup = (ref: PillKind, id: string): { name: string; kind?: string } | null => {
    if (ref === "world") {
      const w = (worldsQuery.data ?? []).find((x) => x.id === id);
      return w ? { name: w.name } : null;
    }
    if (ref === "character") {
      const c = (charactersQuery.data ?? []).find((x) => x.id === id);
      return c ? { name: c.name } : null;
    }
    const a = (assetsQuery.data ?? []).find((x) => x.id === id);
    return a ? { name: a.name, kind: a.kind } : null;
  };

  const refLabel: Record<PillKind, string> = {
    world: "world",
    character: "char",
    asset: "ref",
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[var(--text-muted)]">Attached:</span>
      {attachments.length === 0 ? (
        <span className="text-[var(--text-muted)] italic">nothing yet</span>
      ) : (
        attachments.map((a) => {
          const item = lookup(a.ref, a.refId);
          const label = item?.name ?? `${a.ref}:${a.refId.slice(0, 6)}`;
          return (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] py-0.5 pl-2 pr-1"
            >
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {refLabel[a.ref]}
              </span>
              <span className="text-[var(--text)]">{label}</span>
              {item?.kind && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  ({item.kind.replace("_", " ")})
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  detach.mutate({
                    scope: "story",
                    scopeId: storyId,
                    ref: a.ref,
                    refId: a.refId,
                  })
                }
                className="ml-0.5 rounded-full px-1 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--danger)]"
                title="Detach"
              >
                ×
              </button>
            </span>
          );
        })
      )}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        + Attach
      </button>
      {pickerOpen && (
        <AttachmentPicker
          storyId={storyId}
          attachedRefIds={attachedByRef}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
