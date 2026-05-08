# Vision Post-Generation QC — Design

Status: design only. No code in this document. Implementation is for a
follow-up worker.

Goal: after an image is generated for a slide, run Claude Vision over the
resulting image and report concrete issues against the slide's intent
(character match, environment lock, legible overlay text, etc.). Surface
the report in `StoryDetail` so the user can decide whether to regenerate.

Throughout: this is a **single-user power tool**. Cost is real but
manageable; throttling can be coarse. UX clarity beats clever caching.

---

## 1. Problem

The Atlas / `gpt-image-2` edit endpoint is *good* but not deterministic.
Failure modes we see in practice:

- **Character drift.** Reference image was Papa with glasses + grey
  T-shirt; output draws him without glasses, in a hoodie.
- **Environment break.** Scene 1 lock = "selbe Küche, weiße Schränke".
  Slide 3 of that scene renders a wood-panel kitchen.
- **Illegible overlay text.** Server tells the model "copy typography
  exactly from the stil-referenz" (`storyService.ts:393`) but the model
  often still produces gibberish-glyph text on Slide N.
- **Wrong characters present.** `slide.charactersInSlide = ["Papa",
  "Sohn"]` but the rendered slide shows just Papa. Currently invisible
  to the user until they manually scroll the carousel.
- **Style mismatch.** Stil-referenz dictates flat 2D cartoon — model
  outputs 3D render anyway.

Today, the user catches all of these by eyeballing the carousel. A
QC pass surfaces them with file-line specificity.

---

## 2. Trigger surface

Three options:

| Option | Pros | Cons |
|---|---|---|
| (a) Always run after every gen / regen (server-driven) | No extra clicks; QC report ready when user opens story | $0.015 × N slides on every story; some users may not care for every slide |
| (b) Manual button per slide | Pay only for what's checked | Easy to forget; defeats the "ambient quality signal" purpose |
| (c) Manual "Run QC" button at story level (one click → all slides) | Cheap to skip; explicit cost trigger | Still requires user action |

**Recommendation: (a) automatic per slide, with a single feature flag
`QC_AUTO=on|off` env var.** Plus the manual button per slide as the
re-run path (when user has tweaked the prompt).

Rationale: the user's complaint frequency is high enough that a
~$0.15-per-story tax is bought back in saved regenerate cycles. And
making it default-on means every story has a QC artifact, which makes
debugging consistency issues across stories tractable.

The trigger lives at the *end* of `generate.generateAllImages`
(`routers.ts:505-594`) and at the end of `generate.regenerateSlide`
(`routers.ts:596-656`), after the slide is `updateSlide(... status:
"complete")`. QC runs in parallel with the next slide's image gen
(or sequentially if the rate limit demands).

---

## 3. Input contract

```ts
// New procedure on slidesRouter (or generateRouter — consider co-locating
// near regenerateSlide).
slides.qualityCheck: publicProcedure
  .input(
    z.object({
      slideId: z.number().int().positive(),
      // Future: allow targeted subset of checks
      // checks: z.array(z.enum(["character_match", "env_lock", "text_legibility", "char_presence", "style_match"])).optional(),
    })
  )
  .mutation(async ({ input }) => { /* … */ });
```

The mutation is idempotent for a given (slideId, image content hash) — the
QC report is keyed by the slide's current `imageKey`. If the slide is
regenerated, we re-run automatically; if the user calls it twice on the
same image, we return the cached report.

---

## 4. Vision prompt design

Pattern mirrors `server/_core/visionCategorize.ts:`:

- **System prompt** with `cache_control: { type: "ephemeral" }` so the
  long instruction string is reused across slides in a batch. The
  per-slide intent (the small variable bit) goes in the user message.
- **`tool_choice: { type: "tool", name: "report_qc" }`** to force
  structured output.
- **`max_tokens: 1500`** — the report is structured + a few short
  rationales, never long-form.
- Image source resolution mirrors what the existing categorizer does
  (`server/routers.ts:111-124`): prefer presigned URL via
  `getPresignedStorageUrl()`; fall back to base64 via
  `prepareImageForVision()`.

### Tool schema

