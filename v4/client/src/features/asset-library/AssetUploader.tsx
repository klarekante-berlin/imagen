import { useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import type { AssetKind } from "@v4shared/types/enums";
import { ASSET_KINDS } from "@v4shared/types/enums";

type Props = {
  /** When set, the uploaded asset is also attached to this project. */
  attachToProjectId?: string | null;
  /** When set, the uploaded asset is linked to this character via FK. */
  characterId?: string | null;
  /** When set, the uploaded asset is bound to this world via FK. */
  worldId?: string | null;
  defaultKind?: AssetKind;
  /** Render a compact button by default (expand on click), instead of an always-open form. */
  compact?: boolean;
  onUploaded?: () => void;
};

async function fileToBase64(file: File): Promise<{ mime: string; base64: string }> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return { mime: file.type || "image/png", base64: btoa(binary) };
}

export function AssetUploader({
  attachToProjectId = null,
  characterId = null,
  worldId = null,
  defaultKind = "character_sheet",
  compact = false,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AssetKind>(defaultKind);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const [hasFile, setHasFile] = useState(false);

  const utils = trpc.useUtils();
  const upload = trpc.assets.uploadBase64.useMutation();

  async function uploadFile(file: File, providedName?: string) {
    setError(null);
    setInfo(null);
    const finalName = providedName ?? name.trim() ?? file.name;
    if (!finalName.trim()) {
      setError("Give it a name.");
      return;
    }
    setBusy(true);
    try {
      const { mime, base64 } = await fileToBase64(file);
      const result = await upload.mutateAsync({
        kind,
        name: finalName.trim(),
        mimeType: mime,
        imageBase64: base64,
        visualDescription: description.trim() || undefined,
        characterId: characterId ?? undefined,
        worldId: worldId ?? undefined,
        attachToProjectId: attachToProjectId ?? undefined,
      });
      setInfo(
        result.deduplicated ? `Deduplicated: ${finalName}` : `Uploaded: ${finalName}`,
      );
      setName("");
      setDescription("");
      setHasFile(false);
      if (inputRef.current) inputRef.current.value = "";
      utils.assets.list.invalidate();
      if (attachToProjectId) {
        utils.assets.listByProject.invalidate({ projectId: attachToProjectId });
      }
      if (worldId) utils.assets.listByWorld.invalidate({ worldId });
      if (characterId) utils.assets.listByCharacter.invalidate({ characterId });
      onUploaded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    await uploadFile(file);
  }

  // Compact button surface (closed state)
  if (compact && !open) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
        >
          + Upload asset
        </button>
        {info && <span className="text-xs text-[var(--text-muted)]">{info}</span>}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Upload asset</h3>
        {compact && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            close
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">File</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={() => setHasFile(!!inputRef.current?.files?.length)}
            className="text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AssetKind)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          >
            {ASSET_KINDS.filter((k) => k !== "generated_frame").map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs text-[var(--text-muted)]">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Papa frontal"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs text-[var(--text-muted)]">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs">
          {error && <span className="text-[var(--danger)]">{error}</span>}
          {info && !error && <span className="text-[var(--text-muted)]">{info}</span>}
        </div>
        <button
          type="submit"
          disabled={busy || !hasFile}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

/** Drop-target wrapper that uploads each dropped file in turn. */
export function AssetDropZone({
  children,
  attachToProjectId = null,
  characterId = null,
  worldId = null,
  defaultKind = "character_sheet",
  onUploaded,
}: Omit<Props, "compact"> & { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const upload = trpc.assets.uploadBase64.useMutation();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatus(`Uploading 0 / ${files.length}…`);
    let ok = 0;
    let dedup = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (!f.type.startsWith("image/")) {
        failed++;
        continue;
      }
      try {
        const { mime, base64 } = await fileToBase64(f);
        const baseName = f.name.replace(/\.[^.]+$/, "");
        const result = await upload.mutateAsync({
          kind: defaultKind,
          name: baseName,
          mimeType: mime,
          imageBase64: base64,
          characterId: characterId ?? undefined,
          worldId: worldId ?? undefined,
          attachToProjectId: attachToProjectId ?? undefined,
        });
        if (result.deduplicated) dedup++;
        else ok++;
      } catch (err) {
        console.error("[v4 drop]", (err as Error).message);
        failed++;
      }
      setStatus(`Uploading ${i + 1} / ${files.length}…`);
    }
    utils.assets.list.invalidate();
    if (attachToProjectId)
      utils.assets.listByProject.invalidate({ projectId: attachToProjectId });
    if (worldId) utils.assets.listByWorld.invalidate({ worldId });
    if (characterId) utils.assets.listByCharacter.invalidate({ characterId });
    onUploaded?.();
    setBusy(false);
    setStatus(
      `${ok} uploaded · ${dedup} dedup'd${failed > 0 ? ` · ${failed} failed` : ""}`,
    );
    setTimeout(() => setStatus(null), 4000);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className="relative"
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-md border-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/10">
          <div className="rounded-md bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] shadow">
            Drop to upload
          </div>
        </div>
      )}
      {(busy || status) && (
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          {busy ? "⟳ " : ""}
          {status}
        </div>
      )}
    </div>
  );
}
