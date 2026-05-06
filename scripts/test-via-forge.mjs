/**
 * Test story generation via the Manus Forge LLM proxy
 * (same endpoint the server uses via invokeLLM helper)
 */
import { readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";

// Load project .env
config({ path: "/home/ubuntu/imagen/.env" });

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

if (!FORGE_API_URL || !FORGE_API_KEY) {
  console.error("❌ FORGE env vars not set. Checking system env...");
  console.log("BUILT_IN_FORGE_API_URL:", process.env.BUILT_IN_FORGE_API_URL ? "set" : "NOT SET");
  console.log("BUILT_IN_FORGE_API_KEY:", process.env.BUILT_IN_FORGE_API_KEY ? "set" : "NOT SET");
  process.exit(1);
}

console.log("✅ Forge API URL:", FORGE_API_URL.substring(0, 40) + "...");

const story1Raw = readFileSync("/home/ubuntu/upload/pasted_content.txt", "utf-8");
const story2Raw = readFileSync("/home/ubuntu/upload/pasted_content_2.txt", "utf-8");

const SYSTEM_PROMPT = `Du bist ein kreativer Instagram-Content-Stratege für das Format "Hey was war denn das?" von klarekante.berlin.

Das Format: Berliner Komik + Ricky Gervais Stil. Direkt, provokant, ehrlich, mit Witz.

Aufgabe: Wandle ein Content-Skript (Podcast, Interview, Essay) in genau 10 Instagram Carousel Slides um.

REGELN:
- Slide 1: Hook/Titel (fesselnd, macht neugierig, max 1-2 Zeilen)
- Slides 2-9: Je ein Key-Punkt, starkes Zitat oder Szene aus dem Skript (max 2-3 Zeilen)
- Slide 10: CTA ("Folgt @klarekante.berlin | Nächste Folge: ...")
- Konsistenz: Gleicher visueller Stil, Outfit, Umgebung in allen Slides
- Toni (Host): Berliner Typ, 35-40, schwarzes T-Shirt, Jeans, Mikrofon

Antworte NUR mit validem JSON:
{
  "title": "Story-Titel",
  "theme": "Kurzbeschreibung",
  "consistencyContext": {
    "artStyle": "Cartoon-Illustration, Mitchell-Family-Style, warm und lebendig",
    "colorPalette": "Dunkles Blau/Schwarz mit orangenen und weißen Akzenten",
    "environment": "Podcast-Studio mit Berliner Flair, Mikrofone, Neonlichter im Hintergrund",
    "characters": [
      {
        "name": "Toni",
        "role": "Host",
        "outfit": "Schwarzes T-Shirt, dunkle Jeans, weiße Sneakers",
        "visualDescription": "Berliner Typ, 35-40 Jahre, lässig, expressives Gesicht, Mikrofon in der Hand"
      }
    ],
    "globalStylePrompt": "Instagram Carousel Slide, Mitchell-Family-Cartoon-Stil, warm, lebendig, Berliner Energie, 1080x1080px"
  },
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "Text auf dem Slide (max 2-3 Zeilen, knackig und direkt)",
      "caption": "Was im Bild zu sehen ist",
      "imagePrompt": "Detaillierter Bildprompt für gpt-image-2",
      "charactersInSlide": ["Toni"]
    }
  ]
}`;

async function generateViaForge(scriptContent, storyTitle) {
  console.log(`\n🎬 Generiere: "${storyTitle}"`);
  
  const truncated = scriptContent.length > 5000 
    ? scriptContent.substring(0, 5000) + "\n\n[...gekürzt...]"
    : scriptContent;

  const body = {
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Skript für "${storyTitle}":\n\n${truncated}` }
    ],
    max_tokens: 4000,
  };

  const res = await fetch(`${FORGE_API_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No content in response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response: " + text.substring(0, 300));
  
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log("🚀 Story-Test via Forge LLM Proxy\n");

  // Test Story 1: Burnout/Eltern Podcast
  try {
    const c1 = await generateViaForge(story1Raw, "EP01 – Dein Burnout ist kein Versagen");
    console.log("✅ Story 1 OK! Titel:", c1.title);
    console.log("   Charaktere:", c1.consistencyContext?.characters?.map(c => c.name).join(", "));
    console.log("   Slides:", c1.slides?.length);
    c1.slides?.forEach(s => {
      console.log(`   [${s.slideNumber}] "${s.textContent?.substring(0, 70)}"`);
    });
    writeFileSync("/home/ubuntu/carousel-story1.json", JSON.stringify(c1, null, 2));
    console.log("   💾 → /home/ubuntu/carousel-story1.json");
  } catch (e) {
    console.error("❌ Story 1:", e.message);
  }

  // Test Story 2: Scholz Interview
  try {
    const c2 = await generateViaForge(story2Raw, "Toni × Olaf Scholz – Die Zeitenwende");
    console.log("\n✅ Story 2 OK! Titel:", c2.title);
    console.log("   Charaktere:", c2.consistencyContext?.characters?.map(c => c.name).join(", "));
    console.log("   Slides:", c2.slides?.length);
    c2.slides?.forEach(s => {
      console.log(`   [${s.slideNumber}] "${s.textContent?.substring(0, 70)}"`);
    });
    writeFileSync("/home/ubuntu/carousel-story2.json", JSON.stringify(c2, null, 2));
    console.log("   💾 → /home/ubuntu/carousel-story2.json");
  } catch (e) {
    console.error("❌ Story 2:", e.message);
  }

  console.log("\n🎉 Fertig!");
}

main().catch(console.error);
