/**
 * End-to-end test: Story generation + image generation with character sheet reference images
 * Tests the full pipeline: Claude story → character detection → presigned URLs → Atlas Cloud gpt-image-2
 */
import Anthropic from "@anthropic-ai/sdk";
import mysql from "mysql2/promise";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ATLAS_KEY = process.env.ATLASCLOUD_API_KEY;
const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;
const DB_URL = process.env.DATABASE_URL;

// Story 2 excerpt (Scholz interview)
const STORY_SCRIPT = `
EP02 – Olaf Scholz, Brötchen und die Zeitenwende

Toni (Host) interviewt Olaf Scholz im Berliner Podcast-Studio.
Scholz kommt ohne Bodyguards, kauft sich Brötchen beim Bäcker nebenan.
Toni fragt ihn über die Zeitenwende, 100 Milliarden für die Bundeswehr,
die Leopard-Panzer-Entscheidung und ob Deutschland wirklich bereit war.
Scholz sagt: "Wir haben uns alle geirrt. Alle."
Das Format heißt "Hey, was war denn das?" auf @klarekante.berlin
`;

async function getPresignedUrl(key) {
  const forgeUrl = new URL("v1/storage/presign/get", FORGE_URL.replace(/\/+$/, "") + "/");
  forgeUrl.searchParams.set("path", key);
  const r = await fetch(forgeUrl, { headers: { Authorization: `Bearer ${FORGE_KEY}` } });
  const data = await r.json();
  return data.url;
}

async function atlasGenerate(prompt, referenceUrls = []) {
  const body = {
    model: "openai/gpt-image-2/text-to-image",
    prompt,
    size: "1024x1024",
    quality: "high",
    output_format: "jpeg",
    enable_base64_output: false,
    enable_sync_mode: false,
  };
  if (referenceUrls.length > 0) {
    body.reference_images = referenceUrls.slice(0, 4);
  }

  const res = await fetch("https://api.atlascloud.ai/api/v1/model/generateImage", {
    method: "POST",
    headers: { Authorization: `Bearer ${ATLAS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.data?.id) throw new Error(`Atlas submit failed: ${JSON.stringify(data)}`);

  const predId = data.data.id;
  console.log(`  Submitted prediction: ${predId}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://api.atlascloud.ai/api/v1/model/prediction/${predId}`, {
      headers: { Authorization: `Bearer ${ATLAS_KEY}` },
    });
    const pollData = await poll.json();
    const status = pollData.data?.status;
    process.stdout.write(`  ${status} (${(i + 1) * 5}s)\r`);
    if (status === "completed") {
      console.log(`\n  DONE!`);
      return pollData.data.outputs?.[0];
    }
    if (status === "failed") throw new Error(`Atlas failed: ${pollData.data?.error}`);
  }
  throw new Error("Atlas timeout");
}

