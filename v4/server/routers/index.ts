import { router } from "../_core/trpc";
import { assetsRouter } from "./assets";
import { attachmentsRouter } from "./attachments";
import { charactersRouter } from "./characters";
import { framesRouter } from "./frames";
import { projectsRouter } from "./projects";
import { scenesRouter } from "./scenes";
import { storiesRouter } from "./stories";
import { templatesRouter } from "./templates";
import { worldsRouter } from "./worlds";

export const appRouter = router({
  templates: templatesRouter,
  projects: projectsRouter,
  worlds: worldsRouter,
  characters: charactersRouter,
  assets: assetsRouter,
  attachments: attachmentsRouter,
  stories: storiesRouter,
  scenes: scenesRouter,
  frames: framesRouter,
});

export type AppRouter = typeof appRouter;
