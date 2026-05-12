import { useEffect, useMemo, useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

type Props = {
  storyId: string;
};

/**
 * Always-visible panel on a book story's ContentCanvas. Shows the current
 * cast mapping + lets the user edit & save it without re-running the full
 * split, and exposes the "Re-sanitize prompts" action.
 */
export function BookCastPanel({ storyId }: Props) {
  const storyQuery = trpc.stories.get.useQuery({ id: storyId });
  const charactersQuery = trpc.characters.list.useQuery();
  const utils = trpc.useUtils();

  const initialMapping = storyQuery.data?.castMappingJson ?? {};
  const [draft, setDraft] = useState<Record<string, string | null>>(initialMapping);
  const [pendingName, setPendingName] = useState("");

  useEffect(() => {
    if (storyQuery.data?.castMappingJson) {
      setDraft(storyQuery.data.castMappingJson);
    }
  }, [storyQuery.data?.castMappingJson]);

  const save = trpc.stories.updateStoryCast.useMutation({
    onSuccess: () => {
      utils.stories.get.invalidate({ id: storyId });
      toast.success("Cast mapping saved");
    },
    onError: (err) => toast.error("Save failed", err.message),
  });
  const sanitize = trpc.stories.resanitizeBookPrompts.useMutation({
    onSuccess: (r) => {
      utils.frames.get.invalidate();
      utils.frames.listByScene.invalidate();
      toast.success(
        "Prompts re-sanitized",
        `${r.touched} updated · ${r.unchanged} unchanged`,
      );
    },
    onError: (err) => toast.error("Re-sanitize failed", err.message),
  });

  const characters = charactersQuery.data ?? [];
  const entries = useMemo(() => Object.entries(draft), [draft]);

  if (!storyQuery.data) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialMapping);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Book cast mapping</h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Names that appear in the manuscript (e.g. "Mika") → your library
            characters. Re-sanitize rewrites every page's image prompt with the
            current mapping. No Atlas calls.
          </p>
        </div>
        <button
          type="button"
          disabled={sanitize.isPending}
          onClick={() => sanitize.mutate({ storyId })}
          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--surface-muted)] disabled:opacity-50"
          title="Walk every frame.imagePrompt and replace mapped names + strip stale character descriptions."
        >
          {sanitize.isPending ? "Sanitizing…" : "Re-sanitize prompts"}
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-2 text-[11px] text-[var(--text-muted)]">
          No mapping yet. Add a manuscript name below or re-upload .md + .json
          via the manuscript section.
        </div>
      ) : (
        <ul className="space-y-1">
          {entries.map(([manuscriptName, charId]) => (
            <li
              key={manuscriptName}
              className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            >
              <span className="min-w-[4rem] font-medium">{manuscriptName}</span>
              <select
                value={charId ?? ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    [manuscriptName]: e.target.value === "" ? null : e.target.value,
                  }))
                }
                className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[11px]"
              >
                <option value="">— unmapped —</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => {
                    const next = { ...prev };
                    delete next[manuscriptName];
                    return next;
                  })
                }
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <input
          value={pendingName}
          onChange={(e) => setPendingName(e.target.value)}
          placeholder="+ add manuscript name (e.g. Mika)"
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={!pendingName.trim() || pendingName in draft}
          onClick={() => {
            setDraft((prev) => ({ ...prev, [pendingName.trim()]: null }));
            setPendingName("");
          }}
          className="rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50"
        >
          add
        </button>
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ storyId, castMapping: draft })}
          className="rounded-md bg-[var(--accent)] px-2.5 py-1 font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : dirty ? "Save mapping" : "Saved"}
        </button>
      </div>
    </div>
  );
}
