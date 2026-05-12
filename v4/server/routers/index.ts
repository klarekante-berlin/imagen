import { router } from "../_core/trpc";
import { assetVariantsRouter } from "./asset-variants";
import { assetsRouter } from "./assets";
import { attachmentsRouter } from "./attachments";
import { charactersRouter } from "./characters";
import { framesRouter } from "./frames";
import { projectsRouter } from "./projects";
import { promptsRouter } from "./prompts";
import { renditionsRouter } from "./renditions";
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
  assetVariants: assetVariantsRouter,
  attachments: attachmentsRouter,
  stories: storiesRouter,
  scenes: scenesRouter,
  frames: framesRouter,
  renditions: renditionsRouter,
  prompts: promptsRouter,
});

export type AppRouter = typeof appRouter;
