/**
 * weaving-techniques.ts — the canonical catalog of WEAVING techniques and their
 * tunable parameters, for partner-authored product specs (#1342).
 *
 * Deliberately mirrors `modules/designs/construction-techniques.ts`, which is
 * the same idea one level up the supply chain: that catalog describes how a
 * garment is SEWN, this one describes how the cloth is WOVEN. Keeping the two
 * shapes identical means the partner-ui picker is one component, not two.
 *
 * PURE data module — no server imports — so it is safe to import from API
 * routes, from workflow validation, and to serialize verbatim to the partner-ui
 * over the `spec-catalog` endpoint. Everything downstream derives from it.
 *
 * The parameter ranges are deliberately wide: they exist to catch a typo (a GSM
 * of 8000, a thread count of 0), not to tell a weaver what is possible. A spec
 * this catalog cannot express is captured as a free extra field instead — see
 * `ProductSpecField` — so an unlisted technique never blocks a partner.
 */

/** A tunable parameter, with the UI metadata a number input needs. */
export interface WeaveParamDef {
  key: string
  label: string
  /** Displayed after the input ("GSM", "cm", "ends/inch"). */
  unit: string
  min: number
  max: number
  step: number
  default: number
}

/** A ready-made spec — picking one auto-fills the whole form. */
export interface WeavePreset {
  value: string
  label: string
  detailLabel: string
  params?: Record<string, number>
  finishes?: string[]
  note?: string
}

/** Coarse grouping for the categorized picker. */
export type WeaveFamily =
  | "Plain & Twill"
  | "Pashmina & Shawl"
  | "Ikat & Resist"
  | "Extra-weft & Brocade"
  | "Jacquard & Dobby"

export interface WeaveTechnique {
  slug: string
  label: string
  family: WeaveFamily
  /** One line a partner can recognise their own cloth by. */
  description: string
  /** Tunable params (empty = nothing to tune); each carries its own default. */
  params: WeaveParamDef[]
  /** Finishing steps pre-checked when the technique is chosen. */
  defaultFinishes: string[]
  /** Named presets that fully auto-fill the form. */
  presets: WeavePreset[]
}

/** Ordered families for the picker's section headers. */
export const WEAVE_FAMILIES: WeaveFamily[] = [
  "Plain & Twill",
  "Pashmina & Shawl",
  "Ikat & Resist",
  "Extra-weft & Brocade",
  "Jacquard & Dobby",
]

/** Params shared by nearly every woven cloth, so they read the same everywhere. */
const GSM: WeaveParamDef = {
  key: "gsm",
  label: "Weight",
  unit: "GSM",
  min: 20,
  max: 900,
  step: 5,
  default: 120,
}
const ENDS: WeaveParamDef = {
  key: "ends_per_inch",
  label: "Ends (warp)",
  unit: "per inch",
  min: 10,
  max: 200,
  step: 1,
  default: 60,
}
const PICKS: WeaveParamDef = {
  key: "picks_per_inch",
  label: "Picks (weft)",
  unit: "per inch",
  min: 10,
  max: 200,
  step: 1,
  default: 60,
}
const WARP_COUNT: WeaveParamDef = {
  key: "warp_yarn_count",
  label: "Warp yarn count",
  unit: "Ne",
  min: 2,
  max: 200,
  step: 1,
  default: 40,
}
const WEFT_COUNT: WeaveParamDef = {
  key: "weft_yarn_count",
  label: "Weft yarn count",
  unit: "Ne",
  min: 2,
  max: 200,
  step: 1,
  default: 40,
}
const LOOM_WIDTH: WeaveParamDef = {
  key: "loom_width_cm",
  label: "Loom width",
  unit: "cm",
  min: 20,
  max: 300,
  step: 1,
  default: 91,
}

