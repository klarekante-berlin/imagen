import { router } from "../_core/trpc";
import { assetsRouter } from "./assets";
import { attachmentsRouter } from "./attachments";
import { charactersRouter } from "./characters";
import { projectsRouter } from "./projects";
import { templatesRouter } from "./templates";
import { worldsRouter } from "./worlds";

export const appRouter = router({
  templates: templatesRouter,
  projects: projectsRouter,
  worlds: worldsRouter,
  characters: charactersRouter,
  assets: assetsRouter,
  attachments: attachmentsRouter,
});

export type AppRouter = typeof appRouter;
