/**
 * Imagen V3 – Prompt Builder
 *
 * Builds all LLM prompts dynamically from the Project record.
 * Nothing is hardcoded here – tone, style, frame count rules, and
 * image render style all come from the database.
 *
 * Three prompt layers:
 *   1. PLAN  – Claude decides scenes, entities, slide count
 *   2. WRITE – Claude writes text + imagePrompt per slide
 *   3. IMAGE – Final Atlas Cloud prompt (globalStylePrompt + scene + variant info)
 */
import type { Project } from "../drizzle/schema";
import type {
  ConsistencyCharacterRef,
  Scene,
  SlideContent,
  StoryPlan,
} from "@shared/types";

// ─── PLAN phase ───────────────────────────────────────────────────────────────

/**
 * System prompt for the PLAN phase.
 * Uses project.planSystemPrompt verbatim – no injected defaults.
 */
export function buildPlanSystemPrompt(project: Project): string {
  return project.planSystemPrompt.trim();
}

/**
 * User message for the PLAN phase.
 * Injects the theme/script, character library and asset catalog.
 */
export function buildPlanUserMessage(opts: {
  theme: string;
  characterList: string;
  assetList: string;
  project: Project;
}): string {
  const { theme, characterList, assetList, project } = opts;
  const frameRule =
    project.minFrames === project.maxFrames
      ? `Genau ${project.minFrames} Frames.`
      : `Zwischen ${project.minFrames} und ${project.maxFrames} Frames.`;

  return `THEMA / SKRIPT:
${theme}

FORMAT: ${project.name} (${project.imageFormat})
FRAME-REGEL: ${frameRule}

VERFÜGBARE CHARAKTERE IN DER LIBRARY:
${characterList || "(noch keine in DB)"}

VERFÜGBARE ASSETS (Items / Umgebungen / Style-Refs):
${assetList || "(keine)"}

Plane die Story. Antworte mit JSON in dieser exakten Struktur:
{
  "title": "Kurzer Titel max 5 Wörter",
  "suggestedSlideCount": ${project.minFrames}..${project.maxFrames},
  "reasoning": "Kurze Begründung warum genau diese Anzahl.",
  "scenes": [
    {
      "id": "scene-1",
      "slideRange": [1, 6],
      "environment": "spezifische Location-Beschreibung",
      "environmentLockNotes": "was über alle Slides dieser Scene gleich bleibt",
      "transitionToNext": null
    }
  ],
  "detectedEntities": [
    {
      "name": "Papa",
      "type": "character",
      "matchedCharacterId": 1,
      "matchedAssetIds": [],
      "needsWorldBuilding": false,
      "draftVisualDescription": null
    }
  ]
}

REGELN:
- scenes[].slideRange muss exakt [1..suggestedSlideCount] lückenlos abdecken
- transitionToNext nur am letzten Slide einer Scene (außer der letzten Scene)
- matchedCharacterId nur wenn ID in der Liste oben existiert
- Bei needsWorldBuilding=true MUSS draftVisualDescription gesetzt sein
- type: "character" für Personen/Tiere, "object" für Items, "place" für reine Orte
- Maximal 6 detectedEntities (sonst wird das Format überladen)
Rufe das Tool plan_story mit den entsprechenden Werten auf.`;
}

// ─── WRITE phase ──────────────────────────────────────────────────────────────

/**
 * System prompt for the WRITE phase.
 * Uses project.writeSystemPrompt verbatim.
 */
export function buildWriteSystemPrompt(project: Project): string {
  return project.writeSystemPrompt.trim();
}

/**
 * User message for the WRITE phase.
 * Injects plan, characters, style refs and format constraints.
 */
