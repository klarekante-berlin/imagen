# Scene Reassign / Post-Gen Scene Editing — Design

Status: design only. Implementation is a follow-up worker's job.

Goal: let the user, after a story is generated, (a) move a slide to a
different scene and (b) edit a scene's environment / lock notes. This
unlocks a workflow that today requires regenerating the entire story
from scratch.

---

## 1. Problem

Today the planning step (`StoryGenerator.tsx:225-271`) is the *only*
moment a user can shape scenes. After
`stories.generate` (`routers.ts:307-458`) writes slides, scenes are
locked into `consistencyContext.scenes[].slideRange` and there is no
UI or mutation to change them.

Real workflow problems:

- The plan said "Scene 2 = Auto, slides 4-5". User looks at generated
  Slide 5 and decides it should belong to Scene 3 (Bett) instead. Today:
  edit nothing, regenerate at most. There is no "move slide 5 to scene
  3" affordance.
- Scene-2 environment was "Auto, regen wet, dunkel". User wants to
  tweak to "Auto, sonnig". Today: cannot — `consistencyContext` is
  read-only post-gen.
- `SlideContent.sceneId` exists in the type
  (`shared/types.ts:67`) but is not in the DB schema
  (`drizzle/schema.ts:154-174`). It's defined and dropped on the floor.

This design fixes the schema gap and adds two server mutations + minimal
client UI.

---

## 2. Schema change

### New column

Add to `slides` table (`drizzle/schema.ts:154-174`):

```ts
sceneId: varchar("sceneId", { length: 64 }), // FK-by-string to consistencyContext.scenes[].id; nullable for legacy rows
```

Just one column. `VARCHAR(64)` mirrors the existing scene IDs which are
short like `"scene-1"`. Nullable to keep old slides loadable without a
backfill script being mandatory.

Add an index:

```ts
sceneIdIdx: index("slides_scene_id_idx").on(t.sceneId),
```

This index is small and helps any future "all slides in scene X" query.

### Migration SQL

A new file `drizzle/0007_scene_id_on_slides.sql`:

```sql
ALTER TABLE `slides`
  ADD COLUMN `sceneId` VARCHAR(64);
CREATE INDEX `slides_scene_id_idx` ON `slides` (`sceneId`);
```

`drizzle-kit generate` will produce that automatically; the manual SQL
above is what we expect to see.

### Backfill

A one-off backfill for existing rows. Two ways:

**Option 1 — Pure SQL (impossible cleanly, scenes live in JSON).**
Skip.

**Option 2 — Node script `scripts/backfill-slide-scene-id.ts`.** Algorithm:

```pseudo
for each story:
  ctx = normalizeConsistencyContext(story.consistencyContext)
  if ctx == null: continue
  for each slide in story.slides:
    if slide.sceneId != null: continue (idempotent)
    scene = ctx.scenes.find(s =>
      slide.slideNumber >= s.slideRange[0] &&
      slide.slideNumber <= s.slideRange[1]
    )
    if scene: UPDATE slides SET sceneId = scene.id WHERE id = slide.id
```

This re-uses `findSceneForSlide()` which already exists in
`server/storyService.ts:63-72`.

The script is safe to run multiple times. We also call the same
algorithm in `stories.generate` (newly written slides get `sceneId` set
at insert time, see §3).

### Type changes

`SlideContent.sceneId` becomes required-when-known. Drizzle's inferred
`Slide` type already nullable-strings the new column.

---

## 3. Server mutations

Two new mutations, plus one write-path change to `stories.generate`.

### 3a. `slides.assignScene`

Lives in a new `slidesRouter`, exported from `server/routers.ts` along
the existing four routers.

```ts
slides.assignScene: publicProcedure
  .input(
    z.object({
      slideId: z.number().int().positive(),
      sceneId: z.string().min(1),
    })
  )
  .mutation(async ({ input }) => {
    // 1. Load slide, verify it exists.
    // 2. Load story, verify ctx.scenes contains this sceneId.
    // 3. UPDATE slides SET sceneId = ?, updatedAt = NOW() WHERE id = ?
    // 4. Mark slide as "scene-changed" — see §5 (no auto-regen).
    //    For MVP: just write a flag column or rely on `qcReport` going
    //    stale. Simpler: leave it to the UI to show a "Regenerate to
    //    apply" CTA based on `slide.sceneId !== oldSceneId`.
    // 5. (Optional) recompute and persist `Scene.slideRange` per §6.
    return { ok: true };
  });
```

