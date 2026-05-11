# UX Critique — Imagen

Scope: `Home`, `Library`, `StoryGenerator`, `StoryDetail`, `Archive`.
Reviewer stance: opinionated. The product is a single-user power tool for
generating Instagram carousels. Optimize for speed-to-result and clarity at
the workflow's seams, not for delighting first-time visitors.

---

## 1. What works (concrete)

- **`StoryGenerator` Plan-then-Generate split.** Two-stage commit
  (`StoryGenerator.tsx:56-74` plan → `:78-114` generate) is the right call.
  User gets a cheap dry-run before paying for image gen. Keep it.
- **Slide-count slider with "Vorschlag: N" annotation**
  (`StoryGenerator.tsx:202-223`). Shows the AI's recommendation while
  letting the user override — exactly the right level of control.
- **Per-entity asset picker inline under the entity row**
  (`StoryGenerator.tsx:331-377`). Doesn't yank you to a modal, doesn't lose
  context. Category chips inside the picker work well.
- **Vision queue in `Library` upload dialog** (`Library.tsx:516-580`). Live
  status badges per file (`queued → Vision… → category 87% → matched
  Papa`) is a good progressive-disclosure pattern. The "Duplikat
  übersprungen" state (`:556-558`) is honest and saves a click.
- **Bulk-approve ≥80% confidence** (`Library.tsx:353-364`). Surfaces the
  pile without forcing one-at-a-time review. Threshold is sensible.
- **`StoryDetail` carousel + thumbnail rail with status icons**
  (`StoryDetail.tsx:312-350`). Reads the carousel like a real timeline.
  Per-slide regenerate button (`:250-260`) is exactly where it should be.
- **`Archive` row layout with hover-revealed icon actions**
  (`Archive.tsx:152-180`). Density without clutter. Duplicate + delete
  + open in one row.
- **Polling refetch on `StoryDetail`** (`StoryDetail.tsx:31-37`) — 3s while
  generating, off otherwise. Correct. Don't break it.

---

## 2. Pain points (specific)

### `Home.tsx`

- **Marketing-page chrome on a single-user tool.** Hero gradient + decorative
  blur circles (`Home.tsx:21-54`) take ~50 % of first viewport for a tool
  used 50× a week by one person. Skip it.
- **"Slides generiert" stat = `completedStories * 10`**
  (`Home.tsx:62`). Lies. With variable slide counts (3–10) it overcounts.
  Fix or drop.
- **Quickaccess cards duplicate the sidebar nav.** Three big cards
  (`Home.tsx:78-117`) repeat what `AppLayout`'s sidebar already shows.
- **Recent stories are a separate block from Archive** (`Home.tsx:120-158`).
  Why the duplication? Either Home == short Archive, or remove.

### `Library.tsx`

- **"All" tab is implicit and easy to miss.** `selectedCategory === "all"`
  is the default but `CATEGORIES = Object.keys(CATEGORY_LABELS)`
  (`Library.tsx:41`) — unclear which key is "all". Make tab explicit and
  sticky.
- **Category filter (chips), character filter (Select), reviewOnly
  (button) are three different control patterns** (`Library.tsx:303-365`)
  for the same job ("filter the grid"). User has to remember which axis
  uses which widget.
- **No way to shift-click select multiple assets.** Bulk-approve works on
  *all* needs_review ≥80% — there is no manual multi-select for delete /
  re-categorize. With 200+ assets this is the biggest scaling pain.
- **Edit dialog buries `visualDescription`.** It's the field that drives
  prompt quality (`Library.tsx:151,377` etc.) yet doesn't appear in the
  Edit dialog at all (`:649-722`). Only viewable in Preview, only editable
  via `assets.update` indirectly. That is an actual hole.
- **Thumbnail card hover-actions invisible on touch.** `:409-434` requires
  `:hover` to reveal Eye/Pencil/Trash. On iPad/touchpad workflows these
  controls don't exist.
- **`pendingReviewCount` button text "{N} ≥80% übernehmen"**
  (`:362`) — German + math symbol + percentage in 12pt. Reads as a glyph
  soup. Move the threshold into a tooltip.
