/**
 * Seed script: uploads all character sheet images to S3 storage
 * and inserts them into the assets database table.
 * Run with: node scripts/seed-assets.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = "/home/ubuntu/upload";

// Map filename patterns to categories and human-readable names
const ASSET_MAP = [
  // Familie
  { pattern: /^dad-charactersheet/, category: "familie", namePrefix: "Dad", visualDescription: "Middle-aged man, warm smile, casual family style, dad character from the Mitchell family" },
  { pattern: /^mom-charactersheet/, category: "familie", namePrefix: "Mom", visualDescription: "Woman in her 40s, warm and caring expression, modern casual style, mom character from the Mitchell family" },
  { pattern: /^the-boy-charactersheet/, category: "familie", namePrefix: "The Boy (Sohn)", visualDescription: "Young boy around 10-12 years old, energetic and mischievous, casual kids clothing, son character from the Mitchell family" },
  { pattern: /^girl-charactersheet/, category: "familie", namePrefix: "Girl (Tochter)", visualDescription: "Young girl around 8-10 years old, curious and creative, colorful kids clothing, daughter character from the Mitchell family" },
  { pattern: /^lily-charactersheet/, category: "familie", namePrefix: "Lily", visualDescription: "Young woman, stylish and modern, teenager/young adult character" },
  { pattern: /^familie-lineup/, category: "familie", namePrefix: "Familie Lineup", visualDescription: "Full family lineup showing all Mitchell family members together" },
  { pattern: /^familie-szene-berlin/, category: "familie", namePrefix: "Familie Berlin Szene", visualDescription: "Mitchell family scene set in Berlin, urban environment" },
  { pattern: /^instagram-kinder-chaos/, category: "familie", namePrefix: "Kinder Chaos", visualDescription: "Children chaos scene, kids being energetic and messy" },
  { pattern: /^magnific_create/, category: "familie", namePrefix: "Familie Variation", visualDescription: "Family character variation, Mitchell family style" },
  { pattern: /^stil-referenz-mitchells/, category: "familie", namePrefix: "Stil-Referenz Mitchells", visualDescription: "Style reference for the Mitchell family, overall visual style guide" },

  // Tiere
  { pattern: /^cat-charactersheet/, category: "tiere", namePrefix: "Katze", visualDescription: "Cartoon cat character, expressive and cute, family pet" },
  { pattern: /^pug-charactersheet/, category: "tiere", namePrefix: "Mops (Hund)", visualDescription: "Pug dog character, wrinkly face, lovable and funny, family pet" },
  { pattern: /^tiere-stickerblatt/, category: "tiere", namePrefix: "Tiere Sticker", visualDescription: "Animal sticker sheet with various cartoon animals" },

  // Historisch
  { pattern: /^historische-persoenlichkeit-sheet/, category: "historisch", namePrefix: "Historische Persönlichkeit", visualDescription: "Historical personality character sheet, cartoon style" },

  // Sport
  { pattern: /^sport-athleten-sheet/, category: "sport", namePrefix: "Sport Athlet", visualDescription: "Sports athlete character sheet, athletic build, sports gear" },
  { pattern: /^sport-influencer-sheet/, category: "sport", namePrefix: "Sport Influencer", visualDescription: "Sports influencer character, modern athletic style, social media personality" },

  // Musik
  { pattern: /^musik-legenden-sheet/, category: "musik", namePrefix: "Musik Legende", visualDescription: "Music legend character sheet, iconic musician style" },
  { pattern: /^moderne-popstars-sheet/, category: "musik", namePrefix: "Moderner Popstar", visualDescription: "Modern pop star character, contemporary music style" },

  // Politiker
  { pattern: /^politiker-weltfuehrer-sheet/, category: "politiker", namePrefix: "Politiker / Weltführer", visualDescription: "World leader / politician character sheet, formal attire" },

  // Tech CEO
  { pattern: /^tech-ceo-sheet/, category: "tech-ceo", namePrefix: "Tech CEO", visualDescription: "Tech CEO character, modern business casual, Silicon Valley style" },

  // Umgebungen
  { pattern: /^umgebung-berlin-uebersicht/, category: "umgebungen", namePrefix: "Berlin Übersicht", visualDescription: "Berlin cityscape overview, urban environment background" },
  { pattern: /^umgebung-roadtrip-berlin/, category: "umgebungen", namePrefix: "Roadtrip Berlin", visualDescription: "Berlin roadtrip environment, highway and city outskirts" },
  { pattern: /^moodboard-roadtrip/, category: "umgebungen", namePrefix: "Roadtrip Moodboard", visualDescription: "Roadtrip moodboard, travel atmosphere, open roads" },

  // Fahrzeuge
  { pattern: /^fahrzeuge-items-sheet/, category: "fahrzeuge", namePrefix: "Fahrzeuge & Items", visualDescription: "Vehicle and items sheet, cars, bikes and everyday objects" },
];

function getAssetInfo(filename) {
  const base = path.basename(filename, path.extname(filename));
  
  for (const mapping of ASSET_MAP) {
    if (mapping.pattern.test(base)) {
      // Extract number from filename
      const numMatch = base.match(/-(\d+)$/);
      const num = numMatch ? numMatch[1] : "01";
      return {
        name: `${mapping.namePrefix} ${num.padStart(2, "0")}`,
        category: mapping.category,
        visualDescription: mapping.visualDescription,
      };
    }
  }
  
  return {
    name: base.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    category: "sonstiges",
    visualDescription: "",
  };
}

// Read the .env file to get DATABASE_URL and forge API credentials
function loadEnv() {
  const envPath = path.join(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    console.log("No .env file found, using process.env");
    return;
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function uploadToStorage(filePath, key) {
  const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
  
  if (!forgeApiUrl || !forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY not set");
  }

  // Get presigned upload URL
  const presignUrl = new URL("v1/storage/presign/put", forgeApiUrl.replace(/\/+$/, "") + "/");
  presignUrl.searchParams.set("path", key);
  
  const presignResp = await fetch(presignUrl.toString(), {
    headers: { Authorization: `Bearer ${forgeApiKey}` },
  });
  
  if (!presignResp.ok) {
    throw new Error(`Failed to get presigned URL: ${presignResp.status} ${await presignResp.text()}`);
  }
  
  const { url: uploadUrl } = await presignResp.json();
  
  // Upload file
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    body: fileBuffer,
    headers: { "Content-Type": mimeType },
  });
  
  if (!uploadResp.ok) {
    throw new Error(`Failed to upload file: ${uploadResp.status}`);
  }
  
  return `/manus-storage/${key}`;
}

async function insertAsset(db, asset) {
  const { createPool } = await import("mysql2/promise");
  const pool = createPool(process.env.DATABASE_URL);
  
  try {
    const [result] = await pool.execute(
      "INSERT INTO assets (name, category, description, imageKey, imageUrl, visualDescription, tags, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
      [
        asset.name,
        asset.category,
        asset.description || null,
        asset.imageKey,
        asset.imageUrl,
        asset.visualDescription || null,
        JSON.stringify([]),
      ]
    );
    await pool.end();
    return result.insertId;
  } catch (err) {
    await pool.end();
    throw err;
  }
}

async function main() {
  loadEnv();
  
  const files = fs.readdirSync(UPLOAD_DIR)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map((f) => path.join(UPLOAD_DIR, f));
  
  console.log(`Found ${files.length} image files to seed`);
  
  let success = 0;
  let failed = 0;
  
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const info = getAssetInfo(filename);
    const ext = path.extname(filename).toLowerCase();
    const key = `assets/${info.category}/${Date.now()}-${filename}`;
    
    try {
      console.log(`Uploading: ${filename} → ${info.category}/${info.name}`);
      const imageUrl = await uploadToStorage(filePath, key);
      
      await insertAsset(null, {
        name: info.name,
        category: info.category,
        description: `Character sheet: ${filename}`,
        imageKey: key,
        imageUrl,
        visualDescription: info.visualDescription,
      });
      
      success++;
      console.log(`  ✓ Uploaded and saved: ${info.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ Failed: ${filename} – ${err.message}`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }
  
  console.log(`\nDone! ${success} uploaded, ${failed} failed`);
}

main().catch(console.error);
