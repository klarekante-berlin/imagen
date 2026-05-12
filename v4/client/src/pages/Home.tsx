import { useState } from "react";
import { Link } from "wouter";
import { toast } from "../lib/toast";
import { trpc } from "../lib/trpc";

function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function Home() {
  const projectsQuery = trpc.projects.listWithCounts.useQuery();
  const templatesQuery = trpc.templates.list.useQuery();

  const utils = trpc.useUtils();
  const create = trpc.projects.create.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      utils.projects.listWithCounts.invalidate();
      toast.success("Project created");
      setName("");
      setCreatorOpen(false);
    },
    onError: (err) => toast.error("Create failed", err.message),
  });

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");

  const templates = templatesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const canSubmit = name.trim().length > 0 && templateId.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Click a row to open. Each project pins a template, system prompts, and a
            growing pool of stories.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreatorOpen((v) => !v)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          {creatorOpen ? "Cancel" : "+ New project"}
        </button>
      </div>

      {creatorOpen && (
        <form
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            create.mutate({ name: name.trim(), templateId });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Eltern-Burnout Carousel"
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">Template</span>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                <option value="">Choose…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={!canSubmit || create.isPending}
            className="mt-3 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create project"}
          </button>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
          No projects yet. Click <strong>+ New project</strong>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium text-right">Stories</th>
                <th className="px-3 py-2 font-medium text-right">Assets</th>
                <th className="px-3 py-2 font-medium text-right">Chars</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const template = templates.find((t) => t.id === p.templateId);
                const lastTouch = p.lastStoryAt ?? p.updatedAt;
                return (
                  <tr
                    key={p.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--surface-muted)]"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/projects/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.description && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-muted)]">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      {template?.name ?? p.templateId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.storyCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.attachedAssetCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.attachedCharacterCount}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      {relTime(lastTouch)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/projects/${p.id}`}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] text-[var(--text-muted)]">
        <Link href="/templates" className="hover:text-[var(--text)] hover:underline">
          Manage templates →
        </Link>
      </div>
    </div>
  );
}