- **`UPLOAD_HINTS` tightly hardcoded to one user's family**
  (`Library.tsx:43-60`). Acceptable for solo tool, but the labels
  ("Papa, Mama, Sohn") leak into the upload dialog forever. At minimum:
  generate from `characters` table on-the-fly.
- **746 lines for one page.** Edit-dialog, upload-dialog, preview-dialog,
  delete-confirm, grid, filters all in one file. Not a bug, but every
  change risks regressions across modals.

### `StoryGenerator.tsx`

- **Step header changes meaning when there's no plan.** "Step 2 —
  Einstellungen" appears before the user has planned (`:391`,
  `n={plan ? 3 : 2}`). The same heading is "Step 3" 30 seconds later. Use
  consistent step IDs (Plan / Generate are always 1 / 2 / 3) and
  disable / fade Step 3 instead of renumbering.
- **Theme change silently wipes the plan** (`:155-158`). One keystroke
  inside an existing theme to fix a typo → all entity overrides gone.
  At minimum, warn ("Plan wird verworfen?"); ideally diff the theme and
  only invalidate on substantive change.
- **Slide-count slider lives inside the Plan card; image-format lives in
  Step 3.** They're both "shape of the output" controls. Group them.
- **Image provider hardcoded to `gpt-image-2`** (`:107`). The DB schema
  supports `freepik` (`schema.ts:127`) and the server has a working
  Freepik path (`storyService.ts:450`). Either expose it or remove the
  enum. Dead UI options are worse than missing ones.
- **No visibility into which style references will flow.** Server picks
  *all* `stil-referenz` assets (`routers.ts:419-422`). User cannot
  preview, deselect, or even know how many will be passed. This is a
  major silent variable in the generation outcome.
- **No scene-environment preview.** Scene cards (`:237-268`) show text
  inputs only. No thumbnail of a scene's `environmentRefAssetId` even
  though the field exists in the schema (`Scene.environmentRefAssetId` —
  `shared/types.ts:34`).
- **Asset picker grid is 6 columns, fixed** (`:350`). On desktop the
  thumbnails get tiny. No size affordance, no search inside picker.

### `StoryDetail.tsx`

- **Headline lies about slide count.** `"Konsistenz-Kontext (für alle 10
  Slides gesperrt)"` (`:195`) is hardcoded "10" even when the story has
  3–9 slides. Use `ctx.slideCount`.
- **Export-zip button text says `(N/10)`** (`:177`). Same bug — slides
  is variable now.
- **Scenes are hidden from `StoryDetail` even though they drive the
  prompt.** The page shows `artStyle / colorPalette / environment` as
  three boxes (`:198-216`) but `ctx.scenes` is dropped on the floor.
  User cannot see "this slide belongs to Scene 2: Küche" anywhere.
- **No per-slide character chips.** `slide.charactersInSlide` is on the
  schema (`schema.ts:163`) but invisible in the UI. The user has to read
  the full image prompt (`:298-307`) to figure out who's in a slide.
- **Regenerate has no confirm and no diff.** User can lose a good image
  with one click (`:250-260`). At minimum: hover-preview the prompt;
  ideally an "edit prompt then regenerate" path.
- **No way to edit `imagePrompt` before regenerate.** User can see it
  (`:298-307`) but cannot tweak it. This is the single highest-leverage
  missing affordance.
- **Carousel main view: thumbnail rail is on the right at `lg:col-span-1`,
  pushing the actual slide to col-span-2** (`:232-310`). On 1280px
  viewports the slide image renders at `max-w-sm` (~24rem) — tiny for
  reviewing 1024×1024 generations. Use the full column.
- **No previous/next keyboard nav.** Common request: arrow keys to step
  through slides.

### `Archive.tsx`

- **Status icons inconsistent with `StoryDetail`'s status badges.**
  Archive defines its own `STATUS_CONFIG` (`Archive.tsx:31-37`) — same
  data exists in `@/const` (referenced by `StoryDetail.tsx:19`). Two
  sources of truth, two sets of strings.
- **Date format is German locale only** (`:73`). Fine for the user, but
  the model/format/provider chips next to it (`:144-149`) are English.
  Mix is jarring.
- **No filter by status.** Common workflow: "show me all stories with
  errors" — currently you must scroll.
- **No selection / bulk delete.**

### Cross-page

