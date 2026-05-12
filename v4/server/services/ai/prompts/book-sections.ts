import type { SectionKind } from "../../../../shared/types/enums";

/**
 * Per-section-kind visual guidance, injected into the write-prompt for any
 * book page where the user hasn't supplied a hand-tuned image_prompts.json
 * entry. Strings are deliberately short — the chapter context + character
 * cast + style guide are added on top at split time.
 */
export const SECTION_VISUAL_GUIDE: Record<SectionKind, string> = {
  cover:
    "Full-bleed book cover. Title displayed prominently. Both protagonists centered, hero subject of the issue (e.g. solar system overview) behind them. No body text, no page furniture.",
  toc:
    "Table-of-contents layout: vertical list of chapter titles with decorative dividers and small spot illustrations per entry. Hand-lettered numerals if possible.",
  chapter_opener:
    "Large chapter title plus the chapter's hero subject as a single dominant illustration. Scrapbook framing.",
  recap:
    "Flashback layout — protagonists looking back. Small cloud-frames containing miniatures of the previous chapter's hero subject. Soft 'thinking back' mood.",
  image_anchor:
    "Single hero illustration that anchors the chapter's main visual claim. Concrete scene, not abstract.",
  body:
    "Clear illustrated main scene supporting the body text. No text overlay; the page text sits beside the illustration.",
  denkfalle:
    "Comic-style misconception panel. Speech bubble with the wrong assumption, character holding a thought bubble or lightbulb doodle. Wrong-vs-right contrast layout.",
  quiz:
    "Three speech bubbles labeled a / b / c each containing one answer option. Both protagonists pondering, finger-on-chin, curious eyes. Playful question-mark doodles.",
  experiment:
    "Lab or kitchen scene with the protagonists. Visible materials laid out (jars, paper, a ball, etc.). Numbered step doodles around the edges.",
  glossary:
    "Icon grid: one small symbol per glossary term plus the term in hand-lettered type. Even spacing, decorative dividers.",
  endpage:
    "Friendly farewell from the protagonists, small preview of next issue's hero subject in the corner, subtle footer with title repeated.",
  custom:
    "Generic illustrated scene that matches the section text. Single hero subject, no text overlay.",
};
