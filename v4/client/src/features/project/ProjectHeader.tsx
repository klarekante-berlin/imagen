import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { Project } from "../../../../drizzle/schema";

type Props = {
  project: Project;
  templateName?: string;
};

function EditableText({
  value,
  placeholder,
  multiline,
  textClassName,
  emptyClassName,
  onSave,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
  textClassName: string;
  emptyClassName?: string;
  onSave: (v: string) => Promise<unknown> | unknown;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  async function commit() {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={`block w-full text-left ${value ? textClassName : emptyClassName ?? "text-[var(--text-muted)] italic"}`}
        title="Click to edit"
      >
        {value || placeholder}
      </button>
    );
  }

  if (multiline) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit();
        }}
        disabled={busy}
        rows={3}
        placeholder={placeholder}
        className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 ${textClassName}`}
      />
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") setEditing(false);
      }}
      disabled={busy}
      placeholder={placeholder}
      className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 ${textClassName}`}
    />
  );
}

export function ProjectHeader({ project, templateName }: Props) {
  const utils = trpc.useUtils();
  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: project.id });
      utils.projects.list.invalidate();
    },
  });

  return (
    <div className="space-y-1">
      <EditableText
        value={project.name}
        placeholder="Project name"
        textClassName="text-2xl font-semibold tracking-tight"
        onSave={(name) => update.mutateAsync({ id: project.id, name })}
      />
      <EditableText
        value={project.description ?? ""}
        placeholder="Add a description…"
        multiline
        textClassName="text-sm text-[var(--text-muted)]"
        emptyClassName="text-xs italic text-[var(--text-muted)] underline-offset-2 hover:underline"
        onSave={(description) =>
          update.mutateAsync({ id: project.id, description })
        }
      />
      {templateName && (
        <div className="text-xs text-[var(--text-muted)]">Template: {templateName}</div>
      )}
    </div>
  );
}
