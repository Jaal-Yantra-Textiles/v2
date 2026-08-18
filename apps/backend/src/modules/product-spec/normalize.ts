/**
 * Normalisers for partner-written spec values (#1342).
 *
 * Pure and separate from the workflow so they can be tested directly — these
 * are the two places where what a partner TYPES and what the database STORES
 * are allowed to differ, which is exactly the kind of rule that silently rots.
 */

/**
 * "#abc" → "#AABBCC". Shape is already validated at the route; this only makes
 * the stored form canonical, so two partners typing the same colour two ways
 * still produce one comparable value.
 */
export const normalizeHex = (hex?: string | null): string | null => {
  if (!hex) return null
  const raw = hex.trim().replace(/^#/, "")
  if (!raw) return null
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw
  return `#${full.toUpperCase()}`
}

/**
 * "Pallu type" → "pallu_type".
 *
 * Custom-field keys are meant to be matched ACROSS products ("show me
 * everything with a pallu spec"), which no human types consistently. The label
 * keeps whatever the partner actually wrote.
 */
export const normalizeKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
