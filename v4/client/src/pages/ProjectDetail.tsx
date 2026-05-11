import { useState } from "react";
import { Link, useRoute } from "wouter";
import type { Character } from "../../../drizzle/schema";
import { AssetGrid } from "../features/asset-library/AssetGrid";
import { AssetSearch } from "../features/asset-library/AssetSearch";
import {
  AssetDropZone,
  AssetUploader,
} from "../features/asset-library/AssetUploader";
import { CharacterList } from "../features/character-studio/CharacterList";
import { StoryList } from "../features/content-canvas/StoryList";
import { ProjectHeader } from "../features/project/ProjectHeader";
import { trpc } from "../lib/trpc";

type Tab = "contents" | "library" | "characters";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id ?? "";
  const project = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });
  const template = trpc.templates.get.useQuery(
    { id: project.data?.templateId ?? "" },
    { enabled: !!project.data?.templateId },
  );

  const [tab, setTab] = useState<Tab>("contents");
  const [focusedCharacter, setFocusedCharacter] = useState<Character | null>(null);

  if (!projectId) return <div>Project id missing.</div>;
  if (project.isLoading) return <div className="text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!project.data) return <div>Project not found.</div>;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          ← All projects
        </Link>
        <div className="mt-1">
          <ProjectHeader
            project={project.data}
            templateName={template.data?.name ?? project.data.templateId}
          />
        </div>
      </div>

      <div className="border-b border-[var(--border)]">
        <nav className="flex gap-6 text-sm">
          {(["contents", "library", "characters"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                if (t !== "characters") setFocusedCharacter(null);
              }}
              className={`-mb-px border-b-2 px-1 pb-3 capitalize ${
                tab === t
                  ? "border-[var(--accent)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "contents" && <StoryList projectId={projectId} />}

      {tab === "library" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <AssetSearch projectId={projectId} />
            <AssetUploader attachToProjectId={projectId} compact />
          </div>
          <AssetDropZone attachToProjectId={projectId}>
            <AssetGrid projectId={projectId} />
          </AssetDropZone>
        </div>
      )}

      {tab === "characters" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <CharacterList
            projectId={projectId}
            onSelect={setFocusedCharacter}
            selectedId={focusedCharacter?.id}
          />
          <div className="space-y-4">
            {focusedCharacter ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">
                    {focusedCharacter.name}'s sheets
                  </div>
                  <AssetUploader
                    attachToProjectId={projectId}
                    defaultKind="character_sheet"
                    characterId={focusedCharacter.id}
                    compact
                  />
                </div>
                <AssetDropZone
                  attachToProjectId={projectId}
                  characterId={focusedCharacter.id}
                  defaultKind="character_sheet"
                >
                  <AssetGrid projectId={projectId} characterId={focusedCharacter.id} />
                </AssetDropZone>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
                Select a character to manage its sheets.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
