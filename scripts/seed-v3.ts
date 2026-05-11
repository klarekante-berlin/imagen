/**
 * Imagen V3 – Seed Script
 *
 * Creates:
 *  1. A default "klarekante.berlin" project with format-agnostic prompts
 *  2. 2-3 klarekante style-reference assets (local files, no API calls)
 *
 * Usage:
 *   pnpm tsx scripts/seed-v3.ts
 *   pnpm tsx scripts/seed-v3.ts --dry-run
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { projects, assets } from "../drizzle/schema";
import type { InsertProject, InsertAsset } from "../drizzle/schema";

// ─── Config ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const STORAGE_DIR = path.resolve("./storage-data");
const ASSETS_DIR = path.join(STORAGE_DIR, "assets");
const STYLE_SOURCE = path.resolve("./klarekante-style");

// ─── DB ───────────────────────────────────────────────────────────────────────
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./storage-data/imagen.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client);

// ─── Default Project ──────────────────────────────────────────────────────────
const DEFAULT_PROJECT: InsertProject = {
  name: "klarekante.berlin – Instagram Carousel",
  description:
    "Satirische 3D-Cartoon-Carousels für den Instagram-Account klarekante.berlin. " +
    "Stil: Pixar / The Mitchells vs. the Machines. Ton: Berliner Direktheit, Ricky Gervais.",
  imageFormat: "1:1",
  planSystemPrompt: `Du bist ein kreativer Direktor für satirische Social-Media-Inhalte.
Deine Aufgabe: Analysiere das gegebene Thema oder Skript und erstelle einen strukturierten Plan für ein {{FORMAT}}-Carousel.

REGELN:
- Erkenne alle Charaktere, Orte und Objekte im Text
- Schlage eine sinnvolle Slide-Anzahl vor ({{MIN_FRAMES}}–{{MAX_FRAMES}})
- Jede Scene beschreibt EINE visuelle Einheit (was ist zu sehen, wer ist dabei, welche Emotion)
- Denke in Bildern, nicht in Text
- Wenn ein Charakter oder Ort noch nicht in der Asset-Library existiert, markiere ihn als needsWorldBuilding=true

AUSGABE: Strukturiertes JSON mit title, reasoning, suggestedSlideCount, scenes[], detectedEntities[]`,

  writeSystemPrompt: `Du bist ein erfahrener Art Director und Texter für satirische 3D-Cartoon-Inhalte.

VISUELLER STIL:
{{GLOBAL_STYLE_PROMPT}}

AUFGABE:
Schreibe für jede Scene:
1. Den finalen Slide-Text (prägnant, direkt, max. 2 Sätze)
2. Einen detaillierten imagePrompt auf Englisch für die Bildgenerierung

IMAGE PROMPT REGELN:
- Beginne IMMER mit dem Stil: "3D animated Pixar-style illustration, vibrant colors, expressive characters"
- Beschreibe Charaktere mit ihren visuellen Merkmalen (nicht mit Namen)
- Beschreibe Umgebung, Beleuchtung, Kamerawinkel
- Beschreibe Emotion und Aktion
- Vermeide abstrakte Konzepte – alles muss visuell darstellbar sein
- Maximal 150 Wörter pro imagePrompt

KONSISTENZ:
{{CONSISTENCY_CONTEXT}}`,

  globalStylePrompt:
    "3D animated style inspired by Pixar and 'The Mitchells vs. the Machines'. " +
    "Vibrant, saturated colors. Expressive, slightly exaggerated cartoon characters. " +
    "Clean compositions with strong focal points. Berlin urban environments. " +
    "Satirical but warm tone. High detail, cinematic lighting.",

  allowedAssetCategories: [
    "familie",
    "politiker",
    "umgebungen",
    "fahrzeuge",
    "items",
    "stil-referenz",
    "tiere",
    "sonstiges",
  ],
  minFrames: 3,
  maxFrames: 12,
};

// ─── Style Reference Assets ───────────────────────────────────────────────────
// The two top-level PNGs in klarekante-style/ are the primary style anchors.
// We copy them into storage-data/assets/ and register them in the DB.
const STYLE_SHEET_FILES = [
  "magnific_3d-a-family-of-five-inclu_2923926010.png",
  "magnific_3d-animated-style-illustr_2937670293.png",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function copyToStorage(srcPath: string, destName: string): string {
  const destPath = path.join(ASSETS_DIR, destName);
  if (!fs.existsSync(destPath)) {
    fs.copyFileSync(srcPath, destPath);
  }
  return destPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[seed-v3] DRY_RUN=${DRY_RUN}`);

  // Ensure storage dirs exist
  if (!DRY_RUN) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // ── 1. Create default project ────────────────────────────────────────────
  const existingProjects = await db.select().from(projects).limit(1);
  if (existingProjects.length > 0) {
    console.log(`[seed-v3] Project already exists (id=${existingProjects[0].id}), skipping.`);
  } else {
    console.log(`[seed-v3] Creating default project: "${DEFAULT_PROJECT.name}"`);
    if (!DRY_RUN) {
      const result = await db.insert(projects).values(DEFAULT_PROJECT);
      const projectId = Number((result as any).lastInsertRowid ?? 0);
      console.log(`[seed-v3] ✓ Project created with id=${projectId}`);
    } else {
      console.log(`[seed-v3] [DRY] Would create project: ${DEFAULT_PROJECT.name}`);
    }
  }

  // ── 2. Seed style-reference assets ───────────────────────────────────────
  let seeded = 0;
  let skipped = 0;

  for (const fileName of STYLE_SHEET_FILES) {
    const srcPath = path.join(STYLE_SOURCE, fileName);

    if (!fs.existsSync(srcPath)) {
      console.warn(`[seed-v3] ⚠ File not found, skipping: ${srcPath}`);
      continue;
    }

    const contentHash = sha256File(srcPath);

    // Check for duplicate
    const existing = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.contentHash, contentHash))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[seed-v3] · Duplicate (id=${existing[0].id}): ${fileName}`);
      skipped++;
      continue;
    }

    const destName = `style-ref-${fileName}`;
    const imageKey = `assets/${destName}`;
    const imageUrl = `/storage/${imageKey}`;

    const assetData: InsertAsset = {
      name: `klarekante-style/${path.basename(fileName, path.extname(fileName))}`,
      category: "stil-referenz",
      description: "Klarekante.berlin visual style reference – 3D Pixar-style cartoon",
      imageKey,
      imageUrl,
      visualDescription:
        "3D animated Pixar-style illustration. Vibrant saturated colors. " +
        "Expressive cartoon characters with exaggerated features. " +
        "Clean composition with strong focal point. Cinematic lighting.",
      tags: ["stil-referenz", "klarekante", "pixar-style", "3d-cartoon", "reference"],
      isCharacterSheet: false,
      contentHash,
      sourcePath: `klarekante-style/${fileName}`,
      autoCategorized: false,
      reviewStatus: "approved",
    };

    if (!DRY_RUN) {
      copyToStorage(srcPath, destName);
      const result = await db.insert(assets).values(assetData);
      const assetId = Number((result as any).lastInsertRowid ?? 0);
      console.log(`[seed-v3] ✓ Asset created (id=${assetId}): ${fileName}`);
    } else {
      console.log(`[seed-v3] [DRY] Would create asset: ${fileName}`);
    }
    seeded++;
  }

  console.log(`\n[seed-v3] Done: ${seeded} assets seeded, ${skipped} skipped (duplicates).`);
  console.log(`[seed-v3] Run 'pnpm tsx scripts/import-klarekante-style.ts' to import all assets with AI categorization.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-v3] Fatal:", e);
  process.exit(1);
});
