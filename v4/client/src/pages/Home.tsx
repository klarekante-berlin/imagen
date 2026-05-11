import { useState } from "react";
import { trpc } from "../lib/trpc";

export default function Home() {
  const projectsQuery = trpc.projects.list.useQuery();
  const templatesQuery = trpc.templates.list.useQuery();
  const utils = trpc.useUtils();
  const create = trpc.projects.create.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      setName("");
    },
  });

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");

  const templates = templatesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  const canSubmit = name.trim().length > 0 && templateId.length > 0;

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Each project pins a template, system prompts, and a growing world of
          characters and assets.
        </p>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
          New project
        </h2>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            create.mutate({ name: name.trim(), templateId });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Eltern-Burnout Carousel"
              className="w-72 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">Template</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-72 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!canSubmit || create.isPending}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </form>
        {create.error && (
          <div className="mt-3 text-sm text-[var(--danger)]">
            {create.error.message}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
          All projects
        </h2>
        {projects.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
            No projects yet.
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="text-base font-medium">{p.name}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {templates.find((t) => t.id === p.templateId)?.name ?? p.templateId}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Templates
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{t.name}</div>
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {t.kind}
                </span>
              </div>
              {t.uiHintsJson?.tagline && (
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {t.uiHintsJson.tagline}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
