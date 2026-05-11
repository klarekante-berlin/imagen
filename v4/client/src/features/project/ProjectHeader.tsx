import { InlineEdit } from "../../components/InlineEdit";
import { toast } from "../../lib/toast";
import { trpc } from "../../lib/trpc";
import type { Project } from "../../../../drizzle/schema";

type Props = {
  project: Project;
  templateName?: string;
};

export function ProjectHeader({ project, templateName }: Props) {
  const utils = trpc.useUtils();
  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: project.id });
      utils.projects.list.invalidate();
    },
    onError: (err) => toast.error("Project update failed", err.message),
  });

  return (
    <div className="space-y-1">
      <InlineEdit
        value={project.name}
        placeholder="Project name"
        className="text-2xl font-semibold tracking-tight"
        onSave={(name) => update.mutateAsync({ id: project.id, name })}
      />
      <InlineEdit
        value={project.description ?? ""}
        placeholder="Add a description…"
        multiline
        className="text-sm text-[var(--text-muted)]"
        emptyClassName="text-xs italic text-[var(--text-muted)] underline-offset-2 hover:underline"
        onSave={(description) => update.mutateAsync({ id: project.id, description })}
      />
      {templateName && (
        <div className="text-xs text-[var(--text-muted)]">Template: {templateName}</div>
      )}
    </div>
  );
}
