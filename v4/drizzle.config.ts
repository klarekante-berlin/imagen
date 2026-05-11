import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./v4/drizzle/schema.ts",
  out: "./v4/drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.V4_DATABASE_URL ?? "file:./storage-data/imagen-v4.db",
    authToken: process.env.V4_DATABASE_AUTH_TOKEN,
  },
});
