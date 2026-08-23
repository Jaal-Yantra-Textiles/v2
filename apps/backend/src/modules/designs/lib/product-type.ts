/**
 * Normalising a design's garment type (#938).
 *
 * The type is free text because a textile catalogue's vocabulary is always one
 * word ahead of any enum a migration could hold. Free text only stays
 * comparable if it is normalised on the way in — otherwise "Kurta", "kurta "
 * and "Kurta Set" are three types to every query that groups by it, and the
 * production spec keyed on the type quietly stops matching.
 */

/** Longest type we will store. Guards a model returning a sentence. */
export const MAX_PRODUCT_TYPE_LENGTH = 60

/**
 * PURE. Lowercase, collapse whitespace, and join words with underscores.
 *
 * Returns null for anything that is not a usable type — empty, whitespace, or
 * longer than a garment name plausibly is. Null means "we do not know", which
 * is a true statement; a truncated guess is not.
 */
export function normalizeProductType(value: unknown): string | null {
  if (typeof value !== "string") return null

  const cleaned = value
    .trim()
    .toLowerCase()
    // Keep letters, digits and separators; a garment name needs nothing else,
    // and punctuation is how a model's prose leaks into a key.
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")

  if (!cleaned) return null
  if (cleaned.length > MAX_PRODUCT_TYPE_LENGTH) return null

  return cleaned
}

/**
 * PURE. May we overwrite the stored type with an inferred one?
 *
 * 🔴 A human's correction outranks the model, always. Re-inferring over a typed
 * value is how a designer fixes "trousers" to "palazzo" on Monday and finds it
 * back to "trousers" on Tuesday — with the production spec, and therefore the
 * cost, having moved underneath them and nothing in the record saying why.
 *
 * `force` exists for an explicit "re-infer this" action, where the human is the
 * one asking. That is a person choosing, not a model overruling one.
 */
export function mayInferOver(
  currentSource: string | null | undefined,
  force = false
): boolean {
  if (force) return true
  return currentSource !== "manual"
}
