/**
 * Test script: Generate a carousel story from the provided content scripts
 * Tests the full pipeline: Claude story generation → image generation
 */
import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Read story 1 (Burnout/Eltern-Podcast)
const story1Raw = readFileSync("/home/ubuntu/upload/pasted_content.txt", "utf-8");
// Read story 2 (Scholz Interview)
const story2Raw = readFileSync("/home/ubuntu/upload/pasted_content_2.txt", "utf-8");

const SYSTEM_PROMPT = `Du bist ein kreativer Instagram-Content-Stratege für das Format "Hey was war denn das?" von klarekante.berlin.

Das Format ist: Berliner Komik + Ricky Gervais Stil. Direkt, provokant, ehrlich, mit Witz.

Deine Aufgabe: Wandle ein gegebenes Content-Skript (Podcast, Interview, Essay) in genau 10 Instagram Carousel Slides um.

KONSISTENZ-REGELN:
- Slide 1: Hook/Titel-Slide (fesselnder Einstieg, macht neugierig)
- Slides 2-9: Je ein Key-Punkt, Zitat oder Szene aus dem Skript
- Slide 10: Call-to-Action / Abschluss ("Folgt uns auf Instagram" etc.)
- Gleicher visueller Stil in allen Slides: Farbe, Schrift, Charakter-Outfit
- Charaktere bleiben konsistent: Toni (Host), Gäste haben feste visuelle Beschreibung

Antworte NUR mit validem JSON in diesem Format:
{
  "title": "Story-Titel",
  "theme": "Kurzbeschreibung des Themas",
  "consistencyContext": {
    "artStyle": "Cartoon-Illustration, Mitchell-Family-Style, warm und lebendig",
    "colorPalette": "Dunkles Blau/Schwarz mit orangenen und weißen Akzenten",
    "environment": "Podcast-Studio mit Berliner Flair, Mikrofone, Neonlichter",
    "characters": [
      {
        "name": "Toni",
        "role": "Host",
        "outfit": "Schwarzes T-Shirt, Jeans, Sneakers, Mikrofon in der Hand",
        "visualDescription": "Berliner Typ, 35-40, lässig, leicht chaotisch, expressives Gesicht"
      }
    ],
    "globalStylePrompt": "Instagram Carousel Slide, Mitchell-Family-Cartoon-Stil, warm, lebendig, Berliner Energie"
  },
  "slides": [
    {
      "slideNumber": 1,
      "textContent": "Text der auf dem Slide erscheint (max 2-3 Zeilen, knackig)",
      "caption": "Beschreibung was im Bild zu sehen ist",
      "imagePrompt": "Detaillierter Bildprompt für gpt-image-2 mit Charakter-Beschreibungen",
      "charactersInSlide": ["Toni"]
    }
  ]
}`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateCarouselFromScript(scriptContent, storyTitle) {
  console.log(`\n🎬 Generiere Carousel für: "${storyTitle}"`);
  console.log("📝 Skript-Länge:", scriptContent.length, "Zeichen");
  
  // Truncate if too long (keep first 4000 chars for key content)
  const truncated = scriptContent.length > 4000 
    ? scriptContent.substring(0, 4000) + "\n\n[...Skript gekürzt für Verarbeitung...]"
    : scriptContent;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `Hier ist das Content-Skript für "${storyTitle}". Erstelle daraus 10 Instagram Carousel Slides:\n\n${truncated}`
      }
    ],
    system: SYSTEM_PROMPT
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  
  // Extract JSON from response
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Raw response:", content.text.substring(0, 500));
    throw new Error("No JSON found in response");
  }
  
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log("🚀 Starte Story-Test-Pipeline...\n");
  
  // Test Story 1: Burnout/Eltern
  try {
    const carousel1 = await generateCarouselFromScript(
      story1Raw,
      "EP01 – Dein Burnout ist kein Versagen"
    );
    
    console.log("\n✅ Story 1 erfolgreich generiert!");
    console.log("📌 Titel:", carousel1.title);
    console.log("🎨 Stil:", carousel1.consistencyContext?.artStyle);
    console.log("👥 Charaktere:", carousel1.consistencyContext?.characters?.map(c => c.name).join(", "));
    console.log("\n📋 Slides:");
    carousel1.slides?.forEach((slide, i) => {
      console.log(`  Slide ${slide.slideNumber}: "${slide.textContent?.substring(0, 60)}..."`);
      console.log(`    📸 Prompt: ${slide.imagePrompt?.substring(0, 80)}...`);
    });
    
    // Save to file for inspection
    import("fs").then(({ writeFileSync }) => {
      writeFileSync("/home/ubuntu/carousel-story1.json", JSON.stringify(carousel1, null, 2));
      console.log("\n💾 Gespeichert: /home/ubuntu/carousel-story1.json");
    });
    
  } catch (err) {
    console.error("❌ Story 1 Fehler:", err.message);
  }

  // Test Story 2: Scholz Interview
  try {
    const carousel2 = await generateCarouselFromScript(
      story2Raw,
      "Toni interviewt Olaf Scholz – Die Zeitenwende"
    );
    
    console.log("\n✅ Story 2 erfolgreich generiert!");
    console.log("📌 Titel:", carousel2.title);
    console.log("🎨 Stil:", carousel2.consistencyContext?.artStyle);
    console.log("👥 Charaktere:", carousel2.consistencyContext?.characters?.map(c => c.name).join(", "));
    console.log("\n📋 Slides:");
    carousel2.slides?.forEach((slide, i) => {
      console.log(`  Slide ${slide.slideNumber}: "${slide.textContent?.substring(0, 60)}..."`);
    });
    
    import("fs").then(({ writeFileSync }) => {
      writeFileSync("/home/ubuntu/carousel-story2.json", JSON.stringify(carousel2, null, 2));
      console.log("\n💾 Gespeichert: /home/ubuntu/carousel-story2.json");
    });
    
  } catch (err) {
    console.error("❌ Story 2 Fehler:", err.message);
  }
  
  console.log("\n🎉 Test abgeschlossen!");
}

main().catch(console.error);
