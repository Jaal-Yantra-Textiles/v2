/**
 * construction-techniques.ts — the ONE canonical catalog of construction
 * techniques (#1113 Feature B).
 *
 * Historically the technique list was triplicated (hand-synced) across:
 *   - the admin/partner construction-details route (Zod validation),
 *   - DETAIL_RENDERERS in build-moodboard-scene.ts (the editable glyphs),
 *   - the admin design-construction-section dropdown + presets.
 *
 * This module is the single source of truth. It is a PURE data module (no server
 * imports) so it is safe to import from API routes, the moodboard scene builder,
 * the admin bundle, AND to serialize verbatim to the partner-ui picker over the
 * `construction-techniques` endpoint. Everything downstream derives from it.
 */

/** A tunable parameter the renderer reads, with UI metadata for auto-fill inputs. */
export interface ConstructionParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

/** A ready-made detail — picking one auto-fills the whole form. */
export interface ConstructionPreset {
  value: string
  label: string
  detailLabel: string
  params?: Record<string, number>
  fabricRules?: string[]
  note?: string
}

/** Coarse grouping for the categorized picker. */
export type ConstructionFamily =
  | "Darts & Pleats"
  | "Gathers & Tucks"
  | "Seams & Topstitch"
  | "Panels & Yokes"
  | "Embellishment"

export interface ConstructionTechnique {
  slug: string
  label: string
  family: ConstructionFamily
  /** Where on the garment this typically applies — a hint for the picker. */
  garmentAreas: string[]
  /** Tunable params (empty = fixed geometry); each carries its own default. */
  params: ConstructionParamDef[]
  /** Sensible fabric/sewing rules pre-checked when the technique is chosen. */
  defaultFabricRules: string[]
  /** Named presets that fully auto-fill the form. */
  presets: ConstructionPreset[]
}

/** Ordered families for the picker's section headers. */
export const CONSTRUCTION_FAMILIES: ConstructionFamily[] = [
  "Darts & Pleats",
  "Gathers & Tucks",
  "Seams & Topstitch",
  "Panels & Yokes",
  "Embellishment",
]

