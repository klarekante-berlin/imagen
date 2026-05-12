import { useEffect, useMemo, useState } from "react";
import { PROMPT_KEYS, type PromptKey } from "../../../../shared/types/enums";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

const KEY_LABEL: Record<PromptKey, string> = {
  plan: "Plan — scene/frame splitter",
  write: "Write — frame prompt writer",
  style: "Style — visual style guide",
  anticipate: "Anticipate — character anticipation",
};

const KEY_HELP: Record<PromptKey, string> = {
  plan: "Drives Claude when splitting pasted source text into scenes + frames.",
  write: "Drives Claude when expanding a frame into an Atlas image prompt.",
  style: "Style guide injected as system context whenever an image is generated.",
  anticipate: "Prompts Claude to anticipate which characters might be needed for a story.",
};

export function PromptsTab({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-muted)]">
        System prompts used by Claude in this project. Edits save as a new
        revision; the active revision is what runs. Reset restores the template
        default as a fresh revision.
      </p>
      {PROMPT_KEYS.map((key) => (
        <PromptCard key={key} projectId={projectId} promptKey={key} />
      ))}
    </div>
  );
}

function PromptCard({
  projectId,
  promptKey,
}: {
  projectId: string;
  promptKey: PromptKey;
}) {
  const utils = trpc.useUtils();
  const active = trpc.prompts.activeForProject.useQuery({ projectId });
  const revisions = trpc.prompts.listForProject.useQuery({ projectId, key: promptKey });

  const activeRev = active.data?.[promptKey] ?? null;
  const [draft, setDraft] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (activeRev) setDraft(activeRev.text);
  }, [activeRev?.id, activeRev?.text]);

  const dirty = useMemo(
    () => (activeRev ? draft !== activeRev.text : draft.length > 0),
    [draft, activeRev],
  );

  const invalidate = () => {
    utils.prompts.activeForProject.invalidate({ projectId });
    utils.prompts.listForProject.invalidate({ projectId, key: promptKey });
  };

  const createRev = trpc.prompts.createRevision.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Saved new revision");
    },
    onError: (err) => toast.error("Save failed", err.message),
  });

  const setActive = trpc.prompts.setActive.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Activated revision");
    },
    onError: (err) => toast.error("Activate failed", err.message),
  });

  const resetToTemplate = trpc.prompts.resetToTemplate.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Reset to template default");
    },
    onError: (err) => toast.error("Reset failed", err.message),
  });

  const deleteRev = trpc.prompts.delete.useMutation({
    onSuccess: () => {
      invalidate();
      toast.note("Revision deleted");
    },
    onError: (err) => toast.error("Delete failed", err.message),
  });

  const allRevs = revisions.data ?? [];
  const inactiveRevs = activeRev
    ? allRevs.filter((r) => r.id !== activeRev.id)
    : allRevs;

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{KEY_LABEL[promptKey]}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{KEY_HELP[promptKey]}</p>
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          {activeRev ? (
            <>active rev {activeRev.id.slice(0, 8)} · {new Date(activeRev.createdAt).toLocaleString()}</>
          ) : (
            <span className="text-amber-700">no active revision — using template default at run-time</span>
          )}
        </div>
      </header>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={10}
        spellCheck={false}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 font-mono text-[12px] leading-snug"
        placeholder={
          activeRev
            ? ""
            : "No active revision yet. Type a prompt and save to create one."
        }
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty || !draft.trim() || createRev.isPending}
          onClick={() =>
            createRev.mutate({
              projectId,
              key: promptKey,
              text: draft,
              activate: true,
            })
          }
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {createRev.isPending ? "Saving…" : "Save as new revision"}
        </button>
        {activeRev && dirty && (
          <button
            type="button"
            onClick={() => setDraft(activeRev.text)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-muted)]"
          >
            Discard changes
          </button>
        )}
        <button
          type="button"
          disabled={resetToTemplate.isPending}
          onClick={() => {
            if (
              !confirm(
                "Reset this prompt to the template default? A new revision will be created and activated.",
              )
            )
              return;
            resetToTemplate.mutate({ projectId, key: promptKey });
          }}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-muted)] disabled:opacity-50"
        >
          Reset to template default
        </button>
        {allRevs.length > 0 && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="ml-auto rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-muted)]"
          >
            {historyOpen ? "Hide history" : `History (${allRevs.length})`}
          </button>
        )}
      </div>

      {historyOpen && (
        <div className="mt-3 space-y-1 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
          {inactiveRevs.length === 0 && (
            <div className="px-2 py-1 text-xs text-[var(--text-muted)]">
              No other revisions.
            </div>
          )}
          {inactiveRevs.map((r) => (
            <RevisionRow
              key={r.id}
              rev={r}
              onActivate={() =>
                setActive.mutate({ projectId, revisionId: r.id })
              }
              onDelete={() => {
                if (!confirm("Delete this revision?")) return;
                deleteRev.mutate({ id: r.id });
              }}
              isActivating={setActive.isPending}
              isDeleting={deleteRev.isPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RevisionRow({
  rev,
  onActivate,
  onDelete,
  isActivating,
  isDeleting,
}: {
  rev: { id: string; text: string; note: string | null; createdAt: string };
  onActivate: () => void;
  onDelete: () => void;
  isActivating: boolean;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-transparent px-2 py-1.5 hover:border-[var(--border)]">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-[var(--text-muted)]">
          {rev.id.slice(0, 8)}
        </span>
        <span className="text-[var(--text-muted)]">
          {new Date(rev.createdAt).toLocaleString()}
        </span>
        {rev.note && <span className="text-[var(--text-muted)]">· {rev.note}</span>}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {expanded ? "hide" : "preview"}
        </button>
        <button
          type="button"
          onClick={onActivate}
          disabled={isActivating}
          className="rounded-md border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--surface-muted)] disabled:opacity-50"
        >
          Make active
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-red-700 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {expanded && (
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[11px] leading-snug">
          {rev.text}
        </pre>
      )}
    </div>
  );
}
