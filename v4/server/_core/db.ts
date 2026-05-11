import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "./env";

const client = createClient({
  url: env.dbUrl,
  authToken: env.dbAuthToken,
});

export const db = drizzle(client);
export const libsql = client;
