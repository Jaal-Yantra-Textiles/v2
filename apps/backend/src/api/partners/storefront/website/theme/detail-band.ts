import { z } from "@medusajs/framework/zod"

/**
 * The product detail band (#1364) — the full-width region BELOW the gallery.
 *
 * Everything on a product page used to live in one three-column row, and the
 * only authorable "more detail" was `description_layout`, which chose a
 * container for two HARDCODED panels ("Product Information" and "Shipping &
 * Returns") inside a 300px sticky column. A partner could pick tabs or an
 * accordion; they could not add a panel, remove one, write one, or put anything
 * side by side. Between that row and Related Products the page was empty.
 *
 * The split that makes this authorable without making every product page a
 * bespoke build:
 *
 *   THE THEME decides the SHAPE — which blocks, in what order, arranged how.
 *   THE PRODUCT provides the SUBSTANCE — its own spec, its own maker, its own
 *   fields.
 *
 * So a partner arranges their product page once and every product follows it,
 * while each product still says something true about itself. A block whose
 * product has nothing to show renders NOTHING — not an empty card with a
 * heading, which would advertise detail the partner never provided (the same
 * rule `ProductionSpec` already applies to a spec row with nothing written on
 * it).
 */

/** How the band arranges its blocks. */
export const DETAIL_BAND_LAYOUTS = [
  /** Side by side, two across on desktop, stacked on mobile. */
  "grid-2",
  /** Three across — for short blocks; long prose gets cramped. */
  "grid-3",
  /** Full-width sections, one under the next. */
  "rows",
  /** One tab per block. Hides everything but the active block. */
  "tabs",
  /** One collapsible per block, all closed but the first. */
  "accordion",
] as const

/**
 * Where a block's content comes from. Every source is something the product
 * ALREADY has — nothing here asks a partner to re-enter what they have already
 * told us somewhere else.
 */
export const DETAIL_BLOCK_SOURCES = [
  /** The production spec: weave, measured params, finishes (with icons). */
  "spec",
  /** The partner's own named spec fields — per-product free text. */
  "spec_fields",
  /**
   * The made-to-order colourways, drawn as swatches from each colour's hex.
   *
   * Its own source rather than part of `spec`: a palette is a row of colour,
   * not a label/value pair, and a partner may well want it beside the weave
   * rather than buried under it.
   */
  "colors",
  /** Material, origin, type, weight, dimensions — the old hardcoded tab. */
  "attributes",
  /** The maker/artisan story, when the product has one. */
  "maker",
  /** Care & shipping copy. Theme-level: the same promise on every product. */
  "care",
  "shipping",
] as const

export type DetailBandLayout = (typeof DETAIL_BAND_LAYOUTS)[number]
export type DetailBlockSource = (typeof DETAIL_BLOCK_SOURCES)[number]

export const detailBlockSchema = z.object({
  source: z.enum(DETAIL_BLOCK_SOURCES),
  /** Heading shown for this block. Falls back to the source's default label. */
  label: z.string().trim().min(1).max(80).optional(),
  /**
   * Body copy for the THEME-level sources (`care`, `shipping`). Ignored for the
   * per-product sources, which read the product — a theme cannot state a fact
   * about a piece it has never seen.
   */
  body: z.string().max(4000).optional(),
  /**
   * Off keeps the block in the list, with its label and body, instead of making
   * the partner delete and retype it to try a layout without it.
   */
  enabled: z.boolean().optional(),
})

export const detailBandSchema = z.object({
  enabled: z.boolean().optional(),
  layout: z.enum(DETAIL_BAND_LAYOUTS).optional(),
  /** Optional heading above the whole band. */
  heading: z.string().trim().max(120).optional(),
  blocks: z.array(detailBlockSchema).max(8).optional(),
})

export type DetailBlock = z.infer<typeof detailBlockSchema>
export type DetailBand = z.infer<typeof detailBandSchema>

/** The default label for each source, when the partner has not renamed it. */
export const DEFAULT_BLOCK_LABELS: Record<DetailBlockSource, string> = {
  spec: "Made to",
  spec_fields: "Details",
  colors: "Colours",
  attributes: "Product information",
  maker: "Made by",
  care: "Care",
  shipping: "Shipping & returns",
}