Notes:

- We do **not** auto-regenerate. See §5.
- We do **not** modify `consistencyContext` JSON in this mutation. Scene
  ranges become derived (§6).
- The mutation is per-slide, not bulk; the client can call it in a
  loop if needed.

### 3b. `stories.updateScene`

```ts
stories.updateScene: publicProcedure
  .input(
    z.object({
      storyId: z.number().int().positive(),
      sceneId: z.string().min(1),
      patch: z.object({
        environment: z.string().optional(),
        environmentLockNotes: z.string().optional(),
        transitionToNext: z.string().nullish(),
        environmentRefAssetId: z.number().int().nullish(),
      }),
    })
  )
  .mutation(async ({ input }) => {
    // 1. Load story, normalizeConsistencyContext()
    // 2. Find scene by id; merge patch (only the provided fields).
    // 3. Write modified consistencyContext back.
    // 4. Do NOT touch slides; the slides reference scenes by id, and
    //    edits don't change which slides belong to which scene.
    return { ok: true };
  });
```

This edits the JSON document in place. Single source of truth for
scene metadata stays in `stories.consistencyContext`.

### 3c. Write-path change in `stories.generate`

Today (`routers.ts:446-454`):

```ts
for (const slide of slides) {
  await updateSlideByStoryAndNumber(storyId, slide.slideNumber, {
    textContent: slide.textContent,
    caption: slide.caption,
    charactersInSlide: slide.charactersInSlide,
    imagePrompt: slide.imagePrompt,
    status: "pending",
  });
}
```

Add a `sceneId` lookup at write-time. The planner (`storyPlanner.ts`)
already knows which scene each slide belongs to via `Scene.slideRange`,
or `SlideContent.sceneId` if it's already populated. Either:

- **Cheap path**: compute `findSceneForSlide(ctx, slideNumber).id` and
  write that. Always correct because the planner-built ranges still
  describe the initial assignment exactly.
- **Cleaner path**: have the planner emit `sceneId` on each
  `SlideContent` and write it through.

Either works. The cheap path requires no planner changes.

---

## 4. Client UI

### 4a. Scene pill on each slide card (in `StoryDetail`)

Modify the active-slide block (`StoryDetail.tsx:236-310`). The current
header is:

```tsx
<h3>Slide {slideNumber} / {slides.length}</h3>
```

Becomes:

```
Slide 4 / 7   ◇ Scene 2 ▾   Chars: Papa, Sohn
```

Where `◇ Scene 2 ▾` is a clickable pill that opens a scene-picker
popover. Same change on each thumbnail in the rail
(`StoryDetail.tsx:317-349`):

```
[thumb]  Slide 3
         Fertig · ◇ Scene 2
```

### 4b. Scene picker (popover from the pill)

```
┌─────────────────────────────────────┐
│ Slide 4 zuordnen zu …               │
├─────────────────────────────────────┤
│ ○ Scene 1  Küche, hell    [3 slides]│
│ ● Scene 2  Auto, dunkel   [2 slides]│ ← currently
│ ○ Scene 3  Bett, ruhig    [2 slides]│
└─────────────────────────────────────┘
[Cancel]                  [Speichern]
```

The Save click → `slides.assignScene` mutation. On success: invalidate
the story query; show a "Regenerate to apply" CTA on the slide (because
the imagePrompt was generated against the *old* scene's environment
and lock).

### 4c. Scene-edit modal

Triggered from a small "edit pencil" next to each scene title in a
new "Scenes" panel within `StoryDetail`'s consistency-context block
(`:189-229`). The current consistency block flattens scenes into a
single `environment` string (`:127`); replace with a per-scene list:

```
Konsistenz-Kontext  ▾
 art style: …        palette: …
 ─────────────────────────────────
 Scene 1  Küche, hell                          [✎]
   Lock:  weiße Schränke, gleiches Fenster
   3 slides · 1, 2, 3
 Scene 2  Auto, dunkel                         [✎]
   Lock:  selbe Sitzposition
   2 slides · 4, 5
 Scene 3  Bett, ruhig                          [✎]
   Lock:  selbe Bettwäsche
   2 slides · 6, 7
```