- **Three different status-config objects.** `Archive.tsx:31`,
  `StoryDetail.tsx:19` (imports `@/const`), and ad-hoc inline at
  `Home.tsx:140-145`. Pick one.
- **Toast error messages are mixed German / English.** `"Fehler: " +
  err.message` puts an English Error message into a German label.

---

## 3. IA recommendations (per page)

### Home

Cut the hero. Make it a dashboard:

```
┌─────────────────────────────────────────────────────────────┐
│ Imagen                                          [+ New Story]│
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌────────────────────────────────────────┐│
│ │ Recent (5)    │ │ Library                                ││
│ │ • Eltern-Burn │ │ 142 assets · 4 needs_review            ││
│ │ • Olaf Scholz │ │ ┌───┬───┬───┬───┐                      ││
│ │ • Familie…    │ │ │T1 │T2 │T3 │T4 │ recent uploads       ││
│ │ → Archive     │ │ └───┴───┴───┴───┘                      ││
│ └───────────────┘ │ → Open library                         ││
│                   └────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

Two columns, no hero, no fake stats. Skips the "first-run marketing"
mindset.

### Library

Move filters to a left rail; grid takes full main width. Add explicit
multi-select:

```
┌──────────────┬──────────────────────────────────────────────┐
│ FILTER       │ Library                          [+ Upload]   │
│ □ all (142)  ├──────────────────────────────────────────────┤
│ □ familie 23 │ [search ____] [chars ▾] [needs_review ⚠ 4]   │
│ □ histor. 12 ├──────────────────────────────────────────────┤
│ □ politik 8  │ ☑ ☐ ☐ ☐ ☐ ← row checkboxes                   │
│ ...          │ ┌───┬───┬───┬───┬───┐                        │
│              │ │ ☐ │ ☑ │ ☐ │ ⚠ │ ☐ │  thumbs               │
│ CHARACTERS   │ └───┴───┴───┴───┴───┘                        │
│ □ Papa (12)  │ Selected 1: [delete] [recategorize] [approve]│
│ □ Mama (8)   │                                              │
│ □ +new       │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

Move the Edit dialog to a side-drawer that doesn't cover the asset.
Add `visualDescription` as a primary editable field.

### StoryGenerator

Three permanent steps, always visible. Step 3 disabled until plan exists,
not renumbered:

```
┌───────────────────────────────────────────────────────────┐
│ Story Generator                                           │
├───────────────────────────────────────────────────────────┤
│ STEP 1  THEMA                              [Plan erstellen]│
│ ┌────────────────────────────────────────────────────────┐│
│ │ textarea…                                              ││
│ └────────────────────────────────────────────────────────┘│
├───────────────────────────────────────────────────────────┤
│ STEP 2  PLAN                                  (disabled)  │
│  ▸ wird aktiv nach „Plan erstellen"                       │
├───────────────────────────────────────────────────────────┤
│ STEP 3  EINSTELLUNGEN  + GENERATE              (disabled)  │
└───────────────────────────────────────────────────────────┘
```

Once planned, Step 2 expands and shows a single horizontal scene timeline,
with character chips below:

```
STEP 2  PLAN  „Eltern-Burnout"   reasoning:…   [edit slidecount: ─●── 7]
┌──────────────────────────────────────────────────────────┐
│ Scene 1 [1-3]  Scene 2 [4-5]   Scene 3 [6-7]             │
│ ┌─────────┐    ┌─────────┐     ┌─────────┐               │
│ │ Küche   │    │ Auto    │     │ Bett    │               │
│ │ env-ref?│    │ env-ref?│     │ env-ref?│               │
│ └─────────┘    └─────────┘     └─────────┘               │
├──────────────────────────────────────────────────────────┤
│ Characters: [Papa ✓Asset] [Mama ✓Asset] [Sohn ungematched]│
├──────────────────────────────────────────────────────────┤
│ Style refs (4) ▸  ┌─┐┌─┐┌─┐┌─┐  [manage]                 │
└──────────────────────────────────────────────────────────┘
```

This shows what is *actually going to flow into the prompt* (scenes,
characters, style refs) on one screen. Today none of those three things
share a sightline.

Move slide-count + image-format + provider into a single "Output" group
at the bottom of Step 1 or top of Step 3 — they all describe shape of
output, currently scattered across two cards.