export const WEAVE_TECHNIQUES: WeaveTechnique[] = [
  {
    slug: "plain",
    label: "Plain weave",
    family: "Plain & Twill",
    description: "One over, one under — the simplest and most common structure.",
    params: [GSM, ENDS, PICKS, WARP_COUNT, WEFT_COUNT, LOOM_WIDTH],
    defaultFinishes: ["hand wash", "loom-state finish"],
    presets: [
      {
        value: "fine-plain",
        label: "Fine plain",
        detailLabel: "Fine plain weave",
        params: { gsm: 90, ends_per_inch: 80, picks_per_inch: 76 },
      },
      {
        value: "heavy-plain",
        label: "Heavy plain",
        detailLabel: "Heavy plain weave",
        params: { gsm: 220, ends_per_inch: 48, picks_per_inch: 44 },
      },
    ],
  },
  {
    slug: "twill",
    label: "Twill",
    family: "Plain & Twill",
    description: "Diagonal rib — drapes softer and resists creasing.",
    params: [
      GSM,
      ENDS,
      PICKS,
      WARP_COUNT,
      WEFT_COUNT,
      LOOM_WIDTH,
      {
        key: "twill_line_degrees",
        label: "Twill line",
        unit: "°",
        min: 15,
        max: 75,
        step: 5,
        default: 45,
      },
    ],
    defaultFinishes: ["hand wash", "press on reverse"],
    presets: [
      {
        value: "2-2-twill",
        label: "2/2 twill",
        detailLabel: "2/2 twill",
        params: { twill_line_degrees: 45, gsm: 200 },
      },
    ],
  },
  {
    slug: "pashmina-plain",
    label: "Pashmina (plain)",
    family: "Pashmina & Shawl",
    description:
      "Handspun cashmere on a handloom — the base cloth for a plain shawl.",
    params: [
      { ...GSM, min: 40, max: 400, default: 90 },
      ENDS,
      PICKS,
      { ...WARP_COUNT, label: "Warp count (pashmina)", default: 80 },
      { ...WEFT_COUNT, label: "Weft count (pashmina)", default: 80 },
      { ...LOOM_WIDTH, default: 100 },
    ],
    defaultFinishes: ["hand wash cold", "dry flat", "no wringing"],
    presets: [
      {
        value: "handspun-pashmina",
        label: "Handspun pashmina",
        detailLabel: "Handspun, handwoven pashmina",
        params: { gsm: 85, ends_per_inch: 72, picks_per_inch: 68 },
        finishes: ["hand wash cold", "dry flat"],
        note: "Handspun yarn varies by nature — small irregularities are the mark, not a fault.",
      },
      {
        value: "millspun-pashmina",
        label: "Millspun pashmina",
        detailLabel: "Millspun, handwoven pashmina",
        params: { gsm: 110, ends_per_inch: 80, picks_per_inch: 76 },
      },
    ],
  },
  {
    slug: "kani",
    label: "Kani",
    family: "Pashmina & Shawl",
    description:
      "Woven on wooden bobbins (kanis) to a coded pattern — measured in a few inches a day.",
    params: [
      { ...GSM, default: 130 },
      ENDS,
      PICKS,
      LOOM_WIDTH,
      {
        key: "bobbin_count",
        label: "Bobbins in play",
        unit: "kanis",
        min: 2,
        max: 200,
        step: 1,
        default: 40,
      },
    ],
    defaultFinishes: ["dry clean only"],
    presets: [],
  },
  {
    slug: "ikat",
    label: "Ikat",
    family: "Ikat & Resist",
    description:
      "Yarn resist-dyed BEFORE weaving, so the pattern carries its own soft edge.",
    params: [GSM, ENDS, PICKS, LOOM_WIDTH],
    defaultFinishes: ["hand wash separately", "first wash may bleed"],
    presets: [
      {
        value: "single-ikat",
        label: "Single ikat",
        detailLabel: "Single ikat (warp OR weft resisted)",
        note: "Only one yarn set is resist-dyed.",
      },
      {
        value: "double-ikat",
        label: "Double ikat",
        detailLabel: "Double ikat (warp AND weft resisted)",
        note: "Both yarn sets are resisted and must align on the loom.",
      },
    ],
  },
  {
    slug: "bandhani",
    label: "Bandhani",
    family: "Ikat & Resist",
    description: "Cloth tie-resisted in thousands of points, then dyed.",
    params: [
      GSM,
      {
        key: "knots_per_sq_inch",
        label: "Knot density",
        unit: "per sq inch",
        min: 1,
        max: 200,
        step: 1,
        default: 25,
      },
    ],
    defaultFinishes: ["do not soak", "hand wash cold"],
    presets: [],
  },
  {
    slug: "extra-weft",
    label: "Extra weft",
    family: "Extra-weft & Brocade",
    description:
      "A supplementary weft floats the motif above the ground cloth.",
    params: [GSM, ENDS, PICKS, LOOM_WIDTH],
    defaultFinishes: ["hand wash", "clip floats on reverse"],
    presets: [],
  },
  {
    slug: "brocade",
    label: "Brocade",
    family: "Extra-weft & Brocade",
    description: "Extra weft in metallic or contrast yarn, worked as a figure.",
    params: [
      { ...GSM, default: 200 },
      ENDS,
      PICKS,
      LOOM_WIDTH,
      {
        key: "zari_percent",
        label: "Zari content",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
        default: 15,
      },
    ],
    defaultFinishes: ["dry clean only", "store folded in muslin"],
    presets: [],
  },
  {
    slug: "jacquard",
    label: "Jacquard",
    family: "Jacquard & Dobby",
    description: "Every warp end controlled individually — unrestricted figuring.",
    params: [
      GSM,
      ENDS,
      PICKS,
      LOOM_WIDTH,
      {
        key: "hooks",
        label: "Hooks",
        unit: "count",
        min: 100,
        max: 10000,
        step: 100,
        default: 1200,
      },
    ],
    defaultFinishes: ["dry clean"],
    presets: [],
  },
  {
    slug: "dobby",
    label: "Dobby",
    family: "Jacquard & Dobby",
    description: "Small geometric figuring from a limited set of shafts.",
    params: [
      GSM,
      ENDS,
      PICKS,
      LOOM_WIDTH,
      {
        key: "shafts",
        label: "Shafts",
        unit: "count",
        min: 2,
        max: 32,
        step: 1,
        default: 8,
      },
    ],
    defaultFinishes: ["hand wash"],
    presets: [],
  },
]