Click `[✎]` → modal:

```
┌─────────────────────────────────────────────────┐
│ Scene 2 bearbeiten                              │
├─────────────────────────────────────────────────┤
│ Environment                                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ Auto, dunkel                                │ │
│ └─────────────────────────────────────────────┘ │
│ Lock-Notes                                      │
│ ┌─────────────────────────────────────────────┐ │
│ │ selbe Sitzposition                          │ │
│ └─────────────────────────────────────────────┘ │
│ Übergang zur nächsten Scene                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ Tür auf, Schritt aussteigen                 │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ⚠ Slides mit dieser Scene werden als            │
│   "Regenerate empfohlen" markiert.               │
│                                                 │
│              [Cancel]   [Speichern]             │
└─────────────────────────────────────────────────┘
```

Save → `stories.updateScene`.

### 4d. "Scene changed — regenerate to apply" CTA

When a slide's `sceneId` is moved or its scene's environment edited, the
slide's `imagePrompt` no longer reflects the truth in
`consistencyContext`. Add a passive yellow strip on the slide:

```
┌────────────────────────────────────────────┐
│ ⚠ Scene changed — regenerate to apply      │
│ Old prompt referenced "Auto" — now "Bett". │
│ [Regenerate slide]                         │
└────────────────────────────────────────────┘
```

