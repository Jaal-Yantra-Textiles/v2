/**
 * What a partner can DO, as a fixed vocabulary.
 *
 * Fixed on purpose. Free text drifts — "hand weaving", "handloom" and
 * "weaving" are three strings for one capability, and a search for "who can
 * weave" then silently misses two of them. A scanner or a model maps what it
 * reads onto this list; anything it cannot map is dropped, not invented.
 *
 * Adding a value is cheap (it is a json array, not a DB enum), so extend the
 * list rather than stretching an existing word to cover something it isn't.
 */
export const CAPABILITY_ACTIONS = [
  "spin", // hand or charkha spinning of yarn
  "weave", // handloom / powerloom weaving of cloth
  "knit",
  "dye", // natural or chemical dyeing, incl. yarn dyeing
  "print", // block, screen or digital printing
  "embroider", // hand or machine embroidery (aari, sozni, chikankari…)
  "stitch", // cut-and-sew garment making, tailoring
  "finish", // washing, fringing, pressing, edging
  "design", // pattern, colourway or garment design
  "source", // buys and supplies material they do not make
] as const

export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number]

const ACTION_SET = new Set<string>(CAPABILITY_ACTIONS)

/**
 * Keep only known actions, lower-cased and de-duplicated, in vocabulary order.
 * An unknown word is DROPPED rather than coerced: a wrong action is worse than
 * a missing one, because it answers a search it should not.
 */
export const normalizeCapabilityActions = (
  input: unknown
): CapabilityAction[] => {
  if (!Array.isArray(input)) return []
  const seen = new Set(
    input
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => ACTION_SET.has(a))
  )
  return CAPABILITY_ACTIONS.filter((a) => seen.has(a))
}
