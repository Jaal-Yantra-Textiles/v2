/**
 * The platform's technique vocabulary (#2596).
 *
 * `CAPABILITY_ACTIONS` says what a partner does in broad strokes ("print").
 * A technique is the finer word a buyer and a rate are about ("block print",
 * "screen print") — the unit a recipe step, a rate row and a search filter
 * share. It is code, not a table, for the same reason the action list is:
 * free text drifts ("blockprint", "block printing", "hand block") and a search
 * for one spelling silently misses the others. Extend the list; never stretch
 * an existing slug to cover something it isn't.
 *
 * `alternatives` are the "you could also try" suggestions shown beside a
 * buyer's choice. They are craft judgement, deliberately short, and in the
 * order we'd suggest them.
 *
 * No default prices live here. A price nobody entered is shown as "ask",
 * never invented (#2596).
 */
import type { CapabilityAction } from "./actions"

export type TechniqueDef = {
  slug: string
  label: string
  action: CapabilityAction
  /** Other spellings / regional names that mean this technique. Lower-case. */
  aliases: string[]
  /** Slugs to suggest instead, best first. */
  alternatives: string[]
  /** The unit a rate for this technique is usually quoted in. */
  default_unit: RateUnit
}

export const RATE_UNITS = [
  "piece",
  "metre",
  "sq_inch",
  "colour",
  "hour",
  "kg",
  "set",
] as const
export type RateUnit = (typeof RATE_UNITS)[number]

export const TECHNIQUES: TechniqueDef[] = [
  { slug: "hand_spinning", label: "Hand spinning", action: "spin", aliases: ["charkha", "hand spun", "handspun"], alternatives: [], default_unit: "kg" },
  { slug: "handloom_weaving", label: "Handloom weaving", action: "weave", aliases: ["handloom", "hand weaving", "handwoven", "hand woven", "pit loom", "frame loom", "jamdani", "tangaliya", "ikat", "kani", "kani twill"], alternatives: [], default_unit: "metre" },
  { slug: "powerloom_weaving", label: "Powerloom weaving", action: "weave", aliases: ["powerloom", "power loom", "mill woven"], alternatives: ["handloom_weaving"], default_unit: "metre" },
  { slug: "knitting", label: "Knitting", action: "knit", aliases: ["hand knitting", "machine knitting", "knit"], alternatives: [], default_unit: "piece" },
  { slug: "natural_dyeing", label: "Natural dyeing", action: "dye", aliases: ["natural dye", "vegetable dye", "plant dye", "indigo dyeing", "indigo"], alternatives: [], default_unit: "kg" },
  { slug: "chemical_dyeing", label: "Chemical dyeing", action: "dye", aliases: ["reactive dye", "azo free dye", "azo-free dye", "synthetic dye"], alternatives: ["natural_dyeing"], default_unit: "kg" },
  { slug: "tie_dye", label: "Tie-dye", action: "dye", aliases: ["tie and dye", "bandhani", "bandhej", "shibori", "leheriya"], alternatives: [], default_unit: "piece" },
  { slug: "block_print", label: "Block print", action: "print", aliases: ["hand block", "hand block print", "block printing", "block printed", "hand block printed", "blockprint", "ajrakh", "dabu", "bagru", "sanganeri"], alternatives: ["hand_painting", "screen_print"], default_unit: "metre" },
  { slug: "screen_print", label: "Screen print", action: "print", aliases: ["screen printing", "screen printed", "hand screen printing", "silk screen", "screenprint"], alternatives: ["hand_painting", "block_print", "digital_print"], default_unit: "piece" },
  { slug: "digital_print", label: "Digital print", action: "print", aliases: ["digital printing", "digitally printed", "dtg", "direct to garment", "sublimation", "inkjet print"], alternatives: ["hand_painting", "block_print", "screen_print"], default_unit: "piece" },
  { slug: "hand_painting", label: "Hand painting", action: "paint", aliases: ["hand painted", "hand-painted", "fabric painting", "kalamkari", "madhubani", "pichwai"], alternatives: ["block_print", "screen_print"], default_unit: "piece" },
  { slug: "hand_embroidery", label: "Hand embroidery", action: "embroider", aliases: ["embroidery", "aari", "sozni", "chikankari", "kantha", "zardozi", "phulkari", "kashida"], alternatives: ["machine_embroidery", "hand_painting"], default_unit: "piece" },
  { slug: "machine_embroidery", label: "Machine embroidery", action: "embroider", aliases: ["computer embroidery", "machine embroidered"], alternatives: ["hand_embroidery"], default_unit: "piece" },
  { slug: "stitching", label: "Stitching", action: "stitch", aliases: ["tailoring", "cut and sew", "cut-and-sew", "garment making", "sewing", "stitch"], alternatives: [], default_unit: "piece" },
  { slug: "finishing", label: "Finishing", action: "finish", aliases: ["washing", "pressing", "fringing", "edging", "hemming"], alternatives: [], default_unit: "piece" },
  { slug: "pattern_making", label: "Pattern making", action: "design", aliases: ["pattern", "grading", "sampling"], alternatives: [], default_unit: "piece" },
]

const BY_SLUG = new Map(TECHNIQUES.map((t) => [t.slug, t]))

export const TECHNIQUE_SLUGS = TECHNIQUES.map((t) => t.slug) as [string, ...string[]]

export const getTechnique = (slug: string | null | undefined) =>
  slug ? BY_SLUG.get(slug) ?? null : null

const clean = (s: string) =>
  s.toLowerCase().replace(/[_\-–]+/g, " ").replace(/\s+/g, " ").trim()

/**
 * Map free text ("Hand block printing", "AARI work") onto a slug, or null.
 *
 * Exact slug / label / alias first, then the longest alias found inside the
 * text. Null rather than a guess: a wrong technique answers a search it
 * should not, a missing one only shows as "not classified".
 */
export const normalizeTechnique = (input: unknown): string | null => {
  if (typeof input !== "string" || !input.trim()) return null
  const text = clean(input)

  for (const t of TECHNIQUES) {
    if (text === clean(t.slug) || text === clean(t.label)) return t.slug
    if (t.aliases.some((a) => clean(a) === text)) return t.slug
  }

  let best: { slug: string; len: number } | null = null
  for (const t of TECHNIQUES) {
    for (const word of [t.label, ...t.aliases]) {
      const w = clean(word)
      // Whole-word containment only: "print" must not match inside "blueprint".
      if (w.length >= 4 && new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text)) {
        if (!best || w.length > best.len) best = { slug: t.slug, len: w.length }
      }
    }
  }
  return best?.slug ?? null
}

/**
 * The slug a SAMPLE is searched by: its technique, but only when the partner
 * actually did that kind of work on it (#2606).
 *
 * A sample's free-text technique can describe the CLOTH rather than the
 * partner's work. Prince Tailors' "Tangaliya cotton skirt" (actions: stitch)
 * mapped to handloom_weaving and they surfaced as a weaver. When the sample
 * says what the partner did and that contradicts the technique's action, the
 * slug is null — the words stay in `technique` and `q` still finds them.
 * No actions recorded = no contradiction; the technique stands.
 */
export const sampleTechniqueSlug = (
  technique: unknown,
  actions: unknown
): string | null => {
  const slug = normalizeTechnique(technique)
  if (!slug) return null
  const did = Array.isArray(actions)
    ? actions.filter((a): a is string => typeof a === "string").map((a) => a.toLowerCase())
    : []
  if (!did.length) return slug
  return did.includes(getTechnique(slug)!.action) ? slug : null
}