async function main() {
  console.log("=== FULL PIPELINE TEST WITH CHARACTER SHEET REFERENCES ===\n");

  // 1. Get character sheet URLs from DB
  console.log("1. Loading character sheet URLs from database...");
  const conn = await mysql.createConnection(DB_URL);

  const [dadRows] = await conn.execute(
    "SELECT id, name, imageUrl FROM assets WHERE name LIKE '%Dad 03%' AND category = 'familie' LIMIT 1"
  );
  const [scholzRows] = await conn.execute(
    "SELECT id, name, imageUrl FROM assets WHERE category = 'historisch' AND name LIKE '%01%' LIMIT 1"
  );
  const [stilRows] = await conn.execute(
    "SELECT id, name, imageUrl FROM assets WHERE name LIKE '%stil-referenz%' OR name LIKE '%Stil Referenz%' LIMIT 1"
  );
  await conn.end();

  const dadAsset = dadRows[0];
  const scholzAsset = scholzRows[0];
  const stilAsset = stilRows[0];

  console.log(`  Dad asset: ${dadAsset?.name} → ${dadAsset?.imageUrl?.slice(0, 60)}`);
  console.log(`  Scholz asset: ${scholzAsset?.name} → ${scholzAsset?.imageUrl?.slice(0, 60)}`);
  console.log(`  Stil asset: ${stilAsset?.name} → ${stilAsset?.imageUrl?.slice(0, 60)}`);

  // 2. Get presigned URLs
  console.log("\n2. Getting presigned URLs...");
  const dadUrl = dadAsset ? await getPresignedUrl(dadAsset.imageUrl.replace("/manus-storage/", "")) : null;
  const scholzUrl = scholzAsset ? await getPresignedUrl(scholzAsset.imageUrl.replace("/manus-storage/", "")) : null;
  console.log(`  Dad presigned: ${dadUrl ? "✓" : "✗"}`);
  console.log(`  Scholz presigned: ${scholzUrl ? "✓" : "✗"}`);

  // 3. Generate story with Claude
  console.log("\n3. Generating story with Claude Sonnet 4.6...");
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const storyPrompt = `Du bist ein kreativer Direktor für Instagram Carousel Content.
Erstelle aus diesem Podcast-Skript ein 10-teiliges Instagram Carousel für @klarekante.berlin.

SKRIPT:
${STORY_SCRIPT}

CHARAKTERE:
- Toni (Host): Berliner Podcast-Host, 35-40 Jahre, schwarzes T-Shirt, Bart, direkt und witzig
- Olaf Scholz: Bundeskanzler, Anzug, ruhig aber unter Druck

ANFORDERUNGEN:
- Slide 1: Hook (provokant, macht neugierig)
- Slides 2-4: Kontext und Eskalation
- Slides 5-7: Der Kern des Konflikts / die entscheidenden Momente
- Slides 8-9: Wendepunkt / Auflösung
- Slide 10: CTA mit @klarekante.berlin

Antworte als JSON ohne Markdown:
{
  "title": "Story-Titel",
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "Kurzer, knackiger Text (max 15 Wörter) der direkt ins Bild gerendert wird",
      "caption": "Instagram-Caption für diesen Slide",
      "charactersInSlide": ["Toni", "Scholz"],
      "imagePrompt": "Detaillierter Bildprompt auf Englisch für gpt-image-2: was passiert in der Szene, Pose, Emotion, Hintergrund"
    }
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: storyPrompt }],
  });

  const text = response.content[0].text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const story = JSON.parse(text);
  console.log(`  Generated: "${story.title}" with ${story.slides.length} slides`);

  // 4. Generate 3 images with character sheet references
  console.log("\n4. Generating images with character sheet references...");

  const globalStyle = "Pixar 3D cartoon render style, warm cinematic lighting, expressive characters, Berlin podcast studio setting with Fernsehturm visible through window, professional podcast microphones, brick walls.";

  for (const slideNum of [1, 5, 10]) {
    const slide = story.slides.find((s) => s.slideNumber === slideNum);
    if (!slide) continue;

    console.log(`\n  Slide ${slideNum}: "${slide.textContent}"`);
    console.log(`  Characters: ${slide.charactersInSlide?.join(", ")}`);

    // Build reference URLs based on characters in this slide
    const refUrls = [];
    if (slide.charactersInSlide?.some((c) => c.toLowerCase().includes("toni") || c.toLowerCase().includes("host"))) {
      if (dadUrl) refUrls.push(dadUrl);
    }
    if (slide.charactersInSlide?.some((c) => c.toLowerCase().includes("scholz") || c.toLowerCase().includes("olaf"))) {
      if (scholzUrl) refUrls.push(scholzUrl);
    }

    console.log(`  Reference images: ${refUrls.length}`);

    const fullPrompt = `${globalStyle} ${slide.imagePrompt} Text overlay in large bold white font: "${slide.textContent}". Instagram carousel slide ${slideNum} of 10.`;

    try {
      const imageUrl = await atlasGenerate(fullPrompt, refUrls);
      console.log(`  ✓ Slide ${slideNum} URL: ${imageUrl}`);
    } catch (err) {
      console.error(`  ✗ Slide ${slideNum} failed: ${err.message}`);
    }
  }

  console.log("\n=== TEST COMPLETE ===");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
