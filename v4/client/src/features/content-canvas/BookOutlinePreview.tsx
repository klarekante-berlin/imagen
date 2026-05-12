import { useState } from "react";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import type { SectionKind } from "@v4shared/types/enums";
import { SECTION_KINDS } from "@v4shared/types/enums";

type Frame = {
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

type Props = {
  storyId: string;
  variantId: string;
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
  initialFrames: Frame[];
  stats: {
    jsonMatches: number;
    claudeWrites: number;
    autoFrames: number;
    bySection: Record<string, number>;
  };
  hasExistingScenes: boolean;
  onClose: () => void;
  onApplied: () => void;
};

const ORIGIN_LABEL: Record<Frame["origin"], string> = {
  json: "📎 JSON",
  claude: "✨ Claude",
  auto: "🪄 auto",
};

const ORIGIN_HINT: Record<Frame["origin"], string> = {
  json: "Verbatim from image_prompts.json — no LLM call",
  claude: "Claude wrote this prompt from the section content",
  auto: "Generated from the manuscript structure (Cover/ToC/Endpage/Chapter)",
};

export function BookOutlinePreview({
  storyId,
  variantId,
  parsed,
  initialFrames,
  stats,
  hasExistingScenes,
  onClose,
  onApplied,
}: Props) {
  const [frames, setFrames] = useState<Frame[]>(initialFrames);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const apply = trpc.stories.applyBookSplit.useMutation({
    onSuccess: (r) => {
      toast.success(
        "Book applied",
        `${r.sceneCount} pages · ${r.frameCount} frames written`,
      );
      onApplied();
    },
    onError: (err) => toast.error("Apply failed", err.message),
  });

  function updateFrame(idx: number, patch: Partial<Frame>) {
    setFrames((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    );
  }
  function deleteFrame(idx: number) {
    setFrames((prev) => prev.filter((_, i) => i !== idx));
  }

  // Group frames by chapter banner for the visual layout.
  const groups: Array<{ heading: string; frames: Array<{ frame: Frame; idx: number }> }> = [];
  let lastKey = "__init__";
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const key =
      f.chapterTitle ??
      (f.sectionKind === "cover"
        ? "Front cover"
        : f.sectionKind === "toc"
          ? "Table of contents"
          : f.sectionKind === "endpage"
            ? "Endpage"
            : "Other");
    if (key !== lastKey) {
      groups.push({ heading: key, frames: [] });
      lastKey = key;
    }
    groups[groups.length - 1]!.frames.push({ frame: f, idx: i });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col rounded-md bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">
              Book preview · {parsed.title || "(untitled)"}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              {parsed.stats.chapters} chapters · {parsed.stats.sections} sections ·{" "}
              {stats.jsonMatches} JSON matches · {stats.claudeWrites} Claude writes ·{" "}
              {stats.autoFrames} auto frames · {frames.length} total pages
            </p>
            {parsed.extraCharacters.length > 0 && (
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                Cast: {parsed.extraCharacters.map((c) => c.name).join(" · ")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groups.map((g, gi) => (
            <section key={gi} className="mb-4">
              <div className="sticky top-0 z-[1] bg-[var(--surface)] py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {g.heading}
              </div>
              <ul className="space-y-1.5">
                {g.frames.map(({ frame: f, idx }) => (
                  <li
                    key={idx}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[var(--text-muted)]">
                        {f.pageNumber !== null ? `p${f.pageNumber}` : "—"}
                      </span>
                      <select
                        value={f.sectionKind}
                        onChange={(e) =>
                          updateFrame(idx, { sectionKind: e.target.value as SectionKind })
                        }
                        className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[11px]"
                      >
                        {SECTION_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <span
                        className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px]"
                        title={ORIGIN_HINT[f.origin]}
                      >
                        {ORIGIN_LABEL[f.origin]}
                      </span>
                      <span className="flex-1 truncate text-[var(--text-muted)]">
                        {(f.imagePrompt || f.caption || "").slice(0, 120)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                        className="text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        {expandedIdx === idx ? "hide" : "edit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFrame(idx)}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        ✕
                      </button>
                    </div>
                    {expandedIdx === idx && (
                      <div className="mt-2 space-y-1.5">
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                            Image prompt
                          </span>
                          <textarea
                            value={f.imagePrompt}
                            onChange={(e) => updateFrame(idx, { imagePrompt: e.target.value })}
                            rows={6}
                            className="mt-0.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px]"
                          />
                        </label>
                        {f.caption && (
                          <details className="text-[11px] text-[var(--text-muted)]">
                            <summary>caption / page text</summary>
                            <pre className="mt-1 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2 font-mono text-[10px]">
                              {f.caption}
                            </pre>
                          </details>
                        )}
                        {f.jsonMetadata && (
                          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-[10px] text-[var(--text-muted)]">
                            <div>negative: {f.jsonMetadata.negativePrompt ?? "—"}</div>
                            <div>aspect: {f.jsonMetadata.aspectRatio ?? "—"}</div>
                            <div>styleRefs: {(f.jsonMetadata.styleRefs ?? []).join(", ") || "—"}</div>
                            <div>didactic: {f.jsonMetadata.didacticRole ?? "—"}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
          <div className="text-[11px] text-[var(--text-muted)]">
            {hasExistingScenes && "Apply will REPLACE existing scenes for this variant."}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={apply.isPending || frames.length === 0}
              onClick={() => {
                apply.mutate({
                  storyId,
                  variantId,
                  frames: frames.map((f) => ({
                    sectionKind: f.sectionKind as SectionKind,
                    pageNumber: f.pageNumber,
                    chapterTitle: f.chapterTitle,
                    imagePrompt: f.imagePrompt,
                    caption: f.caption,
                    jsonMetadata: f.jsonMetadata ?? null,
                  })),
                });
              }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {apply.isPending ? "Applying…" : `Apply ${frames.length} pages`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
