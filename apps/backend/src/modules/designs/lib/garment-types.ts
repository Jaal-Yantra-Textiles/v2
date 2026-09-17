/**
 * The garment vocabulary a design may be CLASSIFIED into.
 *
 * ## This does not make `product_type` an enum
 *
 * The stored field stays free text, for the reason `product-type.ts` gives: a
 * textile catalogue's vocabulary is always one word ahead of any migration. A
 * human may still type anything, and `manual` always outranks `inferred`.
 *
 * What this constrains is only the INFERRED path. A classifier that may answer
 * with any noun in the language is how "handwoven pashmina" becomes a stored
 * type — the old prompt had to say "name the garment, not the fabric, the
 * technique, or the collection" precisely because the model kept doing it. An
 * option list makes that answer unavailable rather than discouraged.
 *
 * ## Where this list came from
 *
 * Mined from the 155 live catalogue items that carry a description (the
 * `list_missing_hs_codes` sweep, prod, this session), counted by garment noun:
 *
 *   jacket 54 · shirt 46 · dress 23 · trousers 14 · top 14 · skirt 12
 *   set 10 · jumpsuit 8 · shawl 7 · vest 5 · shorts 3 · sweater 2 · robe 2
 *   blouse 2 · tunic 1 · saree 1
 *
 * plus the types the previous prompt already named (saree, kurta, palazzo,
 * dupatta, stole, scarf, cushion_cover, table_runner) and `stole`, which 31
 * designs already carry.
 *
 * 🔑 So it is the vocabulary the business actually sells, not a guess at one.
 * Adding a type is a one-line edit here; until then a design of a new kind
 * answers `none_of_these` and stays untyped, which is what the low-confidence
 * path already did.
 */

import type { OptionCriteria } from "../../../lib/ai/typesafe"

/** The answer that means "we do not know", and the only one that stores nothing. */
export const NO_GARMENT_MATCH = "none_of_these"

/**
 * PURE. Option key → criteria, exactly as System One wants them.
 *
 * Most options need no description: `jacket` classifies itself. The structured
 * `what` / `not_for` / `examples` form is used only where two options genuinely
 * compete, which is the docs' own guidance — description for the sake of it
 * spends tokens on every call and adds nothing.
 */
export const GARMENT_TYPE_CRITERIA: Record<string, OptionCriteria> = {
  // ---- upper body -------------------------------------------------------
  shirt: null,
  blouse: {
    what: "A woman's shirt-like top, often part of a set.",
    not_for: "A plain shirt; a saree blouse is still a blouse.",
  },
  top: {
    what: "An upper-body garment that is not specifically a shirt or blouse.",
    not_for: "Use shirt or blouse when the text names one.",
  },
  tunic: null,
  kurta: null,
  sweater: null,
  vest: null,
  jacket: null,
  coat: {
    what: "Outerwear longer and heavier than a jacket.",
    not_for: "A jacket — prefer jacket unless the text says coat.",
  },
  robe: null,

  // ---- lower body -------------------------------------------------------
  trousers: {
    what: "Full-length two-legged lower garment.",
    examples: ["trousers", "pants"],
  },
  shorts: null,
  palazzo: {
    what: "Wide-legged flowing trousers.",
    not_for: "Ordinary trousers.",
  },
  skirt: null,

  // ---- whole body -------------------------------------------------------
  dress: null,
  jumpsuit: null,
  saree: null,
  two_piece_set: {
    what: "A garment sold as a matched pair, e.g. a top and a skirt together.",
    not_for:
      "A single garment. Choose this only when the text describes the set itself as the product.",
    examples: ["two piece set", "co-ord set", "kurta set"],
  },

  // ---- draped / accessories --------------------------------------------
  stole: {
    what: "A long narrow wrap worn over the shoulders.",
    not_for: "A shawl is wider and heavier; a scarf is smaller.",
  },
  shawl: {
    what: "A wide draped wrap, heavier than a stole.",
    not_for: "A stole, which is narrower.",
  },
  scarf: {
    what: "A small neck wrap.",
    not_for: "A stole or shawl, which are larger.",
  },
  dupatta: null,

  // ---- home ------------------------------------------------------------
  cushion_cover: null,
  table_runner: null,

  /**
   * 🔴 Not optional. The docs require a no-match outcome whenever the list may
   * be incomplete, and this one certainly is — but the real reason is that
   * without it the model must pick SOMETHING, which is the exact failure the
   * old free-text prompt had: "a model asked to name a garment always names
   * one".
   */
  [NO_GARMENT_MATCH]: {
    what:
      "The text does not say what garment is being made — it describes fabric, " +
      "motif, technique or a collection only — or names a garment absent from this list.",
    examples: [
      "handwoven pashmina in indigo",
      "Spring 2026 heritage collection",
      "block-printed cotton yardage",
    ],
  },
}

/** PURE. Every option key, no-match included. Exported for tests. */
export const GARMENT_TYPES = Object.keys(GARMENT_TYPE_CRITERIA)

/** PURE. Is this a garment we classify into, rather than the no-match answer? */
export function isGarmentType(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim()
  if (!v || v === NO_GARMENT_MATCH) return false
  /**
   * ⚠️ `hasOwnProperty`, not `in`. `"constructor" in GARMENT_TYPE_CRITERIA` is
   * TRUE — `in` walks the prototype chain — so `in` would accept "constructor",
   * "toString" and "__proto__" as garments. This function is the check that
   * decides whether an answer is stored.
   */
  return Object.prototype.hasOwnProperty.call(GARMENT_TYPE_CRITERIA, v)
}

/**
 * PURE. The instructions for the classification.
 *
 * Kept short because the judgment is atomic — the docs' guidance is that
 * instructions carry the question and `criteria` carry what each answer means,
 * rather than one dense paragraph doing both.
 */
export const GARMENT_TYPE_INSTRUCTIONS =
  "Which garment is this textile design for? Classify from the design's own " +
  "words. Name the garment itself, never the fabric, the weave technique, the " +
  "dye, or the collection it belongs to."

/**
 * PURE. The state the question is asked against.
 *
 * Named JSON fields rather than one concatenated blob: the docs are explicit
 * that structure removes ambiguity, and it also means an empty description is
 * visibly absent instead of silently blending into the name.
 */
export function buildGarmentState(design: {
  name?: unknown
  description?: unknown
  tags?: unknown
  designer_notes?: unknown
}): Record<string, unknown> {
  const text = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined

  const tags = Array.isArray(design?.tags)
    ? design.tags.map(String).filter(Boolean)
    : []

  return {
    design: {
      name: text(design?.name),
      description: text(design?.description),
      tags: tags.length ? tags : undefined,
      designer_notes: text(design?.designer_notes),
    },
  }
}
