import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { createServer } from "http";
import { appRouter } from "../routers";
import { db } from "./db";
import { env } from "./env";
import { runMigrations } from "./migrate";
import { startPendingPoller } from "./pending-poller";
import { registerStorageProxy } from "./storageProxy";
import { createContext } from "./trpc";
import { serveStatic, setupVite } from "./vite";

async function main() {
  await runMigrations();

  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: "v4", dbUrl: env.dbUrl });
  });

  registerStorageProxy(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext }),
  );

  if (env.nodeEnv === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  server.listen(env.port, () => {
    console.log(`[v4] Server on http://localhost:${env.port}/`);
    console.log(`[v4] DB: ${env.dbUrl}`);
    startPendingPoller();
  });
}

main().catch((err) => {
  console.error("[v4] Fatal:", err);
  process.exit(1);
});

void db;