```ts
const QC_TOOL = {
  name: "report_qc",
  description:
    "Compare a generated slide image against its intended content " +
    "(scene, characters, overlay text) and report any issues.",
  input_schema: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "character_drift",     // Looks different from reference
                "character_missing",   // Should be in slide but isn't
                "character_extra",     // Unexpected person rendered
                "env_break",           // Background broke scene lock
                "style_mismatch",      // Wrong rendering style
                "text_illegible",      // Overlay text is gibberish
                "text_wrong",          // Overlay text differs from textContent
                "composition_issue",   // Cropping, faces cut off, etc.
                "other",
              ],
            },
            severity: { type: "string", enum: ["info", "warn", "error"] },
            characterName: { type: "string" }, // optional, when relevant
            description: { type: "string" },   // 1-2 sentences DE
            suggestedFix: { type: "string" },  // 1 sentence DE
            confidence: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["category", "severity", "description", "confidence"],
        },
      },
      scores: {
        type: "object",
        properties: {
          characterMatch: { type: "integer", minimum: 0, maximum: 100 }, // null if no chars
          envLock:        { type: "integer", minimum: 0, maximum: 100 }, // null if scene 1 of story
          styleMatch:     { type: "integer", minimum: 0, maximum: 100 },
          textLegibility: { type: "integer", minimum: 0, maximum: 100 }, // null if no overlay
          overall:        { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["styleMatch", "overall"],
      },
      summary: { type: "string" }, // 1 sentence DE — TL;DR
    },
    required: ["issues", "scores", "summary"],
  },
} as const;
```

### System prompt (German, klarekante context)

```
Du bist Quality-Control-Reviewer für eine deutsche Instagram-Carousel-
Storytelling-App im "klarekante"-Stil (flacher 2D-Cartoon, kräftige
Farben, Typografie als Bildelement). Deine Aufgabe: vergleiche ein
generiertes Slide-Bild mit der Intention, die in der User-Message
beschrieben ist, und melde konkrete Abweichungen via tool_use
(report_qc).

GRUNDREGELN:
- Sei knapp und konkret. Pro Issue: 1-2 Sätze Beschreibung, 1 Satz Fix-
  Vorschlag.
- "info" = nice-to-have, "warn" = sichtbare Abweichung, "error" =
  Story-brechend (falscher Charakter, gibberish-Text, falsches Setting).
- Wenn alles passt: leere `issues`-Liste, hohe scores. Keine erfundenen
  Probleme.
- Keine Mit-Charaktere erfinden. Wenn `expectedCharacters` leer ist und
  niemand zu sehen, ist das KEIN Issue.
- Bei Text-Overlay: vergleiche mit `expectedText`. "Sinnvoll lesbarer
  deutscher Text" ist Mindestanforderung; exakte Wortgleichheit nicht
  erforderlich, da Modell oft Layout-Varianten produziert.
- Bei Charakteren: wenn `referenceImageUrl` fehlt, ist character_drift
  nicht messbar — gib `characterMatch: null` und kein Drift-Issue raus.

SCORES (0-100):
- characterMatch: wie gut sieht jeder erwartete Charakter aus wie sein
  Reference. null wenn keine Refs / keine Chars.
- envLock: wie gut hält das Bild die scene.environmentLockNotes.
- styleMatch: wie gut entspricht das Rendering den stil-referenz
  Vorgaben (flach vs 3D, Farbpalette, Typo-Stil).
- textLegibility: wie sauber ist der Text-Overlay (lesbares Deutsch,
  korrekte Glyphen).
- overall: gewichteter Eindruck.
```

### User message (per slide)

```
SLIDE {slideNumber} of {totalSlides} in story "{storyTitle}".

EXPECTED CONTENT
- Scene: {scene.environment}
- Lock: {scene.environmentLockNotes || "—"}
- Expected characters: {slideCharacterNames.join(", ") || "(none)"}
- Expected overlay text: "{slide.textContent || "(none)"}"
- Caption (not necessarily on image): "{slide.caption || "—"}"

CONSISTENCY CONTEXT
- artStyle: {ctx.artStyle}
- colorPalette: {ctx.colorPalette}
- (style references are attached as additional images below)

[primary image]            ← the generated slide
[ref 1: Papa sheet]        ← character reference, repeat per char
[ref 2: Mama sheet]
[ref 3: stil-referenz]     ← one representative style sheet

Bitte rufe report_qc auf.
```

Image stack: same Atlas-style 4-image cap. Order: generated slide
first (the subject), then character references for chars in this slide
(`slide.charactersInSlide`), then one style reference. The vision call
itself doesn't have the same hard 4-cap as Atlas, but staying consistent
keeps the prompt comparable.

The system prompt is `ephemeral`-cached. Per-slide variability is
entirely in the user message → cache hit rate stays high across a story.

---

## 5. Output contract

Return shape:

```ts
type QcSeverity = "info" | "warn" | "error";

type QcIssueCategory =
  | "character_drift"
  | "character_missing"
  | "character_extra"
  | "env_break"
  | "style_mismatch"
  | "text_illegible"
  | "text_wrong"
  | "composition_issue"
  | "other";

interface QcIssue {
  category: QcIssueCategory;
  severity: QcSeverity;
  characterName?: string;
  description: string;
  suggestedFix?: string;
  confidence: number; // 0-100
}

interface QcScores {
  characterMatch: number | null;
  envLock: number | null;
  styleMatch: number;
  textLegibility: number | null;
  overall: number;
}

interface QcReport {
  version: 1;
  slideId: number;
  imageKey: string;        // which image this report is *about*
  generatedAt: string;     // ISO timestamp
  model: string;           // e.g. "claude-sonnet-4-6"
  scores: QcScores;
  issues: QcIssue[];
  summary: string;
  rawTokensIn?: number;
  rawTokensOut?: number;
  costUsd?: number;        // estimated, for the per-story cost rollup
}
```

