/**
 * End-to-end test: Story generation (Claude) + Image generation (Atlas Cloud gpt-image-2)
 * Uses Story 2 (Zeitenwende/Scholz) as test input
 */

import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, mkdirSync } from "fs";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ATLAS_KEY = process.env.ATLASCLOUD_API_KEY;

if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");
if (!ATLAS_KEY) throw new Error("ATLASCLOUD_API_KEY missing");

const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Step 1: Generate story with Claude ──────────────────────────────────────

console.log("🎬 Step 1: Generating story with Claude sonnet-4-6...\n");

const systemPrompt = `Du bist ein erfahrener Content-Stratege für Instagram Carousel Stories im Stil des Formats "Hey was war denn das?" von klarekante.berlin.

DEIN STIL:
- Berliner Direktheit: kein Bullshit, kein Wellness-Coach-Sprech
- Satirisch und trocken wie Ricky Gervais – aber mit Herz
- Zahlen und Fakten als Schockmomente ("41 FUCKING PROZENT!")
- Persönliche Anekdoten als emotionale Auflösung
- Jeder Slide hat eine klare Aussage – kein Fülltext
- Dialoge sind knapp, pointiert, real

CAROUSEL-STRUKTUR (10 Slides):
- Slide 1: HOOK – ein Satz der sofort trifft, Frage oder provokante These
- Slide 2-3: KONTEXT – das Problem in Zahlen/Fakten aufbauen
- Slide 4-5: ESKALATION – die Absurdität des Systems zeigen
- Slide 6-7: WENDEPUNKT – persönliche Geschichte oder konkretes Beispiel
- Slide 8-9: AUFLÖSUNG – die eigentliche Botschaft, ehrlich und direkt
- Slide 10: CTA – Aufruf zum Folgen, Kommentieren oder Teilen

KONSISTENZ-REGELN:
- Outfits, Umgebungen und Charaktere bleiben in ALLEN 10 Slides identisch
- Der Bildstil ist 3D-Cartoon-Render im Pixar/Mitchell's-Stil – warm, expressiv, detailreich

Antworte IMMER als valides JSON ohne Markdown-Codeblöcke.`;

const storyInput = `Thema: "Die Zeitenwende – Wie Olaf Scholz Deutschland zur Sicherheitspolitik zwang"

Kontext: Toni ist ein Berliner Podcast-Host (Mitte 30, lockeres schwarzes T-Shirt, Mikrofon vor sich, modernes Podcast-Studio mit Berliner Flair). Er interviewt Olaf Scholz (Mitte 60, graues Haar, konservativer Anzug, leicht steife Körperhaltung).

Schlüsselmomente aus dem Skript:
- Scholz kauft jetzt Brötchen ohne Personenschutz
- Dezember 2021: Amtsantritt, sofort Krisen
- 24. Februar 2022: Russland greift Ukraine an
- 27. Februar 2022: Die Zeitenwende-Rede, 100 Milliarden für die Bundeswehr
- "Wandel durch Handel" – die gescheiterte Strategie
- Leopard-Panzer: erst 5 Gutachten, dann Lanz-Auftritt
- Energieversorgung vs. moralischer Anspruch
- "Wir haben zu lange in einer Komfortzone gelebt"
- Zeitenwende = Fitnessstudio-Mitgliedschaft im Januar?
- Nächste Folge: Energiekrise und "Doppel-Wumms"`;

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 6000,
  system: systemPrompt,
  messages: [
    {
      role: "user",
      content: `${storyInput}

Erstelle eine JSON-Antwort mit dieser exakten Struktur:
{
  "title": "Kurzer Carousel-Titel (max 5 Wörter)",
  "consistencyContext": {
    "artStyle": "3D cartoon render, Pixar animation style, expressive faces, bold outlines, warm cinematic lighting, detailed textures",
    "colorPalette": "Beschreibe die Farbpalette passend zum Setting",
    "environment": "Berliner Podcast-Studio mit modernem Flair, Mikrofon, Schreibtisch, Stadtlicht durch Fenster",
    "characters": [
      {
        "assetId": 0,
        "name": "Toni",
        "outfit": "black fitted t-shirt, casual jeans, modern sneakers, slight stubble",
        "visualDescription": "Berlin podcast host, mid-30s, lean build, dark short hair, expressive cartoon eyes, confident posture, microphone in front"
      },
      {
        "assetId": 0,
        "name": "Olaf Scholz",
        "outfit": "dark navy business suit, white dress shirt, no tie, slightly loosened collar",
        "visualDescription": "Former German chancellor, mid-60s, grey thinning hair, round face, slightly stiff posture, politician's careful expression"
      }
    ],
    "globalStylePrompt": "3D cartoon render Pixar style. Berlin podcast studio setting. Toni: lean mid-30s host, black t-shirt, dark short hair, expressive eyes, microphone. Olaf Scholz: mid-60s politician, navy suit, grey hair, stiff posture. Warm cinematic lighting, bold outlines, high detail."
  },
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "Text auf dem Bild – max 2-3 kurze Sätze auf Deutsch",
      "caption": "Instagram Caption mit Emojis",
      "charactersInSlide": ["Toni"],
      "imagePrompt": "Detaillierter Bildprompt auf Englisch mit Szene, Charakteren und Outfits"
    }
  ],
  "usedAssetIds": []
}

Genau 10 Slides. textContent auf Deutsch, imagePrompt auf Englisch.`,
    },
  ],
});

