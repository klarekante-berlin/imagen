import { useState } from "react";
import { Link, useRoute } from "wouter";
import type { Character } from "../../../drizzle/schema";
import { AssetGrid } from "../features/asset-library/AssetGrid";
import { AssetSearch } from "../features/asset-library/AssetSearch";
import {
  AssetDropZone,
  AssetUploader,
} from "../features/asset-library/AssetUploader";
import { CharacterEditor } from "../features/character-studio/CharacterEditor";
import { CharacterList } from "../features/character-studio/CharacterList";
import { StoryList } from "../features/content-canvas/StoryList";
import { ProjectHeader } from "../features/project/ProjectHeader";
import { PromptsTab } from "../features/prompts/PromptsTab";
import { trpc } from "../lib/trpc";

type Tab = "contents" | "library" | "characters" | "prompts";

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
          {(["contents", "library", "characters", "prompts"] as Tab[]).map((t) => (
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

      {tab === "prompts" && <PromptsTab projectId={projectId} />}

      {tab === "characters" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <CharacterList
            projectId={projectId}
            onSelect={setFocusedCharacter}
            selectedId={focusedCharacter?.id}
          />
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            {focusedCharacter ? (
              <CharacterEditor
                characterId={focusedCharacter.id}
                showDetailLink
                onDeleted={() => setFocusedCharacter(null)}
              />
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-sm text-[var(--text-muted)]">
                Select a character on the left to edit description, persona, aliases,
                world, and manage sheets. Same tools as the dedicated character page.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
