/**
 * CLI script: backfill Voyage AI embeddings for all assets that don't have one yet.
 *
 * Usage:
 *   pnpm embed:backfill
 *   pnpm embed:backfill --batch-size 3 --delay 2000
 *
 * Options:
 *   --batch-size  Number of assets per batch (default: 5)
 *   --delay       Delay in ms between batches (default: 1000)
 *   --dry-run     Print what would be done without calling the API
 */
import "dotenv/config";
import { getDb } from "../server/db.js";
import { assets } from "../drizzle/schema.js";
import { isNull } from "drizzle-orm";
import { backfillEmbeddings } from "../server/embeddingService.js";

const args = process.argv.slice(2);
const batchSize = parseInt(args[args.indexOf("--batch-size") + 1] ?? "5") || 5;
const delay = parseInt(args[args.indexOf("--delay") + 1] ?? "1000") || 1000;
const dryRun = args.includes("--dry-run");

async function main() {
  const db = getDb();

  // Count assets without embeddings
  const pending = await db
    .select({ id: assets.id, name: assets.name, category: assets.category })
    .from(assets)
    .where(isNull(assets.embedding));

  console.log(`\n🔍 Assets without embeddings: ${pending.length}`);

  if (pending.length === 0) {
    console.log("✅ All assets already have embeddings. Nothing to do.\n");
    process.exit(0);
  }

  if (dryRun) {
    console.log("\n🔎 Dry-run mode – would embed these assets:");
    pending.forEach((a) => console.log(`  [${a.id}] ${a.name} (${a.category})`));
    console.log("\nRun without --dry-run to actually embed them.\n");
    process.exit(0);
  }

  if (!process.env.VOYAGE_API_KEY) {
    console.error("❌ VOYAGE_API_KEY is not set. Add it to your .env file.");
    process.exit(1);
  }

  console.log(`\n⚡ Starting backfill: batch=${batchSize}, delay=${delay}ms\n`);

  const { total, embedded, skipped, errors } = await backfillEmbeddings(batchSize, delay);

  console.log("\n─────────────────────────────────────");
  console.log(`📦 Total     : ${total}`);
  console.log(`✅ Embedded  : ${embedded}`);
  console.log(`⏭  Skipped   : ${skipped}`);
  console.log(`❌ Errors    : ${errors}`);
  console.log("─────────────────────────────────────\n");

  if (errors > 0) {
    console.warn(`⚠️  ${errors} assets failed to embed. Run again to retry.\n`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
