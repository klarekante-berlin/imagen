import { useState } from "react";
import { Link } from "wouter";
import { STORY_KINDS, type StoryKind } from "@v4shared/types/enums";
import { trpc } from "../../lib/trpc";

type Props = {
  projectId: string;
};

export function StoryList({ projectId }: Props) {
  const list = trpc.stories.listByProject.useQuery({ projectId });
  const utils = trpc.useUtils();
  const create = trpc.stories.create.useMutation({
    onSuccess: () => {
      utils.stories.listByProject.invalidate({ projectId });
      setTitle("");
    },
  });
  const remove = trpc.stories.delete.useMutation({
    onSuccess: () => utils.stories.listByProject.invalidate({ projectId }),
  });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<StoryKind>("story");

  const stories = list.data ?? [];

  return (
    <div className="space-y-4">
      <form
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          create.mutate({ projectId, kind, title: title.trim() });
        }}
      >
        <h3 className="text-sm font-medium">New content</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Eltern-Burnout Carousel"
              className="w-64 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending || !title.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>

      {stories.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          No content yet. Create a story, reel, book, or single illustration.
        </div>
      ) : (
        <ul className="grid gap-2">
          {stories.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {s.kind}
                </span>
                <Link
                  href={`/contents/${s.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {s.title}
                </Link>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${s.title}"?`)) remove.mutate({ id: s.id });
                }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