/** Every technique slug, for enum validation. */
export const SUPPORTED_WEAVES = WEAVE_TECHNIQUES.map((t) => t.slug)

export function weaveTechnique(slug: string): WeaveTechnique | undefined {
  return WEAVE_TECHNIQUES.find((t) => t.slug === slug)
}

export function weaveLabel(slug: string): string {
  return weaveTechnique(slug)?.label ?? slug
}

/**
 * Check submitted params against the technique's own definitions.
 *
 * Returns the problems rather than throwing, so the caller decides whether an
 * out-of-range value is a 400 or a warning. An UNKNOWN key is a problem too: it
 * is almost always a renamed param or a typo, and silently keeping it would
 * leave a value in the spec that no UI will ever show again.
 */
export function validateWeaveParams(
  slug: string,
  params: Record<string, unknown> | null | undefined
): string[] {
  if (!params) return []
  const technique = weaveTechnique(slug)
  if (!technique) return [`Unknown weave technique "${slug}"`]

  const problems: string[] = []
  for (const [key, raw] of Object.entries(params)) {
    const def = technique.params.find((p) => p.key === key)
    if (!def) {
      problems.push(`"${key}" is not a parameter of ${technique.label}`)
      continue
    }
    const value = typeof raw === "number" ? raw : Number(raw)
    if (!Number.isFinite(value)) {
      problems.push(`${def.label} must be a number`)
      continue
    }
    if (value < def.min || value > def.max) {
      problems.push(
        `${def.label} must be between ${def.min} and ${def.max} ${def.unit}`
      )
    }
  }
  return problems
}
