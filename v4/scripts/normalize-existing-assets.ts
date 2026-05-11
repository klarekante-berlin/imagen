import "dotenv/config";

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../server/_core/db";
import { assets } from "../drizzle/schema";
import {
  hashBuffer,
  storageDelete,
  storagePut,
  storageRead,
} from "../server/services/storage";
import { normalizeImageForRef } from "../server/services/storage/normalize-image";

const MAX_BYTES = 800_000; // ~800 KB — already small enough, skip
const MAX_DIM = 1536;

async function run() {
  const rows = await db.select().from(assets);
  console.log(`[normalize] scanning ${rows.length} assets`);

  let skipped = 0;
  let rewritten = 0;
  let failed = 0;

  for (const a of rows) {
    try {
      const file = await storageRead(a.imageKey);
      if (!file) {
        console.warn(`  - ${a.name}: file missing on disk, skipping`);
        skipped++;
        continue;
      }

      const meta = await sharp(file.buffer).metadata().catch(() => null);
      const longest = Math.max(meta?.width ?? 0, meta?.height ?? 0);
      const isJpeg = meta?.format === "jpeg";
      if (isJpeg && longest <= MAX_DIM && file.buffer.byteLength <= MAX_BYTES) {
        // Already small — just make sure metadataJson has dimensions/bytes.
        if (!a.metadataJson?.width || !a.metadataJson?.height || !a.metadataJson?.bytes) {
          await db
            .update(assets)
            .set({
              metadataJson: {
                ...(a.metadataJson ?? {}),
                width: meta?.width,
                height: meta?.height,
                bytes: file.buffer.byteLength,
              },
              updatedAt: new Date().toISOString(),
            })
            .where(eq(assets.id, a.id));
          console.log(`  · ${a.name}: backfilled metadata only`);
        } else {
          console.log(`  · ${a.name}: already small + metadata complete, skip`);
        }
        skipped++;
        continue;
      }

      const norm = await normalizeImageForRef(file.buffer);
      const safeName = a.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
      const stored = await storagePut(
        `library/${a.kind}/${safeName}.jpg`,
        norm.buffer,
      );
      await db
        .update(assets)
        .set({
          imageKey: stored.key,
          imageUrl: stored.url,
          contentHash: hashBuffer(norm.buffer),
          metadataJson: {
            ...(a.metadataJson ?? {}),
            width: norm.width,
            height: norm.height,
            bytes: norm.finalBytes,
          },
          updatedAt: new Date().toISOString(),
        })
        .where(eq(assets.id, a.id));
      await storageDelete(a.imageKey);
      console.log(
        `  ✓ ${a.name}: ${meta?.width}×${meta?.height} ${file.buffer.byteLength}B → ${norm.width}×${norm.height} ${norm.finalBytes}B`,
      );
      rewritten++;
    } catch (err) {
      console.error(`  ✗ ${a.name}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(
    `\n[normalize] done: rewritten=${rewritten}, skipped=${skipped}, failed=${failed}`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
