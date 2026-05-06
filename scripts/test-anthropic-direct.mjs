/**
 * Direct test of story generation using Anthropic SDK
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";

const API_KEY = process.env.ANTHROPIC_API_KEY;

const client = new Anthropic({ apiKey: API_KEY });

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

Antworte NUR mit validem JSON (kein Markdown, keine Codeblöcke):
{
  "title": "Story-Titel",
  "theme": "Kurzbeschreibung",
  "consistencyContext": {
    "artStyle": "Cartoon-Illustration, Mitchell-Family-Style, warm und lebendig",
    "colorPalette": "Dunkles Blau/Schwarz mit orangenen und weißen Akzenten",
    "environment": "Podcast-Studio Berlin, Mikrofone, Neonlichter",
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
      "textContent": "Text auf dem Slide (max 2-3 Zeilen)",
      "caption": "Was im Bild zu sehen ist",
      "imagePrompt": "Detaillierter Bildprompt für gpt-image-2 auf Englisch",
      "charactersInSlide": ["Toni"]
    }
  ]
}`;

async function generateCarousel(scriptContent, storyTitle) {
  console.log(`\n🎬 Generiere: "${storyTitle}"`);
  
  const truncated = scriptContent.length > 6000 
    ? scriptContent.substring(0, 6000) + "\n\n[...Skript gekürzt...]"
    : scriptContent;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: `Skript für "${storyTitle}":\n\n${truncated}` }
    ]
  });

  let text = response.content[0].text.trim();
  // Strip markdown code blocks if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  
  const parsed = JSON.parse(text);
  console.log(`✅ Titel: ${parsed.title}`);
  console.log(`   Slides: ${parsed.slides?.length}`);
  console.log(`   Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
  parsed.slides?.forEach(s => {
    console.log(`   [${s.slideNumber}] "${s.textContent?.substring(0, 70)}"`);
  });
  return parsed;
}

async function main() {
  console.log("🚀 Story-Test – Anthropic claude-sonnet-4-6 direkt\n");

  try {
    const c1 = await generateCarousel(story1Raw, "EP01 – Dein Burnout ist kein Versagen");
    writeFileSync("/home/ubuntu/carousel-story1-final.json", JSON.stringify(c1, null, 2));
    console.log("   💾 → /home/ubuntu/carousel-story1-final.json");
  } catch (e) {
    console.error("❌ Story 1 Fehler:", e.message);
  }

  try {
    const c2 = await generateCarousel(story2Raw, "Toni × Olaf Scholz – Die Zeitenwende");
    writeFileSync("/home/ubuntu/carousel-story2-final.json", JSON.stringify(c2, null, 2));
    console.log("   💾 → /home/ubuntu/carousel-story2-final.json");
  } catch (e) {
    console.error("❌ Story 2 Fehler:", e.message);
  }

  console.log("\n🎉 Fertig!");
}

main().catch(console.error);
