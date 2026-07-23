/**
 * #1113 — read Concept & Identity edits back out of the moodboard canvas so they
 * round-trip to the design's brief columns. Mirrors the partner editor's parser
 * (apps/partner-ui/.../design-moodboard.tsx); the two apps are separate bundles
 * so the small pure logic is duplicated rather than shared.
 */

// Placeholder copy the generator writes when the concept card is empty — never
// persist it back as a real value.
const CONCEPT_PLACEHOLDER = "Set the overarching story or inspiration.";

// Must match KEYWORDS_LINE_LABEL in build-moodboard-scene.ts.
const KEYWORDS_LINE_LABEL = "Aesthetic keywords:";

export type MoodboardBriefUpdate = {
  concept_theme?: string;
  aesthetic_keywords?: string[];
};

const readConceptTheme = (elements: readonly any[]): string | null => {
  const rect = elements.find(
    (el) =>
      !el.isDeleted &&
      el.type === "rectangle" &&
      el.customData?.kind === "brief-field" &&
      el.customData?.field === "concept_theme",
  );
  if (!rect) return null;
  const rx = rect.x;
  const ry = rect.y;
  const rw = rect.width ?? 0;
  const rh = rect.height ?? 0;
  const body = elements
    .filter(
      (el) =>
        !el.isDeleted &&
        el.type === "text" &&
        typeof el.text === "string" &&
        el.x >= rx - 4 &&
        el.x <= rx + rw &&
        el.y > ry + 30 &&
        el.y < ry + rh,
    )
    .sort((a, b) => b.y - a.y)[0];
  if (!body) return null;
  const value = String(body.text).trim();
  if (!value || value === CONCEPT_PLACEHOLDER) return null;
  return value;
};

const readAestheticKeywords = (elements: readonly any[]): string[] | null => {
  const line = elements.find(
    (el) =>
      !el.isDeleted &&
      el.type === "text" &&
      el.customData?.kind === "brief-field" &&
      el.customData?.field === "aesthetic_keywords",
  );
  if (!line || typeof line.text !== "string") return null;
  let raw = String(line.text);
  if (raw.startsWith(KEYWORDS_LINE_LABEL)) {
    raw = raw.slice(KEYWORDS_LINE_LABEL.length);
  }
  const kws = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  return kws.length ? kws : null;
};

/** Returns the round-trippable brief edits, or null when nothing is present. */
export const extractBriefEdits = (
  elements: readonly any[],
): MoodboardBriefUpdate | null => {
  const edits: MoodboardBriefUpdate = {};
  const concept = readConceptTheme(elements);
  if (concept != null) edits.concept_theme = concept;
  const keywords = readAestheticKeywords(elements);
  if (keywords != null) edits.aesthetic_keywords = keywords;
  return Object.keys(edits).length ? edits : null;
};
