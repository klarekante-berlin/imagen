import { useState } from "react";

type Props = {
  value: string;
  placeholder: string;
  multiline?: boolean;
  /** Tailwind classes for the rendered text and the input. */
  className: string;
  /** Classes for the rendered text when value is empty. */
  emptyClassName?: string;
  onSave: (v: string) => Promise<unknown> | unknown;
};

/**
 * Click-to-edit text or textarea, save on blur / Enter (single-line)
 * / Cmd+Enter (multiline), cancel on Escape.
 */
export function InlineEdit({
  value,
  placeholder,
  multiline,
  className,
  emptyClassName,
  onSave,
}: Props) {
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
        className={`block w-full text-left ${value ? className : emptyClassName ?? "text-[var(--text-muted)] italic"}`}
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
        className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 ${className}`}
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
      className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 ${className}`}
    />
  );
}
