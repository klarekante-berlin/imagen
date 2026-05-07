type StorageBackend = "forge" | "local";

function parseStorageBackend(v: string | undefined): StorageBackend {
  return v === "local" ? "local" : "forge";
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  atlascloudApiKey: process.env.ATLASCLOUD_API_KEY ?? "",
  storageBackend: parseStorageBackend(process.env.STORAGE_BACKEND),
  storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? "./storage-data",
};