Server returns `QcReport`. Client persists it to `slides.qcReport`
(see Storage below) and derives a badge state from
`Math.max(...issues.map(i => sevWeight(i.severity)))`.

---

## 6. Storage

Two options:

### A. `slides.qcReport JSON` column (preferred)

Add to `drizzle/schema.ts:154` slides table:

```ts
qcReport: json("qcReport").$type<QcReport | null>(),
qcImageKey: varchar("qcImageKey", { length: 512 }), // null if never run
```

`qcImageKey` is the image hash at the time of QC. When a slide is
regenerated, `imageKey` changes; if `qcImageKey !== imageKey` the UI
shows a "QC stale" hint and offers to re-run.

Migration: one column add. Backfill: `qcReport = NULL` for all existing
slides (nothing to backfill semantically — QC is forward-looking).

### B. New `qc_reports` table

Allows storing history (every QC run, including over regenerations).
Useful for cost analysis and "did this slide get better after edit X".

```sql
CREATE TABLE qc_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slideId INT NOT NULL,
  imageKey VARCHAR(512) NOT NULL,
  reportJson JSON NOT NULL,
  costUsd DECIMAL(8,4),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (slideId),
  UNIQUE KEY uniq_slide_image (slideId, imageKey)
);
```

**Recommendation: Start with A.** It's one column, no extra table, no
joins on the read path. The history option (B) can be added later
without breaking A — just keep `slides.qcReport` as the "latest" cache
and add `qc_reports` as the audit log.

The `UNIQUE KEY uniq_slide_image (slideId, imageKey)` in option B is the
key idea worth borrowing into option A's invalidation logic: never
overwrite a fresh report with a stale-trigger.

---

## 7. UI hook

### Where it lives

In `client/src/pages/StoryDetail.tsx`, the QC report renders **inline
under the active slide**, between the image and the textContent block
(`StoryDetail.tsx:285-296`).

When the QC has issues, a colored pill appears on the slide thumbnail
in the rail (red for `error`, amber for `warn`, blue dot for `info`).

### Mockup

#### Active slide section, no issues

```
┌────────────────────────────────────────────┐
│                                            │
│            [generated image 1024]          │
│                                            │
└────────────────────────────────────────────┘
 ✓ QC: alles gut · overall 92                 ← muted green text
```

#### Active slide section, with issues

```
┌────────────────────────────────────────────┐
│                                            │
│            [generated image 1024]          │
│                                            │
└────────────────────────────────────────────┘
 ⚠ QC: 2 issues · overall 64    [▾ Details]   ← amber

▾ expanded:
 ┌──────────────────────────────────────────────┐
 │ ERROR  character_drift  Papa  conf 88        │
 │   "Papa hat eine Brille auf dem Reference,    │
 │    aber im Bild keine."                      │
 │   Fix: Refgewichtung höher / regenerate      │
 ├──────────────────────────────────────────────┤
 │ WARN   text_illegible          conf 72       │
 │   "Overlay-Text enthält gibberish-Glyphen."  │
 │   Fix: Prompt vereinfachen oder Text         │
 │        manuell als Sticker nachsetzen.       │
 ├──────────────────────────────────────────────┤
 │ scores  charM 60 · env 95 · style 88 ·       │
 │         text 40 · overall 64                  │
 │ [Re-run QC]                                  │
 └──────────────────────────────────────────────┘
```

### Thumbnail rail badges

```
┌──────────────┐
│ [thumb]   ⚠2 │  ← amber dot + count
│ Slide 3      │
│ Fertig       │
└──────────────┘
```

`StoryDetail.tsx:317-349` — add `slide.qcReport?.issues.length` derived
state next to `slideStatus.label`.

### Story-level rollup

In the action bar near "ZIP exportieren" (`StoryDetail.tsx:174-179`):

```
[ZIP exportieren (7/7)]   QC: 5/7 OK · 1 Warn · 1 Error  [Re-run QC all]
```

This is the at-a-glance signal "is this story actually shippable."

---

## 8. Cost / perf model

Vision call: ~$0.015 per slide (input image + system prompt cached + 1-3
reference images + ~500 output tokens).

| Story size | Cost (one full QC) |
|---|---|
| 3 slides | $0.045 |
| 5 slides | $0.075 |
| 7 slides | $0.105 |
| 10 slides | $0.15 |

This is on top of the (much larger) image generation cost.

