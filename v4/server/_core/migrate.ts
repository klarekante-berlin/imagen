import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "fs";
import path from "path";
import { db } from "./db";

export async function runMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), "v4/drizzle/migrations");
  if (!fs.existsSync(migrationsFolder)) {
    console.log("[v4 db] No migrations folder, skipping.");
    return;
  }
  console.log("[v4 db] Running migrations...");
  await migrate(db, { migrationsFolder });
  console.log("[v4 db] Migrations complete.");
}
