import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  FRAME_TYPES,
  TEMPLATE_KINDS,
  TRANSPARENCY_MODES,
  type FrameType,
  type TemplateKind,
  type TransparencyMode,
} from "@v4shared/types/enums";
import type { Template } from "../../../drizzle/schema";
import { toast } from "../lib/toast";
import { trpc } from "../lib/trpc";

export default function Templates() {
  const list = trpc.templates.list.useQuery();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          ← Home
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Templates pre-fill new projects with format, frame-count range, default
          prompts (plan / write / style / anticipate), and transparency mode. Built-in
          templates can be edited but not deleted; clones are unrestricted.
        </p>
      </div>

      <Creator />

      {list.isLoading ? (
        <div className="text-sm text-[var(--text-muted)]">Loading…</div>
      ) : (
        <div className="space-y-3">
          {(list.data ?? []).map((t) => (
            <TemplateRow key={t.id} template={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Creator() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TemplateKind>("custom");

  const create = trpc.templates.create.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      setOpen(false);
      setName("");
      toast.success("Template created");
    },
    onError: (err) => toast.error("Create failed", err.message),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
      >
        + New template
      </button>
    );
  }

  return (
    <form
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        create.mutate({
          name: name.trim(),
          kind,
          defaultsJson: {
            imageFormat: "1:1",
            frameCountMin: 1,
            frameCountMax: 10,
            transparency: "opaque",
            frameType: "slide",
            defaultPrompts: { plan: "", write: "", style: "", anticipate: "" },
          },
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as TemplateKind)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        >
          {TEMPLATE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function TemplateRow({ template }: { template: Template }) {
  const utils = trpc.useUtils();
  const update = trpc.templates.update.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      toast.success("Template updated");
    },
    onError: (err) => toast.error("Update failed", err.message),
  });
  const remove = trpc.templates.delete.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      toast.success("Template deleted");
    },
    onError: (err) => toast.error("Delete failed", err.message),
  });

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(template.defaultsJson);
  const [name, setName] = useState(template.name);
  const [tagline, setTagline] = useState(template.uiHintsJson?.tagline ?? "");

  useEffect(() => {
    setDraft(template.defaultsJson);
    setName(template.name);
    setTagline(template.uiHintsJson?.tagline ?? "");
  }, [template]);

  function save() {
    update.mutate({
      id: template.id,
      name: name.trim() !== template.name ? name.trim() : undefined,
      defaultsJson: draft,
      uiHintsJson: tagline.trim() ? { tagline: tagline.trim() } : undefined,
    });
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[var(--surface-muted)]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{template.name}</span>
            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {template.kind}
            </span>
            {template.isBuiltIn && (
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                built-in
              </span>
            )}
          </div>
          {template.uiHintsJson?.tagline && (
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
              {template.uiHintsJson.tagline}
            </div>
          )}
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            {template.defaultsJson.imageFormat} · {template.defaultsJson.frameCountMin}–
            {template.defaultsJson.frameCountMax} frames · {template.defaultsJson.transparency}
          </div>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border)] p-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Tagline (optional)
              </span>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Hook → Insights → CTA"
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Image format
              </span>
              <input
                value={draft.imageFormat}
                onChange={(e) =>
                  setDraft({ ...draft, imageFormat: e.target.value })
                }
                placeholder="1:1 / 4:5 / 9:16 / 16:9"
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Frame type
              </span>
              <select
                value={draft.frameType}
                onChange={(e) =>
                  setDraft({ ...draft, frameType: e.target.value as FrameType })
                }
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              >
                {FRAME_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Min frames
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.frameCountMin}
                onChange={(e) =>
                  setDraft({ ...draft, frameCountMin: Number(e.target.value) || 1 })
                }
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Max frames
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.frameCountMax}
                onChange={(e) =>
                  setDraft({ ...draft, frameCountMax: Number(e.target.value) || 1 })
                }
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Transparency default
              </span>
              <select
                value={draft.transparency}
                onChange={(e) =>
                  setDraft({ ...draft, transparency: e.target.value as TransparencyMode })
                }
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
              >
                {TRANSPARENCY_MODES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              Default prompts
            </div>
            {(["plan", "write", "style", "anticipate"] as const).map((k) => (
              <label key={k} className="block">
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {k}
                </span>
                <textarea
                  value={draft.defaultPrompts[k]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      defaultPrompts: { ...draft.defaultPrompts, [k]: e.target.value },
                    })
                  }
                  rows={3}
                  className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px]"
                />
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
            <button
              type="button"
              disabled={template.isBuiltIn}
              onClick={() => {
                if (template.isBuiltIn) return;
                if (confirm(`Delete template "${template.name}"?`)) {
                  remove.mutate({ id: template.id });
                }
              }}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-30"
              title={
                template.isBuiltIn
                  ? "Built-in templates can be edited but not deleted"
                  : undefined
              }
            >
              Delete template
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