This is implemented client-side: keep a `sceneAssignedAt` timestamp on
the slide (or just compare `slide.updatedAt` to `slide.imageGeneratedAt`
which we'd need to add). For MVP simpler: introduce a single boolean
column on `slides`:

```ts
needsRegen: boolean("needsRegen").notNull().default(false),
```

Both `assignScene` and `updateScene` (for affected slides) set it to
`true`. `regenerateSlide` resets to `false`. UI reads that one bit.

This `needsRegen` flag is also useful beyond scenes — could be set when
the user edits the prompt directly (see UX critique top-5 #1). One
small column, lots of leverage.

---

## 5. Re-generation interaction

When `slides.assignScene` or `stories.updateScene` is called, do we
auto-regenerate the affected slide(s)?

**Recommendation: NO. Flag-only.**

Reasons:

- Auto-regen is expensive ($0.05–$0.15 per slide on Atlas). One scene
  move would silently spend money.
- The user might be doing several edits in sequence (move slide,
  change scene env, then move another slide) — auto-regen each step
  burns $0.30+ for what should cost $0.05.
- The slide's `imagePrompt` was written by Claude in the
  `writeStorySlides` step against the *old* scene; truly applying the
  new scene also requires regenerating the *prompt*, not just the image.
  We don't want to silently call Claude either.

Instead:

1. The mutation flips `slides.needsRegen = true` for the affected
   slide(s).
2. UI shows a yellow strip with "Regenerate to apply" CTA.
3. User clicks → calls `regenerateSlide` (existing mutation,
   `routers.ts:596-656`).

Future enhancement (Phase 2): a "regenerate-prompt-and-image" path that
re-asks Claude for a new `imagePrompt` reflecting the new scene before
generating. Out of scope for MVP.

---

## 6. Constraint enforcement: `Scene.slideRange`

Today `Scene.slideRange = [number, number]` is a contiguous inclusive
range. With per-slide `sceneId` it becomes possible to have:

- Slides 1, 2, 4 in Scene 1 (non-contiguous).
- Slide 3 in Scene 2.
- Slide 5 in Scene 3.

This breaks the contiguity invariant.

**Recommendation: derive `Scene.slideRange` from per-slide
assignments. Per-slide `sceneId` is the new source of truth.**

Two implementations:

### 6a. On the read path (cheap, fully derived)

When the client reads a story (`stories.get` —
`routers.ts:263-270`), the server (or a helper) computes:

```ts
function deriveSceneRanges(scenes: Scene[], slides: Slide[]): Scene[] {
  return scenes.map((s) => {
    const numbers = slides
      .filter((sl) => sl.sceneId === s.id)
      .map((sl) => sl.slideNumber)
      .sort((a, b) => a - b);
    if (numbers.length === 0) {
      return { ...s, slideRange: [0, 0] }; // empty scene
    }
    return { ...s, slideRange: [numbers[0], numbers[numbers.length - 1]] };
  });
}
```

This produces `slideRange` that may not be contiguous, but the *ends*
are correct. Anywhere we currently use `slideRange` to mean
"slides-in-this-scene" we instead use `slides.filter(sl => sl.sceneId === scene.id)`.

### 6b. On write paths

`stories.generate` continues to write contiguous ranges (planner
output). `stories.updateScene` does **not** modify `slideRange`.
`slides.assignScene` does **not** modify `slideRange`. Ranges become
read-derived caches.

We keep `Scene.slideRange` in the JSON for backcompat reads, but the
read adapter (`normalizeConsistencyContext` in
`server/storyService.ts:19-60`) refreshes it from the slides list when
slides are loaded together with the story.

### Empty / orphaned scenes

If the user moves all slides out of a scene, that scene becomes empty
(`slideRange: [0, 0]`). Decide:

- (a) Delete empty scenes automatically (lossy — user can't go back).
- (b) Keep them and show a "Scene 2 — unbenutzt, [delete]?" UI hint.

**Recommendation: (b).** Empty scenes are a workflow signal, not a
bug. Users mid-edit may have temporarily empty scenes.

### Scenes referenced but not in `consistencyContext.scenes`

If a slide's `sceneId` references a scene that no longer exists (e.g. a
backfill bug, a hand-edited DB), treat it as null and surface an "Slide
ohne Scene" warning UI-side. The DB is not enforcing FK by string;
this needs to be defensive.

---

## 7. Phasing

### MVP (Phase 1)

Just enough to unstick the user.

1. Migration: `slides.sceneId VARCHAR(64)` + index.
2. Backfill script for existing rows.
3. Write-path change in `stories.generate` to populate `sceneId` on
   new slides.
4. `slides.assignScene` mutation (no `needsRegen` column for MVP — UI
   shows the CTA on every "scene changed" client-side, set on a local
   `recentlyMoved` timestamp).
5. UI: scene-pill on the active slide + scene-picker popover.
6. UI: derived "Slides per scene" display in the consistency-context
   block (read-only).

Explicitly out of MVP: scene env editing, `needsRegen` column,
`stories.updateScene`. The MVP gives "I can move a slide between
scenes" which is the most-asked-for piece.

### Full (Phase 2)

7. `needsRegen` column + flag setting in mutations.
8. `stories.updateScene` mutation.
9. Scene-edit modal in UI (env / lock / transition).
10. "Slide ohne Scene" defensive UI.
11. Empty-scene cleanup hint.

### Future (Phase 3)

12. "Regenerate prompt + image" path (Claude rewrite of the slide's
    `imagePrompt` after a scene change).
13. Drag-and-drop slides between scenes in the rail (instead of the
    popover).
14. Scene reordering (currently scenes have implicit order via creation;
    if user wants Scene 3 to come before Scene 2, no path).

---

## 8. Open questions for user

1. **Slide → multiple scenes?** Currently a slide is in exactly one
   scene. Any case where a slide should belong to two? (I'd say no.)
2. **MVP scope confirmation.** Just slide-reassignment + the necessary
   schema, no scene-edit modal yet?
3. **`needsRegen` column or no column?** Storing the bit in DB
   persists the "Regenerate to apply" hint across reloads. The
   alternative is keeping it in client state, which loses the cue when
   the user navigates away. I lean DB column even for MVP — one bool,
   no real complexity.
4. **What happens to `consistencyContext.scenes[].slideRange` in
   storage** after slides are reassigned? Three options:
   - (a) leave it stale, treat as advisory (current proposal),
   - (b) recompute on every mutation and write back,
   - (c) deprecate the field entirely (forced major migration).
   I recommend (a) for MVP, (b) for Phase 2.
5. **Empty scenes UX.** Show "0 slides — delete?" or hide the empty
   scene from the panel?
6. **Scene reordering needed?** Some users may want it; planner
   currently always produces sequential scenes 1..N. If yes, add an
   `order INT` column on a future scenes table (which doesn't exist
   yet — scenes live in JSON).
7. **Backfill scope.** Run the backfill script automatically at app
   boot (idempotent, safe), or as an explicit `pnpm run
   backfill:slide-scene-ids`? I lean explicit one-time CLI.
8. **`slide.sceneId` enum vs free string.** Free-string keeps the door
   open for future multi-story scene libraries; enum doesn't really
   make sense because the values are per-story. Keep free string.