### StoryDetail

Use full width for slide image; move thumbnails to a top strip
(carousel-native pattern):

```
┌───────────────────────────────────────────────────────────┐
│ ← Zurück | „Eltern-Burnout"            [Status: Fertig]   │
│                                  [Regenerate all] [Export] │
├───────────────────────────────────────────────────────────┤
│ Scene 1 (1-3)        Scene 2 (4-5)        Scene 3 (6-7)   │
│ [⊡][⊡][⊡]            [⊡][⊡]               [⊡][⊡]          │
│  ↑ active scene shown w/ underline                         │
├───────────────────────────────────────────────────────────┤
│                  ┌──────────────────────┐                  │
│                  │                      │                  │
│                  │   active slide       │                  │
│                  │   1024×1024          │                  │
│                  │                      │                  │
│                  └──────────────────────┘                  │
│  Slide 4 / 7 · Scene 2: Auto · Chars: Papa, Sohn          │
│  ─ Text: „und plötzlich…"                                 │
│  ─ Caption: …                                              │
│  [Download] [Edit prompt] [Regenerate]                     │
│                                                            │
│ ▾ Konsistenz-Kontext (artStyle / palette / scenes / chars) │
│ ▾ Image prompt                                             │
└───────────────────────────────────────────────────────────┘
```

Key changes:
- Thumbnails grouped by scene (visible structure, not flat list).
- Big slide gets full width.
- Per-slide metadata (scene + chars) is one line under the image, not
  buried in two separate places.
- Consistency context is collapsed by default — it's reference, not
  primary.

### Archive

Add status filter chips and a single-row layout:

```
┌─────────────────────────────────────────────────────────────┐
│ Archiv (32)                              [+ Neue Story]     │
│ [search…]   [all] [draft 4] [generating 1] [error 2] [done] │
├─────────────────────────────────────────────────────────────┤
│ ☐ Eltern-Burnout                  Fertig · 7 Slides · …    │
│ ☐ Olaf Scholz                     Error  · …               │
│   …                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Cross-page consistency

| Concern | Where | Fix |
|---|---|---|
| Status config defined in three places | `Archive:31`, `StoryDetail:19→@/const`, `Home:140-145` | Single source: `@/const`. Delete inline copies. |
| German + English mixed in the same row | `Archive:144-149` (de date + en provider strings) | Pick one. Either `Sonett 4.6` or commit to English chips. |
| Button placement varies | `+ New` is right-of-title in Library/Archive, but action button on `Home` is *inside* the hero | Top-right of every list view. |
| Status colors differ subtly | `bg-green-500/20` vs `bg-emerald-500/15` between files | Use design tokens, not hex/literal Tailwind. |
| Confirm patterns differ | `confirm()` browser dialog in `StoryDetail:183`, `<Dialog>` in `Library` and `Archive` | Always `<Dialog>`. Browser `confirm` is jarring. |
| Asset thumbnail sizes | 12×12, 10×10, aspect-square fixed-grid; no shared `<AssetThumb>` | Extract `<AssetThumb size="sm|md|lg">`. |
| "Slide" vs "Slides" pluralization in German | inconsistent | `useTranslation`-style helper or just commit to plural always. |
| Loading skeletons differ | `Archive` uses `h-24 rounded-xl bg-card animate-pulse`; `Library` uses `aspect-square rounded-xl bg-card` | Shared `<Skeleton kind="row|tile">`. |

---

## 5. Mobile / narrow-viewport

Current state:

- `StoryGenerator` is `max-w-3xl mx-auto` (`:139`) — already constrained,
  works on mobile.
- `StoryDetail` uses `lg:grid-cols-3` (`:232`); on `<lg` it stacks slide
  above thumbnails, which is fine.
- `Library` grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`
  (`:386`) is responsive but the **filter row** `flex flex-wrap` (`:304`)
  produces a vertical stack of three full-width controls on mobile —
  takes 30 % of viewport.
- `Archive` rows already responsive.
- **Hover-only actions are invisible on touch** — Library card overlay
  (`:409-434`), Archive row icons (`:152-180`). Both fail on iPad.

Recommendations:

