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
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AssetKind>(defaultKind);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const upload = trpc.assets.uploadBase64.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (!name.trim()) {
      setError("Give it a name.");
      return;
    }
    setBusy(true);
    try {
      const { mime, base64 } = await fileToBase64(file);
      const result = await upload.mutateAsync({
        kind,
        name: name.trim(),
        mimeType: mime,
        imageBase64: base64,
        visualDescription: description.trim() || undefined,
        characterId: characterId ?? undefined,
        worldId: worldId ?? undefined,
        attachToProjectId: attachToProjectId ?? undefined,
      });
      setInfo(result.deduplicated ? "Deduplicated to existing asset." : "Uploaded.");
      setName("");
      setDescription("");
      if (inputRef.current) inputRef.current.value = "";
      utils.assets.list.invalidate();
      if (attachToProjectId) {
        utils.assets.listByProject.invalidate({ projectId: attachToProjectId });
      }
      if (worldId) utils.assets.listByWorld.invalidate({ worldId });
      if (characterId) {
        utils.assets.listByCharacter.invalidate({ characterId });
      }
      onUploaded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h3 className="text-sm font-medium">Upload asset</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">File</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
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
          {info && <span className="text-[var(--text-muted)]">{info}</span>}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}
