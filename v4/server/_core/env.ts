import "dotenv/config";

export const env = {
  port: Number(process.env.V4_PORT ?? 4445),
  nodeEnv: process.env.NODE_ENV ?? "development",
  dbUrl: process.env.V4_DATABASE_URL ?? "file:./storage-data/imagen-v4.db",
  dbAuthToken: process.env.V4_DATABASE_AUTH_TOKEN,
} as const;
