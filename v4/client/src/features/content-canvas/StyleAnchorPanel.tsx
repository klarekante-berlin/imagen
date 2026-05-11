import { useEffect, useMemo, useState } from "react";
import { trpc } from "../../lib/trpc";

type Props = {
  storyId: string;
  projectId: string | null;
};

export function StyleAnchorPanel({ storyId, projectId }: Props) {
  const storyQuery = trpc.stories.get.useQuery({ id: storyId });
  const projectQuery = trpc.projects.get.useQuery(
    { id: projectId ?? "" },
    { enabled: !!projectId },
  );
  const refsQuery = trpc.stories.previewReferenceAssets.useQuery({ storyId });

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.stories.get.invalidate({ id: storyId });
    if (projectId) utils.projects.get.invalidate({ id: projectId });
    utils.stories.previewReferenceAssets.invalidate({ storyId });
  };

  const extractStory = trpc.stories.extractStyleAnchor.useMutation({
    onSuccess: invalidate,
  });
  const extractProject = trpc.projects.extractStyleAnchor.useMutation({
    onSuccess: invalidate,
  });
  const updateStory = trpc.stories.updateStyleAnchor.useMutation({
    onSuccess: invalidate,
  });
  const updateProject = trpc.projects.updateStyleAnchor.useMutation({
    onSuccess: invalidate,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"story" | "project">("story");

  const story = storyQuery.data;
  const project = projectQuery.data;
  const storyText = story?.styleAnchorText ?? null;
  const projectText = project?.styleAnchorText ?? null;
  const effective = storyText ?? projectText ?? null;
  const effectiveSource = storyText ? "story" : projectText ? "project" : null;
  const refs = refsQuery.data?.refs ?? [];
  const refCount = refs.length;
  const charRefCount = refs.filter((r) => r.source === "character_primary").length;
  const attachedRefCount = refs.filter((r) => r.source === "attached_asset").length;

  useEffect(() => {
    if (!editing) {
      setDraft((scope === "story" ? storyText : projectText) ?? "");
    }
  }, [editing, scope, storyText, projectText]);

  const lastExtracted = useMemo(() => {
    const ts = scope === "story" ? story?.styleAnchorUpdatedAt : project?.styleAnchorUpdatedAt;
    if (!ts) return null;
    const d = new Date(ts);
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    return `${Math.round(sec / 3600)}h ago`;
  }, [scope, story?.styleAnchorUpdatedAt, project?.styleAnchorUpdatedAt]);

  const busy = extractStory.isPending || extractProject.isPending || updateStory.isPending || updateProject.isPending;

  function save() {
    const text = draft.trim() || null;
    if (scope === "story") updateStory.mutate({ storyId, text });
    else if (projectId) updateProject.mutate({ projectId, text });
    setEditing(false);
  }

  function clear() {
    if (scope === "story") updateStory.mutate({ storyId, text: null });
    else if (projectId) updateProject.mutate({ projectId, text: null });
  }

  function extract() {
    if (scope === "story") extractStory.mutate({ storyId });
    else if (projectId) extractProject.mutate({ projectId });
  }

  const extractError = scope === "story" ? extractStory.error : extractProject.error;
  const scopeText = scope === "story" ? storyText : projectText;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Style anchor</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Vision-distilled style description prepended to every frame prompt. Reference
            images stay as image refs at generate time.
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <span>Scope:</span>
          <button
            type="button"
            onClick={() => setScope("story")}
            className={`rounded-md px-2 py-1 ${
              scope === "story"
                ? "bg-[var(--surface-muted)] text-[var(--text)]"
                : "hover:text-[var(--text)]"
            }`}
          >
            this story
          </button>
          <button
            type="button"
            onClick={() => setScope("project")}
            disabled={!projectId}
            className={`rounded-md px-2 py-1 disabled:opacity-40 ${
              scope === "project"
                ? "bg-[var(--surface-muted)] text-[var(--text)]"
                : "hover:text-[var(--text)]"
            }`}
          >
            project default
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>
          References available: <strong>{refCount}</strong>
          {refCount > 0 && (
            <span className="ml-1 text-[var(--text-muted)]">
              ({charRefCount} char sheet{charRefCount === 1 ? "" : "s"} ·{" "}
              {attachedRefCount} direct)
            </span>
          )}
          {refCount === 0 && " — attach a character (with a sheet) or an asset first"}
        </span>
        {effective && (
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide">
            active from {effectiveSource}
          </span>
        )}
        {lastExtracted && <span>· updated {lastExtracted}</span>}
      </div>

      {!editing ? (
        <div className="mt-3 space-y-2">
          {scopeText ? (
            <p className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs leading-relaxed">
              {scopeText}
            </p>
          ) : (
            <div className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
              No {scope === "story" ? "story-level override" : "project default"} yet.
              {scope === "story" && projectText && (
                <span> Falls back to project default at generate time.</span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={extract}
              disabled={busy || refCount === 0}
              title={
                refCount === 0
                  ? "Attach reference images first"
                  : "Run Claude vision over the references and distill a style spec"
              }
              className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {scope === "story"
                ? extractStory.isPending ? "Extracting…" : "Extract from references"
                : extractProject.isPending ? "Extracting…" : "Extract from references"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {scopeText ? "Edit" : "Write manually"}
            </button>
            {scopeText && (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                Clear
              </button>
            )}
          </div>
          {extractError && (
            <div className="text-xs text-[var(--danger)]">{extractError.message}</div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="e.g. Flat editorial illustration, warm-gold + deep navy duotone, paper-grain texture, thick hand-drawn outline. Bold sans-serif with thick black highlight bars."
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
