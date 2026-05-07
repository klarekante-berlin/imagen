type StorageBackend = "forge" | "local";

function parseStorageBackend(v: string | undefined): StorageBackend {
  return v === "local" ? "local" : "forge";
}

export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  atlascloudApiKey: process.env.ATLASCLOUD_API_KEY ?? "",
  storageBackend: parseStorageBackend(process.env.STORAGE_BACKEND),
  storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? "./storage-data",
};