export const CONSTRUCTION_TECHNIQUES: ConstructionTechnique[] = [
  {
    slug: "dart",
    label: "Dart",
    family: "Darts & Pleats",
    garmentAreas: ["Bust", "Waist", "Back"],
    params: [{ key: "intake", label: "Intake", min: 0.2, max: 1, step: 0.05, default: 0.6 }],
    defaultFabricRules: ["press toward centre front", "taper to nothing at apex"],
    presets: [
      {
        value: "waist-dart",
        label: "Waist dart",
        detailLabel: "Waist dart",
        params: { intake: 0.6 },
        fabricRules: ["press toward centre front", "taper to nothing at apex"],
        note: "Backstitch at waist seam, leave apex un-backstitched",
      },
      {
        value: "bust-dart",
        label: "Bust dart",
        detailLabel: "Bust dart",
        params: { intake: 0.5 },
        fabricRules: ["press downward", "end 2.5 cm short of apex"],
      },
    ],
  },
  {
    slug: "knife-pleat",
    label: "Knife pleat",
    family: "Darts & Pleats",
    garmentAreas: ["Skirt", "Sleeve"],
    params: [{ key: "count", label: "Pleat count", min: 2, max: 7, step: 1, default: 5 }],
    defaultFabricRules: ["all pleats face one direction", "press sharp"],
    presets: [
      {
        value: "knife-pleat-skirt",
        label: "Knife pleats (skirt)",
        detailLabel: "Knife pleats",
        params: { count: 6 },
        fabricRules: ["all pleats face one direction", "press sharp, edge-stitch top 8 cm"],
      },
    ],
  },
  {
    slug: "box-pleat",
    label: "Box pleat",
    family: "Darts & Pleats",
    garmentAreas: ["Skirt", "Centre front", "Back"],
    params: [],
    defaultFabricRules: ["centre on CF", "tack at waist"],
    presets: [
      {
        value: "box-pleat-center",
        label: "Centre box pleat",
        detailLabel: "Centre box pleat",
        params: { count: 1 },
        fabricRules: ["centre on CF", "tack at waist"],
      },
    ],
  },
  {
    slug: "gathers",
    label: "Gathers",
    family: "Gathers & Tucks",
    garmentAreas: ["Sleeve head", "Waist", "Neckline"],
    params: [{ key: "ratio", label: "Fullness ratio", min: 1, max: 3, step: 0.1, default: 1.6 }],
    defaultFabricRules: ["two rows of ease stitching", "distribute fullness evenly"],
    presets: [
      {
        value: "gathered-sleeve-head",
        label: "Gathered sleeve head",
        detailLabel: "Sleeve-head gathers",
        params: { ratio: 1.4 },
        fabricRules: ["two rows of ease stitching", "distribute fullness between notches"],
      },
      {
        value: "gathered-skirt-waist",
        label: "Gathered skirt waist",
        detailLabel: "Waist gathers",
        params: { ratio: 2 },
        fabricRules: ["gather evenly to waistband length"],
      },
    ],
  },
  {
    slug: "tucks",
    label: "Tucks",
    family: "Gathers & Tucks",
    garmentAreas: ["Bodice", "Cuff", "Yoke"],
    params: [{ key: "count", label: "Tuck count", min: 2, max: 6, step: 1, default: 4 }],
    defaultFabricRules: ["press to one side"],
    presets: [
      {
        value: "pin-tucks-bodice",
        label: "Pin tucks (bodice)",
        detailLabel: "Pin tucks",
        params: { count: 5 },
        fabricRules: ["6 mm spacing", "press to one side"],
      },
    ],
  },
  {
    slug: "topstitch",
    label: "Topstitch",
    family: "Seams & Topstitch",
    garmentAreas: ["Hem", "Edges", "Seams"],
    params: [{ key: "rows", label: "Stitch rows", min: 1, max: 3, step: 1, default: 2 }],
    defaultFabricRules: ["matching thread"],
    presets: [
      {
        value: "double-topstitch-hem",
        label: "Double topstitch hem",
        detailLabel: "Double topstitch",
        params: { rows: 2 },
        fabricRules: ["6 mm row spacing", "matching thread"],
      },
      {
        value: "edge-topstitch",
        label: "Edge topstitch",
        detailLabel: "Edge topstitch",
        params: { rows: 1 },
        fabricRules: ["1.5 mm from edge"],
      },
    ],
  },
  {
    slug: "yoke",
    label: "Yoke",
    family: "Panels & Yokes",
    garmentAreas: ["Back", "Shoulder"],
    params: [{ key: "drop", label: "Seam drop", min: 0.1, max: 1, step: 0.05, default: 0.4 }],
    defaultFabricRules: ["understitch yoke seam"],
    presets: [
      {
        value: "back-yoke",
        label: "Back yoke",
        detailLabel: "Back yoke",
        params: { drop: 0.4 },
        fabricRules: ["burrito method", "understitch yoke seam"],
      },
    ],
  },
  {
    slug: "embroidery",
    label: "Embroidery",
    family: "Embellishment",
    garmentAreas: ["Placement", "Panel"],
    params: [{ key: "motif", label: "Motif petals", min: 3, max: 8, step: 1, default: 6 }],
    defaultFabricRules: ["stabilise reverse before stitching"],
    presets: [
      {
        value: "chain-embroidery",
        label: "Chain-stitch embroidery",
        detailLabel: "Chain-stitch motif",
        params: { motif: 6 },
        fabricRules: ["stabilise reverse before stitching"],
      },
    ],
  },
]

/** Every valid technique slug — the Zod enum + renderer-key source of truth. */
export const SUPPORTED_TECHNIQUES = CONSTRUCTION_TECHNIQUES.map((t) => t.slug) as [
  string,
  ...string[]
]

const BY_SLUG: Record<string, ConstructionTechnique> = Object.fromEntries(
  CONSTRUCTION_TECHNIQUES.map((t) => [t.slug, t])
)

export function getTechnique(slug: string): ConstructionTechnique | undefined {
  return BY_SLUG[slug]
}

/** The auto-fill default params for a technique (from each param's `default`). */
export function defaultParamsFor(slug: string): Record<string, number> {
  const t = BY_SLUG[slug]
  if (!t) {
    return {}
  }
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]))
}

/** Readable default title, e.g. knife-pleat → "Knife pleat". */
export function techniqueLabel(slug: string): string {
  const t = BY_SLUG[slug]
  if (t) {
    return t.label
  }
  const spaced = slug.replace(/-/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