export function buildWriteUserMessage(opts: {
  theme: string;
  plan: StoryPlan;
  resolvedCharacters: ConsistencyCharacterRef[];
  styleReferenceUrls: string[];
  project: Project;
}): string {
  const { theme, plan, resolvedCharacters, styleReferenceUrls, project } = opts;

  const characterBlock = resolvedCharacters
    .map((c) => {
      const base = `- ${c.name}`;
      const desc = c.visualDescription ? `: ${c.visualDescription.slice(0, 120)}` : "";
      return base + desc;
    })
    .join("\n");

  const sceneBlock = plan.scenes
    .map(
      (s) =>
        `- ${s.id} (Slides ${s.slideRange[0]}-${s.slideRange[1]}): ${s.environment}` +
        (s.environmentLockNotes ? ` | Lock: ${s.environmentLockNotes}` : "")
    )
    .join("\n");

  const styleBlock =
    styleReferenceUrls.length > 0
      ? `\nSTYL-REFERENZEN: ${styleReferenceUrls.length} Bild(er) werden als Referenz übergeben.`
      : "";

  return `THEMA / SKRIPT:
${theme}

FORMAT: ${project.name} (${project.imageFormat})
GLOBALER STIL: ${project.globalStylePrompt.slice(0, 200)}

PLAN:
- Titel: ${plan.title}
- ${plan.suggestedSlideCount} Slides
- Reasoning: ${plan.reasoning}

SCENES:
${sceneBlock}

CHARAKTERE:
${characterBlock || "(keine)"}
${styleBlock}

Schreibe jetzt alle ${plan.suggestedSlideCount} Slides. Antworte als JSON-Array:
[
  {
    "slideNumber": 1,
    "textContent": "Text der auf dem Slide erscheint",
    "caption": "Kurze Bildunterschrift / Dialogue",
    "imagePrompt": "Detaillierter englischer Bildprompt für Atlas Cloud",
    "charactersInSlide": ["Papa"],
    "sceneId": "scene-1"
  }
]

REGELN FÜR imagePrompt:
- Englisch, maximal 200 Wörter
- Beschreibe NUR die Aktion/Komposition – KEIN Stil (der wird automatisch vorangestellt)
- Charakternamen exakt wie in der Charakterliste verwenden
- Kein Text/Schrift im Bild beschreiben`;
}

// ─── IMAGE phase ──────────────────────────────────────────────────────────────

/**
 * Builds the final image prompt sent to Atlas Cloud.
 * Structure: [globalStylePrompt] + [scene context] + [character activities] + [slide imagePrompt]
 *
 * The globalStylePrompt is always first so Atlas Cloud anchors the style
 * before reading the scene-specific content.
 */
export function buildImagePrompt(opts: {
  project: Project;
  scene: Scene | null;
  slide: SlideContent;
  characterActivities: Record<string, string>;
  sceneActivityNotes?: string;
}): string {
  const { project, scene, slide, characterActivities, sceneActivityNotes } = opts;

  const parts: string[] = [];

  // 1. Global style anchor (from project – no hardcoding)
  parts.push(project.globalStylePrompt.trim());

  // 2. Scene / environment context
  if (scene) {
    parts.push(`Setting: ${scene.environment}.`);
    if (scene.environmentLockNotes) {
      parts.push(`Consistent elements: ${scene.environmentLockNotes}.`);
    }
  }

  // 3. Character activities (what each character is doing in this frame)
  const activityLines = Object.entries(characterActivities)
    .map(([name, activity]) => `${name}: ${activity}`)
    .join("; ");
  if (activityLines) {
    parts.push(`Characters: ${activityLines}.`);
  }

  // 4. Scene activity notes (environment-level action, e.g. "rain starts")
  if (sceneActivityNotes) {
    parts.push(sceneActivityNotes);
  }

  // 5. Slide-specific image prompt (written by WRITE phase)
  parts.push(slide.imagePrompt ?? "");

  return parts.filter(Boolean).join(" ").trim();
}

// ─── WORLD-BUILDING phase ─────────────────────────────────────────────────────

/**
 * Builds the prompt for generating a new character/location sheet via world-building.
 * Uses the project's globalStylePrompt so the new asset matches the project's visual style.
 */
export function buildWorldBuildingPrompt(opts: {
  project: Project;
  entityName: string;
  entityType: "character" | "object" | "place";
  draftVisualDescription: string;
}): string {
  const { project, entityName, entityType, draftVisualDescription } = opts;

  const typeInstructions: Record<typeof entityType, string> = {
    character:
      "Full character sheet: front view, clear face, neutral pose, white/transparent background. Show distinctive features clearly.",
    object:
      "Clean product shot: isolated on white/transparent background, good lighting, all angles implied by single view.",
    place:
      "Establishing shot: wide angle, full environment visible, consistent lighting, no characters in frame.",
  };

  return [
    project.globalStylePrompt.trim(),
    `Create a reference sheet for: ${entityName}.`,
    typeInstructions[entityType],
    `Visual description: ${draftVisualDescription}`,
    "High quality, clean edges, suitable as a reference image for future generation.",
  ]
    .filter(Boolean)
    .join(" ");
}
