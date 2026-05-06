/**
 * Full pipeline test: Story generation + 3 slide images via Atlas Cloud gpt-image-2
 * Uses the storyService functions directly (not via HTTP) to test the full flow
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

// Set env vars from .env file
const envPath = path.join(projectRoot, ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) process.env[key.trim()] = vals.join("=").trim().replace(/^["']|["']$/g, "");
  }
} catch {}

// Override with system env (system env takes priority)
// These are already in process.env from the platform

const STORY_THEME = `Olaf Scholz und die Zeitenwende – ein Podcast-Interview mit Toni als Host.
Scholz kommt mit Brötchen ins Studio. Toni fragt ihn über die 100 Milliarden Bundeswehr-Sonderausgabe,
die Leopard-Panzer-Zögerlichkeit und den "Wandel durch Handel" Irrtum.
Toni ist sarkastisch, Scholz ist defensiv aber ehrlich. Berliner Podcast-Atmosphäre.`;

async function testStoryGeneration() {
  console.log("=== FULL PIPELINE TEST ===\n");
  console.log("Theme:", STORY_THEME.split("\n")[0]);
  console.log("\n--- Step 1: Generating story text with Claude Sonnet 4.6 ---");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
  console.log("Anthropic key:", anthropicKey.slice(0, 15) + "...");

  const atlasKey = process.env.ATLASCLOUD_API_KEY;
  if (!atlasKey) throw new Error("ATLASCLOUD_API_KEY not set");
  console.log("Atlas key:", atlasKey.slice(0, 15) + "...");

  // Step 1: Generate story text
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: anthropicKey });

  const systemPrompt = `Du bist ein erfahrener Content-Stratege für Instagram Carousel Stories im Stil des Formats "Hey was war denn das?" von klarekante.berlin.

DEIN STIL:
- Berliner Direktheit: kein Bullshit, kein Wellness-Coach-Sprech
- Satirisch und trocken wie Ricky Gervais – aber mit Herz
- Zahlen und Fakten als Schockmomente ("100 MILLIARDEN!")
- Persönliche Anekdoten als emotionale Auflösung
- Jeder Slide hat eine klare Aussage – kein Fülltext

CAROUSEL-STRUKTUR (10 Slides):
- Slide 1: HOOK – ein Satz der sofort trifft
- Slide 2-3: KONTEXT – das Problem aufbauen
- Slide 4-5: ESKALATION – die Absurdität zeigen
- Slide 6-7: WENDEPUNKT – persönliche Geschichte
- Slide 8-9: AUFLÖSUNG – die eigentliche Botschaft
- Slide 10: CTA – Aufruf zum Folgen

KONSISTENZ: Outfits und Settings bleiben in ALLEN 10 Slides identisch.
Bildstil: 3D-Cartoon-Render im Pixar/Mitchell's-Stil.
Antworte als valides JSON ohne Markdown.`;

  const userPrompt = `Erstelle ein Instagram Carousel zum Thema: "${STORY_THEME}"

Charaktere:
- Toni (Podcast-Host): mittleres Alter, Berliner, lockeres Outfit, Podcast-Studio mit Mikrofon
- Olaf Scholz: Bundeskanzler, Anzug, etwas steif, kommt mit Brötchentüte ins Studio

Bildformat: quadratisch 1080x1080px

JSON-Struktur:
{
  "title": "Kurzer Titel (max 5 Wörter)",
  "consistencyContext": {
    "artStyle": "3D cartoon render, Pixar animation style, expressive faces, bold outlines, warm cinematic lighting",
    "colorPalette": "Warme Berliner Podcast-Atmosphäre, gedämpfte Töne mit Akzenten",
    "environment": "Berliner Podcast-Studio: Mikrofone, Schreibtisch, Fernsehturm im Hintergrund, ON AIR Schild",
    "characters": [
      {"assetId": 0, "name": "Toni", "outfit": "Schwarzes T-Shirt, Jeans, Sneakers", "visualDescription": "Berliner Podcast-Host, 40er, lockere Haltung, Mikrofon vor sich"},
      {"assetId": 0, "name": "Olaf Scholz", "outfit": "Dunkler Anzug, weißes Hemd, keine Krawatte", "visualDescription": "Bundeskanzler, 60er, leicht steife Körperhaltung, manchmal eine Brötchentüte haltend"}
    ],
    "globalStylePrompt": "3D cartoon render Pixar style, Berlin podcast studio with microphones and Fernsehturm view, Toni in black t-shirt and jeans, Olaf Scholz in dark suit with Brötchen bag, warm cinematic lighting, expressive faces, Mitchell's aesthetic"
  },
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "TEXT IM BILD – max 2-3 kurze Sätze auf Deutsch. Provokant.",
      "caption": "Instagram-Caption (1-2 Sätze + Emojis)",
      "charactersInSlide": ["Toni", "Olaf Scholz"],
      "imagePrompt": "Detaillierter Bildprompt auf Englisch mit Szene, Charakteren, Ausdruck, und dem deutschen textContent als großem lesbaren Text im Bild"
    }
  ],
  "usedAssetIds": []
}

Genau 10 Slides. Echter narrativer Bogen. Berliner Direktheit.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  let jsonText = response.content[0].text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const story = JSON.parse(jsonText);
  console.log(`\n✓ Story generated: "${story.title}"`);
  console.log(`  Slides: ${story.slides.length}`);
  console.log("\n--- Slide Texts ---");
  story.slides.forEach((s, i) => {
    console.log(`  Slide ${i+1}: ${s.textContent.slice(0, 80)}...`);
  });

  // Step 2: Generate 3 images (slides 1, 5, 10) via Atlas Cloud
  console.log("\n--- Step 2: Generating 3 images via Atlas Cloud gpt-image-2 ---");

  const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";
  const ATLAS_MODEL = "openai/gpt-image-2/text-to-image";

  async function generateImage(slide) {
    const fullPrompt = [
      story.consistencyContext.globalStylePrompt,
      slide.imagePrompt,
      `Setting: ${story.consistencyContext.environment}.`,
      "High quality 3D render, cinematic composition, sharp details.",
      "Text must be large, bold, clearly readable, positioned in the lower third of the image.",
    ].join(" ");

    console.log(`  Submitting slide ${slide.slideNumber}...`);

    const submitRes = await fetch(`${ATLAS_BASE}/model/generateImage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${atlasKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ATLAS_MODEL,
        prompt: fullPrompt,
        size: "1024x1024",
        quality: "high",
        output_format: "jpeg",
        enable_base64_output: false,
        enable_sync_mode: false,
      }),
    });

    const submitData = await submitRes.json();
    if (!submitData.data?.id) throw new Error(`Submit failed: ${JSON.stringify(submitData)}`);
    return { predictionId: submitData.data.id, slideNumber: slide.slideNumber };
  }

  async function pollImage(predictionId, slideNumber) {
    const pollUrl = `${ATLAS_BASE}/model/prediction/${predictionId}`;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await fetch(pollUrl, { headers: { Authorization: `Bearer ${atlasKey}` } });
      const data = await res.json();
      const status = data.data?.status;
      if (status === "completed") {
        const url = data.data?.outputs?.[0];
        console.log(`  ✓ Slide ${slideNumber} done: ${url}`);
        return url;
      }
      if (status === "failed") throw new Error(`Slide ${slideNumber} failed: ${data.data?.error}`);
      if (i % 6 === 0) console.log(`  ... slide ${slideNumber} still processing (${(i+1)*5}s)`);
    }
    throw new Error(`Slide ${slideNumber} timed out`);
  }

  // Submit slides 1, 5, 10 in parallel
  const slidesToTest = [story.slides[0], story.slides[4], story.slides[9]];
  const submissions = await Promise.all(slidesToTest.map(generateImage));

  console.log(`\n  All 3 submitted. Polling for results...`);

  // Poll all in parallel
  const results = await Promise.all(
    submissions.map(({ predictionId, slideNumber }) => pollImage(predictionId, slideNumber))
  );

  console.log("\n=== RESULTS ===");
  console.log(`Story: "${story.title}"`);
  console.log("\nGenerated images:");
  results.forEach((url, i) => {
    console.log(`  Slide ${slidesToTest[i].slideNumber}: ${url}`);
  });

  // Save results
  import("fs").then(fs => {
    fs.writeFileSync("/home/ubuntu/test-pipeline-result.json", JSON.stringify({
      story,
      imageUrls: results.map((url, i) => ({ slide: slidesToTest[i].slideNumber, url })),
    }, null, 2));
    console.log("\n✓ Full results saved to /home/ubuntu/test-pipeline-result.json");
  });
}

testStoryGeneration().catch(err => {
  console.error("PIPELINE ERROR:", err.message);
  process.exit(1);
});
