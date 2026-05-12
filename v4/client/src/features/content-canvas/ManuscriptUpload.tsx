import { useState } from "react";
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
  const [imagePromptsJson, setImagePromptsJson] = useState<unknown | undefined>(
    undefined,
  );
  const [autoFrontBackMatter, setAutoFrontBackMatter] = useState(true);
  const [includeChapterOpeners, setIncludeChapterOpeners] = useState(false);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                applying will replace {hasScenes ? "current" : ""} scenes
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
