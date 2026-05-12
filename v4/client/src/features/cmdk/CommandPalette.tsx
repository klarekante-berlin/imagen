import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const projects = trpc.projects.list.useQuery(undefined, { enabled: open });
  const characters = trpc.characters.list.useQuery(undefined, { enabled: open });
  const worlds = trpc.worlds.list.useQuery(undefined, { enabled: open });
  const stories = trpc.stories.list.useQuery(undefined, { enabled: open });
  const pending = trpc.frames.listPending.useQuery(undefined, { enabled: open });

  const utils = trpc.useUtils();
  const sync = trpc.frames.syncPending.useMutation({
    onSuccess: () => utils.frames.listPending.invalidate(),
  });
  const categorizeMissing = trpc.assets.categorizeMissing.useMutation({
    onSuccess: (result) => {
      utils.assets.list.invalidate();
      toast.success(
        "Vision categorize done",
        `${result.ok}/${result.attempted} succeeded${result.failed > 0 ? ` · ${result.failed} failed` : ""}`,
      );
    },
    onError: (err) => toast.error("Categorize-all failed", err.message),
  });

  function go(href: string) {
    setLocation(href);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <Command
        className="mt-24 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        label="Command palette"
      >
        <Command.Input
          autoFocus
          placeholder="Jump to a project, character, story, or run a command…"
          className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)]"
        />
        <Command.List className="max-h-96 overflow-y-auto p-2 text-sm">
          <Command.Empty className="p-3 text-sm text-[var(--text-muted)]">
            Nothing matches.
          </Command.Empty>

          <Command.Group heading="Navigate">
            <Item label="Projects" onSelect={() => go("/")} hint="home" />
            <Item label="Library" onSelect={() => go("/library")} />
            <Item label="Characters" onSelect={() => go("/characters")} />
            <Item label="Worlds" onSelect={() => go("/worlds")} />
            <Item
              label="Jobs"
              onSelect={() => go("/jobs")}
              hint={
                pending.data && pending.data.length > 0
                  ? `${pending.data.length} pending`
                  : undefined
              }
            />
          </Command.Group>

          <Command.Group heading="Actions">
            <Item
              label="Sync Atlas predictions"
              onSelect={() => {
                sync.mutate();
                setOpen(false);
              }}
            />
            <Item
              label="Categorize all uncategorized assets (Claude vision)"
              hint="bulk auto-fill"
              onSelect={() => {
                categorizeMissing.mutate();
                setOpen(false);
              }}
            />
          </Command.Group>

          {projects.data && projects.data.length > 0 && (
            <Command.Group heading="Projects">
              {projects.data.map((p) => (
                <Item
                  key={p.id}
                  label={p.name}
                  hint={p.description ?? undefined}
                  onSelect={() => go(`/projects/${p.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {stories.data && stories.data.length > 0 && (
            <Command.Group heading="Stories">
              {stories.data.slice(0, 20).map((s) => (
                <Item
                  key={s.id}
                  label={s.title}
                  hint={s.kind}
                  onSelect={() => go(`/contents/${s.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {characters.data && characters.data.length > 0 && (
            <Command.Group heading="Characters">
              {characters.data.map((c) => (
                <Item
                  key={c.id}
                  label={c.name}
                  hint={c.description ?? undefined}
                  onSelect={() => go(`/characters/${c.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {worlds.data && worlds.data.length > 0 && (
            <Command.Group heading="Worlds">
              {worlds.data.map((w) => (
                <Item
                  key={w.id}
                  label={w.name}
                  hint={w.description ?? undefined}
                  onSelect={() => go(`/worlds/${w.id}`)}
                />
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          ↑↓ to navigate · ↵ to select · esc to close
        </div>
      </Command>
    </div>
  );
}

function Item({
  label,
  hint,
  onSelect,
}: {
  label: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-[var(--surface-muted)] aria-selected:bg-[var(--surface-muted)]"
    >
      <span>{label}</span>
      {hint && (
        <span className="ml-3 truncate text-xs text-[var(--text-muted)]">{hint}</span>
      )}
    </Command.Item>
  );
}
