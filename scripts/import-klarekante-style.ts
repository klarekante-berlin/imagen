/**
 * Bulk-import script for klarekante-style/ folder tree.
 * Walks each subfolder, applies a folder→hint map, vision-categorizes
 * each image via Claude Sonnet 4.6, and inserts assets + characters.
 *
 * Usage:
 *   tsx scripts/import-klarekante-style.ts                # full run
 *   tsx scripts/import-klarekante-style.ts --dry-run      # vision runs, no DB write
 *   tsx scripts/import-klarekante-style.ts --folder=papa  # one folder only
 *   tsx scripts/import-klarekante-style.ts --limit=10     # cap files per run
 *   tsx scripts/import-klarekante-style.ts --force        # bypass dedup hash
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  categorizeImage,
  reviewStatusFromResult,
  type CategorizeHint,
  type CategorizeResult,
  type KnownCharacter,
} from "../server/_core/visionCategorize";
import {
  createAsset,
  getCharacters,
  getCharacterById,
  updateCharacter,
  resolveOrCreateCharacter,
  getAssetByContentHash,
  getAssetBySourcePath,
} from "../server/db";
import { storagePut } from "../server/storage";
import { getPresignedStorageUrl } from "../server/storyService";
import type { AssetCategory, CharacterKind } from "../drizzle/schema";

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "klarekante-style");
const ERROR_LOG = path.resolve(__dirname, "..", "import-errors.log");

interface FolderHint {
  character?: { name: string; kind: CharacterKind; aliases?: string[] };
  fallbackCategory?: AssetCategory;
}

const FOLDER_HINTS: Record<string, FolderHint> = {
  papa: {
    character: { name: "Papa", kind: "family", aliases: ["Vater", "Dad", "mein Vater"] },
    fallbackCategory: "familie",
  },
  mama: {
    character: { name: "Mama", kind: "family", aliases: ["Mutter", "Mom"] },
    fallbackCategory: "familie",
  },
  sohn: {
    character: { name: "Sohn", kind: "family", aliases: ["Junge", "mein Sohn"] },
    fallbackCategory: "familie",
  },
  tochter: {
    character: { name: "Tochter", kind: "family", aliases: ["Mädchen", "meine Tochter"] },
    fallbackCategory: "familie",
  },
  hund: {
    character: { name: "Mops", kind: "fictional", aliases: ["Hund", "Pug"] },
    fallbackCategory: "tiere",
  },
  katze: {
    character: { name: "Katze", kind: "fictional", aliases: ["Cat"] },
    fallbackCategory: "tiere",
  },
  athletes: { fallbackCategory: "sport" },
  musicians: { fallbackCategory: "musik" },
  politiker: { fallbackCategory: "politiker" },
  tech_people: { fallbackCategory: "tech-ceo" },
  historic_persons: { fallbackCategory: "historisch" },
  tiere: { fallbackCategory: "tiere" },
  umgebungen: { fallbackCategory: "umgebungen" },
  vehicles: { fallbackCategory: "fahrzeuge" },
  items: { fallbackCategory: "items" },
  social_media_posts: { fallbackCategory: "stil-referenz" },
  typografie_and_elements: { fallbackCategory: "stil-referenz" },
  website: { fallbackCategory: "stil-referenz" },
  variations: {},
  soziotypen: { fallbackCategory: "sonstiges" },
  jobs: { fallbackCategory: "sonstiges" },
  people_variety: { fallbackCategory: "sonstiges" },
};

const PARALLELISM = 4;
const MAX_RETRIES = 3;

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  folder?: string;
  limit?: number;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { dryRun: false, force: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a.startsWith("--folder=")) args.folder = a.slice("--folder=".length);
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice("--limit=".length), 10);
  }
  return args;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function logError(msg: string): void {
  const ts = new Date().toISOString();
  fs.appendFileSync(ERROR_LOG, `[${ts}] ${msg}\n`, "utf-8");
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number; statusCode?: number })?.status
        ?? (e as { statusCode?: number })?.statusCode;
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || attempt === MAX_RETRIES) break;
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(`[retry] ${label} attempt ${attempt} failed (${status ?? "unknown"}), waiting ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Per-file pipeline ────────────────────────────────────────────────────────

interface FileResult {
  status: "ok" | "skipped_duplicate" | "skipped_dryrun" | "error";
  file: string;
  reason?: string;
  assetId?: number;
}

async function importOne(
  absPath: string,
  knownCharacters: KnownCharacter[],
  args: CliArgs
): Promise<FileResult> {
  const folderName = path.basename(path.dirname(absPath));
  const fileName = path.basename(absPath);
  const sourcePath = `klarekante-style/${folderName}/${fileName}`;
  const hint = FOLDER_HINTS[folderName] ?? {};

  try {
    const buffer = fs.readFileSync(absPath);
    const contentHash = sha256(buffer);

    if (!args.force) {
      const byHash = await getAssetByContentHash(contentHash);
      if (byHash) return { status: "skipped_duplicate", file: sourcePath, reason: "hash exists" };
      const byPath = await getAssetBySourcePath(sourcePath);
      if (byPath) return { status: "skipped_duplicate", file: sourcePath, reason: "sourcePath exists" };
    }

    const mime = mimeFor(absPath);
    const storageKey = `assets/${hint.fallbackCategory ?? "uploads"}/${contentHash.slice(0, 12)}-${fileName}`;

    const { url, key } = args.dryRun
      ? { url: `dry-run://${storageKey}`, key: storageKey }
      : await storagePut(storageKey, buffer, mime);

    const presigned = args.dryRun ? null : await getPresignedStorageUrl(url);
    const visionSource = presigned
      ? ({ type: "url" as const, url: presigned })
      : ({ type: "base64" as const, mediaType: mime, data: buffer.toString("base64") });

    const categorizeHint: CategorizeHint = {
      folderName,
      character: hint.character,
      fallbackCategory: hint.fallbackCategory,
    };

    const result: CategorizeResult = await withRetry(
      () => categorizeImage(visionSource, knownCharacters, categorizeHint),
      `categorize ${sourcePath}`
    );

    if (args.dryRun) {
      console.log(`[dry-run] ${sourcePath}`);
      console.log(`  category=${result.suggestedCategory} (${result.categoryConfidence}%)`);
      console.log(`  character=${JSON.stringify(result.suggestedCharacter)}`);
      console.log(`  isCharacterSheet=${result.isCharacterSheet} pose=${result.pose ?? "-"}`);
      console.log(`  needsReview=${result.needsHumanReview}`);
      return { status: "skipped_dryrun", file: sourcePath };
    }

    const characterId = await resolveOrCreateCharacter(result.suggestedCharacter);

    const baseName = path.basename(fileName, path.extname(fileName));
    const id = await createAsset({
      name: `${folderName}/${baseName}`,
      category: result.suggestedCategory,
      description: null,
      visualDescription: result.visualDescription,
      tags: result.tags,
      imageKey: key,
      imageUrl: url,
      characterId,
      isCharacterSheet: result.isCharacterSheet,
      pose: result.pose ?? null,
      outfit: result.outfit ?? null,
      setting: result.setting ?? null,
      mood: result.mood ?? null,
      dominantColors: result.dominantColors ?? null,
      contentHash,
      sourcePath,
      autoCategorized: true,
      visionConfidence: result.categoryConfidence,
      reviewStatus: reviewStatusFromResult(result),
    });

    if (characterId && result.isCharacterSheet) {
      const ch = await getCharacterById(characterId);
      if (ch && !ch.primaryAssetId) {
        await updateCharacter(characterId, { primaryAssetId: id });
      }
    }

    return { status: "ok", file: sourcePath, assetId: id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`${sourcePath}: ${msg}`);
    return { status: "error", file: sourcePath, reason: msg };
  }
}

// ─── Concurrency limiter (no extra dep) ───────────────────────────────────────

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onResult?: (result: R, index: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
      onResult?.(results[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log(`[import] root=${ROOT}`);
  console.log(`[import] flags: ${JSON.stringify(args)}`);

  if (!fs.existsSync(ROOT)) {
    console.error(`[import] folder not found: ${ROOT}`);
    process.exit(1);
  }

  // Collect files
  const folders = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((d) => !args.folder || d === args.folder);

  if (folders.length === 0) {
    console.error(`[import] no folders matched (filter: ${args.folder ?? "none"})`);
    process.exit(1);
  }

  const files: string[] = [];
  for (const folder of folders) {
    const folderPath = path.join(ROOT, folder);
    const entries = fs
      .readdirSync(folderPath)
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .map((f) => path.join(folderPath, f));
    files.push(...entries);
  }

  // Top-level files in ROOT (e.g. magnific_3d-a-family-of-five-inclu_*.png)
  const topLevel = fs
    .readdirSync(ROOT)
    .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f) && fs.statSync(path.join(ROOT, f)).isFile())
    .map((f) => path.join(ROOT, f));
  files.push(...topLevel);

  if (args.limit) files.splice(args.limit);

  console.log(`[import] processing ${files.length} files across ${folders.length} folder(s)`);

  // Pre-load known characters once for the whole run
  const knownChars = await getCharacters();
  const known: KnownCharacter[] = knownChars.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases ?? [],
    kind: c.kind,
  }));
  console.log(`[import] ${known.length} known characters loaded`);

  let ok = 0;
  let dup = 0;
  let dry = 0;
  let err = 0;

  await runWithLimit(
    files,
    PARALLELISM,
    (file) => importOne(file, known, args),
    (result, i) => {
      const tag =
        result.status === "ok" ? "✓" :
        result.status === "skipped_duplicate" ? "·" :
        result.status === "skipped_dryrun" ? "?" : "✗";
      const reason = result.reason ? ` (${result.reason})` : "";
      console.log(`[${i + 1}/${files.length}] ${tag} ${result.file}${reason}`);
      if (result.status === "ok") ok++;
      else if (result.status === "skipped_duplicate") dup++;
      else if (result.status === "skipped_dryrun") dry++;
      else err++;
    }
  );

  console.log(`\n[import] done: ${ok} ok, ${dup} duplicate, ${dry} dry-run, ${err} error`);
  if (err > 0) console.log(`[import] errors logged to ${ERROR_LOG}`);
}

main().catch((e) => {
  console.error("[import] fatal:", e);
  process.exit(1);
});
