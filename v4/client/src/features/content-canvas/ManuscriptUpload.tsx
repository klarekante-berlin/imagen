import { useEffect, useMemo, useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import { BookOutlinePreview } from "./BookOutlinePreview";

type Props = {
  storyId: string;
  variantId: string | null;
  initialSourceText: string;
  hasScenes: boolean;
  onSplitDone: () => void;
};

type PreviewFrame = {
  sectionKind: string;
  pageNumber: number | null;
  chapterTitle: string | null;
  imagePrompt: string;
  caption?: string;
  origin: "json" | "claude" | "auto";
  cast?: string[];
  jsonMetadata?: {
    negativePrompt?: string;
    aspectRatio?: string;
    styleRefs?: string[];
    didacticRole?: string;
  } | null;
};

type ParsedPreview = {
  parsed: {
    title: string;
    stats: {
      chapters: number;
      sections: number;
      imageRefs: number;
      jsonMatches: number;
      bySection: Record<string, number>;
    };
    extraCharacters: Array<{ name: string; description: string }>;
  };
  frames: PreviewFrame[];
  stats: {
    jsonMatches: number;
    claudeWrites: number;
    autoFrames: number;
    bySection: Record<string, number>;
  };
};

type JsonShape = {
  characters?: Array<{ name: string; description: string }>;
};

async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

export function ManuscriptUpload({
  storyId,
  variantId,
  initialSourceText,
  hasScenes,
  onSplitDone,
}: Props) {
  const [markdown, setMarkdown] = useState<string>(initialSourceText);
  const [mdName, setMdName] = useState<string>(initialSourceText ? "(from story)" : "");
  const [jsonName, setJsonName] = useState<string>("");
  const [imagePromptsJson, setImagePromptsJson] = useState<JsonShape | undefined>(
    undefined,
  );
  const [autoFrontBackMatter, setAutoFrontBackMatter] = useState(true);
  const [includeChapterOpeners, setIncludeChapterOpeners] = useState(false);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Manuscript name → library character id (or null). */
  const [castMapping, setCastMapping] = useState<Record<string, string | null>>({});
  /** Bonus library characters that are not in the JSON cast but should be on
   * pages anyway (e.g. Katze, Hund). */
  const [bonusCastIds, setBonusCastIds] = useState<string[]>([]);

  const storyQuery = trpc.stories.get.useQuery({ id: storyId });
  const charactersQuery = trpc.characters.list.useQuery();
  const characters = charactersQuery.data ?? [];

  // Seed mapping with story.castMappingJson if present so re-runs preserve it.
  useEffect(() => {
    const existing = storyQuery.data?.castMappingJson;
    if (existing && Object.keys(castMapping).length === 0) {
      setCastMapping(existing);
    }
  }, [storyQuery.data, castMapping]);

  const manuscriptCharacters = useMemo(() => {
    return imagePromptsJson?.characters ?? [];
  }, [imagePromptsJson]);

  // Initialize empty mapping for each manuscript character when JSON loads.
  useEffect(() => {
    if (manuscriptCharacters.length === 0) return;
    setCastMapping((prev) => {
      const next = { ...prev };
      for (const c of manuscriptCharacters) {
        if (!(c.name in next)) next[c.name] = null;
      }
      return next;
    });
  }, [manuscriptCharacters]);

  const previewMutation = trpc.stories.previewBookSplit.useMutation({
    onSuccess: (res) => {
      setError(null);
      setPreview(res as ParsedPreview);
    },
    onError: (err) => {
      setError(err.message);
      toast.error("Preview failed", err.message);
    },
  });

  async function onMdFile(file: File | undefined) {
    if (!file) return;
    const text = await readAsText(file);
    setMarkdown(text);
    setMdName(file.name);
  }
  async function onJsonFile(file: File | undefined) {
    if (!file) return;
    const text = await readAsText(file);
    try {
      const parsed = JSON.parse(text);
      setImagePromptsJson(parsed);
      setJsonName(file.name);
    } catch (err) {
      toast.error("JSON parse failed", (err as Error).message);
    }
  }

  if (!variantId) return null;

  const mapped = Object.values(castMapping).filter(Boolean).length;
  const total = Object.keys(castMapping).length;

  return (
    <>
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Book manuscript</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Upload a Markdown manuscript (required) and an optional <code>image_prompts.json</code>{" "}
              companion. The pipeline classifies each section, reuses hand-tuned JSON prompts where
              the section has a <code>{"{{IMG:N}}"}</code>, and auto-augments Cover / ToC / Endpage.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DropZone
            label="Manuskript (.md)"
            accept=".md,.markdown,text/markdown,text/plain"
            current={mdName}
            onFile={onMdFile}
          />
          <DropZone
            label="Image prompts (.json, optional)"
            accept=".json,application/json"
            current={jsonName}
            onFile={onJsonFile}
          />
        </div>

        {(manuscriptCharacters.length > 0 || bonusCastIds.length > 0) && (
          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div className="font-medium">
                Cast mapping{" "}
                <span className="text-[var(--text-muted)]">
                  ({mapped}/{total} mapped · {bonusCastIds.length} bonus)
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">
                The pages reference these names — pick which of your library characters plays each role.
              </span>
            </div>
            <ul className="space-y-1.5">
              {manuscriptCharacters.map((c) => (
                <li
                  key={c.name}
                  className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
                >
                  <span className="min-w-[3.5rem] font-medium">{c.name}</span>
                  <span className="flex-1 truncate text-[10px] text-[var(--text-muted)]" title={c.description}>
                    {c.description.slice(0, 80)}
                  </span>
                  <select
                    value={castMapping[c.name] ?? ""}
                    onChange={(e) =>
                      setCastMapping((prev) => ({
                        ...prev,
                        [c.name]: e.target.value === "" ? null : e.target.value,
                      }))
                    }
                    className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[11px]"
                  >
                    <option value="">— unmapped —</option>
                    {characters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Bonus cast — library characters not in the JSON but used on pages
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {characters.map((ch) => {
                  const active = bonusCastIds.includes(ch.id);
                  const isMappedTarget = Object.values(castMapping).includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      disabled={isMappedTarget}
                      onClick={() =>
                        setBonusCastIds((prev) =>
                          active ? prev.filter((id) => id !== ch.id) : [...prev, ch.id],
                        )
                      }
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                          : isMappedTarget
                            ? "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] line-through opacity-50"
                            : "border-[var(--border)] hover:bg-[var(--surface)]"
                      }`}
                      title={
                        isMappedTarget
                          ? "Already mapped to a manuscript character"
                          : active
                            ? "Click to remove from bonus cast"
                            : "Click to add to bonus cast"
                      }
                    >
                      {ch.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoFrontBackMatter}
              onChange={(e) => setAutoFrontBackMatter(e.target.checked)}
            />
            Auto Cover · ToC · Endpage
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeChapterOpeners}
              onChange={(e) => setIncludeChapterOpeners(e.target.checked)}
            />
            Chapter-opener frame per ## chapter
          </label>
          <div className="ml-auto flex items-center gap-3">
            {hasScenes && (
              <span className="text-[var(--danger)]">
                applying will replace current scenes
              </span>
            )}
            <button
              type="button"
              disabled={!markdown.trim() || previewMutation.isPending}
              onClick={() => {
                setError(null);
                previewMutation.mutate({
                  storyId,
                  markdown,
                  imagePromptsJson,
                  autoFrontBackMatter,
                  includeChapterOpeners,
                  castMapping,
                  bonusCastIds,
                });
              }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {previewMutation.isPending ? "Parsing + splitting…" : "Preview book"}
            </button>
          </div>
        </div>
        {error && <div className="mt-2 text-xs text-[var(--danger)]">{error}</div>}
      </div>

      {preview && (
        <BookOutlinePreview
          storyId={storyId}
          variantId={variantId}
          parsed={preview.parsed}
          initialFrames={preview.frames}
          castMapping={castMapping}
          stats={preview.stats}
          hasExistingScenes={hasScenes}
          onClose={() => setPreview(null)}
          onApplied={() => {
            setPreview(null);
            onSplitDone();
          }}
        />
      )}
    </>
  );
}

function DropZone({
  label,
  accept,
  current,
  onFile,
}: {
  label: string;
  accept: string;
  current: string;
  onFile: (file: File | undefined) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files?.[0]);
      }}
      className={`flex h-24 cursor-pointer items-center justify-center rounded-md border border-dashed px-3 py-2 text-xs ${
        over
          ? "border-[var(--accent)] bg-[var(--surface-muted)]"
          : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
      }`}
    >
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className="text-center">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[var(--text-muted)]">
          {current ? `📎 ${current}` : "Drop file or click to choose"}
        </div>
      </div>
    </label>
  );
}