1. **All hover-actions get a permanent-on-touch fallback.** Use
   `@media (hover:none)` to make them always visible at lower opacity, or
   use a sheet drawer on tap.
2. **Library filters: collapse into a single "Filter" button on mobile**
   that opens a bottom sheet. Saves screen.
3. **`StoryDetail` thumbnail rail: on mobile, switch from 2-column grid
   (`:317`) to a horizontal-scroll filmstrip.** More scannable.
4. **Asset picker grid in StoryGenerator (`:350`)**: 6 cols hardcoded —
   on a 375px viewport thumbs are 50px. Use
   `grid-cols-3 sm:grid-cols-5 md:grid-cols-6`.

---

## 6. Top 5 high-leverage UX changes (ranked)

| # | Change | Why | Effort |
|---|---|---|---|
| 1 | **Edit `imagePrompt` before regenerate.** In `StoryDetail`, make the prompt a textarea with "Save & Regenerate" button. | The single biggest gap between the user's mental model and what the tool can do. Today: bad image → regenerate (same prompt, dice roll) or delete story. After: bad image → edit one phrase → re-roll. Multiplies the value of every story by 5×. | M (server: add `slides.update` accepting `imagePrompt`; client: replace `<details>` with textarea + button) |
| 2 | **Show scenes + per-slide chars in `StoryDetail`.** Group thumbnails by scene; show "Scene 2: Auto · Papa, Sohn" under the active slide. | The user explicitly designed scenes in the planner — and then `StoryDetail` discards that structure. This breaks the mental contract. Also lets the user spot "Papa is missing from slide 4 even though he should be there." | S (read-only; data already in `consistencyContext.scenes` and `slide.charactersInSlide`) |
| 3 | **Permanent multi-select + bulk-delete in `Library`.** Checkbox per card; bulk action bar appears when ≥1 selected. | At ~150 assets the user is already at the pain point. Asset hygiene is a recurring task. | M (server: `assets.bulkDelete`; client: selection state + bar) |
| 4 | **Visualize style-refs in `StoryGenerator`.** Show the N stil-referenz assets that *will* flow, with an "exclude" toggle. | Right now the user cannot predict the output style — the server silently grabs *all* stil-referenz assets. This is the largest unobservable in the system. | S (server already has them; client: add a `styleReferences` panel in Step 3 with toggleable thumbs + persist `excludedAssetIds` on story.consistencyContext) |
| 5 | **Cut the `Home` hero, replace with dashboard.** Recent + Library-at-a-glance + needs_review pile. | The current Home is decoration that the user passes through 50× a week without absorbing anything. A dashboard turns that traffic into useful glanceable status. | S |

Honourable mentions (not in top 5):

- Keyboard nav on `StoryDetail` (← / →).
- Per-page typography pass — `font-display` is applied unevenly.
- A "Story → JSON export" for debugging consistency drift across slides.

---

## Appendix: file:line index

| Concern | File | Line(s) |
|---|---|---|
| Plan vs Generate split | StoryGenerator.tsx | 56-114 |
| Slide-count slider | StoryGenerator.tsx | 202-223 |
| Asset picker | StoryGenerator.tsx | 331-377 |
| Theme change wipes plan | StoryGenerator.tsx | 155-158 |
| Hardcoded `gpt-image-2` provider | StoryGenerator.tsx | 107 |
| Hardcoded "10 Slides" | StoryDetail.tsx | 195, 177 |
| Scenes dropped from UI | StoryDetail.tsx | 198-216 |
| Carousel layout | StoryDetail.tsx | 232-310 |
| Polling | StoryDetail.tsx | 31-37 |
| `confirm()` for delete | StoryDetail.tsx | 183 |
| `STATUS_CONFIG` duplicated | Archive.tsx | 31-37 |
| `STATUS_CONFIG` (canonical?) | StoryDetail.tsx | 19 |
| `STATUS_CONFIG` ad-hoc | Home.tsx | 140-145 |
| Hero block | Home.tsx | 21-54 |
| Fake "Slides generiert" stat | Home.tsx | 62 |
| Hardcoded `UPLOAD_HINTS` | Library.tsx | 43-60 |
| Three filter widgets | Library.tsx | 303-365 |
| Edit dialog | Library.tsx | 649-722 |
| Hover-only actions | Library.tsx | 409-434 |
