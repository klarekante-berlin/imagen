import { useState } from "react";
import { Link } from "wouter";
import { STORY_KINDS, type StoryKind } from "@v4shared/types/enums";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

type Props = {
  projectId: string;
};

function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function StoryList({ projectId }: Props) {
  const list = trpc.stories.listByProjectWithCounts.useQuery({ projectId });
  const utils = trpc.useUtils();
  const create = trpc.stories.create.useMutation({
    onSuccess: () => {
      utils.stories.listByProject.invalidate({ projectId });
      utils.stories.listByProjectWithCounts.invalidate({ projectId });
      setTitle("");
      setCreatorOpen(false);
      toast.success("Story created");
    },
    onError: (err) => toast.error("Create failed", err.message),
  });
  const remove = trpc.stories.delete.useMutation({
    onSuccess: () => {
      utils.stories.listByProject.invalidate({ projectId });
      utils.stories.listByProjectWithCounts.invalidate({ projectId });
      toast.success("Story deleted");
    },
    onError: (err) => toast.error("Delete failed", err.message),
  });

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<StoryKind>("story");

  const stories = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm text-[var(--text-muted)]">
          Stories, reels, books, single illustrations. Click any title to open the
          canvas.
        </div>
        <button
          type="button"
          onClick={() => setCreatorOpen((v) => !v)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          {creatorOpen ? "Cancel" : "+ New content"}
        </button>
      </div>

      {creatorOpen && (
        <form
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({ projectId, kind, title: title.trim() });
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as StoryKind)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                {STORY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">Title</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Eltern-Burnout Carousel"
                className="w-72 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={create.isPending || !title.trim()}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {stories.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          No content yet. Create a story, reel, book, or single illustration.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium text-right">Scenes</th>
                <th className="px-3 py-2 font-medium">Frames</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {stories.map((s) => {
                const breakdown =
                  s.frameCount === 0
                    ? "—"
                    : [
                        s.framesReady > 0 && `${s.framesReady} ready`,
                        s.framesGenerating > 0 && `${s.framesGenerating} generating`,
                        s.framesError > 0 && `${s.framesError} error`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || `${s.frameCount}`;
                return (
                  <tr
                    key={s.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--surface-muted)]"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/contents/${s.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        {s.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.sceneCount}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="tabular-nums">{s.frameCount}</span>
                      {s.frameCount > 0 && (
                        <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                          {breakdown !== `${s.frameCount}` && `· ${breakdown}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      {relTime(s.updatedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/contents/${s.id}`}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        open →
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete "${s.title}"?`)) remove.mutate({ id: s.id });
                        }}
                        className="ml-3 text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
