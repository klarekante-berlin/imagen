import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    // Local dev: SQLite file. Production: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
    url: process.env.TURSO_DATABASE_URL ?? "file:./storage-data/imagen.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