let jsonText = response.content[0].text.trim();
if (jsonText.startsWith("```")) {
  jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
}

const story = JSON.parse(jsonText);
console.log(`✅ Story generated: "${story.title}"`);
console.log(`   ${story.slides.length} slides created\n`);

// Save story JSON
mkdirSync("/tmp/imagen-test", { recursive: true });
writeFileSync("/tmp/imagen-test/story.json", JSON.stringify(story, null, 2));
console.log("📄 Story saved to /tmp/imagen-test/story.json\n");

// Print all slide texts
console.log("📋 Slide Overview:");
story.slides.forEach((s) => {
  console.log(`  Slide ${s.slideNumber}: ${s.textContent.substring(0, 80)}...`);
});

// ─── Step 2: Generate images for slides 1, 5, 10 (sample) ────────────────────

console.log("\n🎨 Step 2: Generating images via Atlas Cloud gpt-image-2...\n");
console.log("(Generating slides 1, 5, and 10 as samples)\n");

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";

async function generateImage(prompt, slideNum) {
  console.log(`  → Submitting slide ${slideNum}...`);

  const fullPrompt = `${story.consistencyContext.globalStylePrompt} ${prompt} Instagram carousel slide ${slideNum}/10. High quality 3D render, cinematic composition.`;

  const submitRes = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ATLAS_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-image-2/text-to-image",
      prompt: fullPrompt,
      size: "1024x1024",
      quality: "high",
      output_format: "jpeg",
      enable_base64_output: false,
      enable_sync_mode: false,
    }),
  });

  const submitData = await submitRes.json();
  if (!submitData.data?.id) {
    throw new Error(`Submit failed: ${JSON.stringify(submitData)}`);
  }

  const predictionId = submitData.data.id;
  console.log(`     Prediction ID: ${predictionId}`);

  // Poll for result
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000));

    const pollRes = await fetch(`${ATLAS_BASE}/model/prediction/${predictionId}`, {
      headers: { Authorization: `Bearer ${ATLAS_KEY}` },
    });
    const pollData = await pollRes.json();
    const status = pollData.data?.status;

    if (status === "completed") {
      const url = pollData.data?.outputs?.[0];
      console.log(`  ✅ Slide ${slideNum} done: ${url}`);
      return url;
    }
    if (status === "failed") {
      throw new Error(`Generation failed: ${pollData.data?.error}`);
    }
    process.stdout.write(".");
  }
  throw new Error("Timed out");
}

const results = {};

// Generate slide 1 (Hook)
results.slide1 = await generateImage(story.slides[0].imagePrompt, 1);

// Generate slide 5 (Eskalation)
results.slide5 = await generateImage(story.slides[4].imagePrompt, 5);

// Generate slide 10 (CTA)
results.slide10 = await generateImage(story.slides[9].imagePrompt, 10);

// Save results
writeFileSync(
  "/tmp/imagen-test/results.json",
  JSON.stringify({ story: story.title, images: results, slides: story.slides }, null, 2)
);

console.log("\n\n🎉 END-TO-END TEST COMPLETE!");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Story: "${story.title}"`);
console.log(`\nGenerated Images:`);
console.log(`  Slide 1 (Hook):  ${results.slide1}`);
console.log(`  Slide 5 (Mitte): ${results.slide5}`);
console.log(`  Slide 10 (CTA):  ${results.slide10}`);
console.log("\nResults saved to /tmp/imagen-test/results.json");
