import { router } from "../_core/trpc";
import { projectsRouter } from "./projects";
import { templatesRouter } from "./templates";

export const appRouter = router({
  templates: templatesRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
