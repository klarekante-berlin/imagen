import { router } from "../_core/trpc";
import { assetsRouter } from "./assets";
import { charactersRouter } from "./characters";
import { projectsRouter } from "./projects";
import { templatesRouter } from "./templates";

export const appRouter = router({
  templates: templatesRouter,
  projects: projectsRouter,
  characters: charactersRouter,
  assets: assetsRouter,
});

export type AppRouter = typeof appRouter;