### Throttle / batch

- **In-process queue.** QC for a story runs on a single worker that
  processes slides sequentially after the image-gen loop. Avoids
  hammering Anthropic with parallel calls.
- **Skip if image is identical.** Use `slides.qcImageKey === slides.imageKey`
  as a short-circuit.
- **Manual re-run is free of throttle** (single slide).
- **Soft daily cap (env var) for safety.** `QC_DAILY_BUDGET_USD=2.00` —
  if exceeded, log warning and disable auto-QC for the rest of the
  day. This is paranoia for a runaway-loop scenario.

### Cache hit math

The system prompt + style instructions = ~600 tokens. Cached. Per slide
the variable user message is ~100-200 tokens. So cache savings are real
for the 2nd-Nth slide in a batch (90 % discount on the cached portion).

---

## 9. Failure modes

| Failure | Behavior |
|---|---|
| Vision can't load the slide image (presign expired, S3 5xx) | Retry 1×; if still failing, `qcReport = { version:1, scores:{overall: 0}, issues:[{category:"other", severity:"error", description:"QC konnte das Bild nicht laden", confidence:100}], summary:"QC fehlgeschlagen" }` and surface a "QC fehlgeschlagen — erneut versuchen" UI. Never block the slide itself from being used. |
| Image is fully unrecognizable (NSFW filter triggered, blank canvas) | Vision returns `overall < 30` and likely `style_mismatch` + `composition_issue`. UI shows red badge. |
| Anthropic 429 rate-limit | Backoff 30s, retry once. If still fails, mark report `null` (not an error report — distinguishes "we tried and got nothing" from "we found problems"). |
| Reference image (character sheet) unavailable | Run QC anyway, but skip `character_drift` checks; set `characterMatch: null` and add a single `info` issue noting "Reference image not available — character drift cannot be verified". |
| Tool-use missing in response | Same as visionCategorize.ts:207 — throw, caller catches, report set to error-shape. |
| Slide has no `imagePrompt` (legacy/empty) | Skip QC entirely. Don't run on empty slides. |

Important: a failed QC must never invalidate the slide image. The image
is the artifact; QC is commentary.

---

## 10. Phasing

### MVP (Phase 1) — character match only

- Add `slides.qcReport` column.
- Implement `slides.qualityCheck` mutation with the tool schema.
- Run only `character_drift` + `character_missing` checks.
- Auto-trigger after `regenerateSlide` only (not after full
  `generateAllImages` — too noisy on first attempt).
- UI: badge on thumbnail + expandable panel under active slide.

This already covers the highest-frequency complaint and proves the
plumbing.

### Phase 2 — full check set

- Add env_lock, style_match, text_legibility, composition_issue.
- Auto-trigger after `generateAllImages` too (gated by `QC_AUTO=on`).
- Story-level rollup in the action bar.

### Phase 3 — actionable fixes

- "Apply suggested fix" button on issues → modifies `slide.imagePrompt`
  with a server-derived patch and re-queues regeneration. (This is
  where things get hand-wavey; do it after we have real reports to
  inform the patches.)
- QC history table for "did this slide improve?" diffs.

**Recommendation: Ship MVP first.** Don't build phase 2 or 3 without
real Phase 1 data showing which checks actually fire on real stories.

---

## 11. Open questions for user

1. **Auto-on-everything vs auto-on-regen-only for MVP?** I recommend
   regen-only to start (cheaper, lower noise). Confirm.
2. **Cost ceiling.** Is `$0.15/story-of-10-slides` of QC overhead OK as
   a default, or should it be opt-in per story (a "Run QC after
   generation" checkbox in `StoryGenerator`)?
3. **German severities or English?** The QC tool's enum values are
   stable code-side (English), but the UI labels could be German
   ("Hinweis / Warnung / Fehler"). Preference?
4. **Issue persistence on regenerate.** When a slide is regenerated and
   QC re-runs, do we keep the previous report for diff (option B
   storage), or overwrite (option A)? I recommend overwrite for MVP.
5. **Should "everything OK" reports be suppressed in the UI?** The "✓ QC:
   alles gut · 92" line takes a row of vertical space per slide and the
   user only cares when something's wrong. Consider showing only the
   score number, no row.
6. **Style-ref selection for the QC call.** With 12 stil-referenz
   assets, which one(s) does QC see? I propose: pick the highest-
   weighted one or just the first. Alternative: let the user mark a
   "primary" stil-referenz.
7. **Confidence threshold for surfacing issues?** A `confidence < 50`
   issue is probably noise. Filter UI-side or trust the model? I'd
   filter out `confidence < 50 && severity === "info"`.
8. **Where does the QC mutation live, on `slides` (new router) or
   `generate`?** It's adjacent to regenerateSlide, so I'd add a
   `slides` router and put it there for clarity. Both work.
