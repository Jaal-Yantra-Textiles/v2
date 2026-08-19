import {
  DEFAULT_BLOCK_LABELS,
  type DetailBand,
  type DetailBandLayout,
  type DetailBlockSource,
} from "./detail-band"

/**
 * Which blocks a given product actually renders, and how.
 *
 * Kept pure and kept HERE — the storefronts carry a byte-identical port (the
 * same arrangement #1360 used for the spec fetch), so the rule can be exercised
 * without booting Next.
 *
 * The rule that matters is the one about emptiness. The theme lists blocks for
 * EVERY product, but a product with no spec, no maker and no partner fields
 * would otherwise render three headings over three blanks — advertising detail
 * nobody provided, which is worse than the empty band we started with. So a
 * block is dropped when its product has nothing for it, and the whole band is
 * dropped when nothing survives.
 *
 * `available` is what the CALLER found on the product. It is deliberately not
 * computed here: the storefront knows whether `getProductSpec` returned rows,
 * and this function must stay free of fetches so it can be tested.
 */
export type BlockAvailability = Partial<Record<DetailBlockSource, boolean>>

export type ResolvedDetailBlock = {
  source: DetailBlockSource
  label: string
  /** Only ever set for the theme-level sources. */
  body?: string
}

export type ResolvedDetailBand = {
  layout: DetailBandLayout
  heading?: string
  blocks: ResolvedDetailBlock[]
}

/** Sources whose content is written in the THEME, not read off the product. */
const THEME_AUTHORED: DetailBlockSource[] = ["care", "shipping"]

export const resolveDetailBand = (
  band: DetailBand | null | undefined,
  available: BlockAvailability
): ResolvedDetailBand | null => {
  // Absent is off. The band is new, so every theme that predates it has no
  // `detail_band` key at all, and those pages must look exactly as they did.
  if (!band || band.enabled !== true) {
    return null
  }

  const blocks: ResolvedDetailBlock[] = []

  for (const block of band.blocks || []) {
    if (block.enabled === false) {
      continue
    }

    const source = block.source
    const label = (block.label || "").trim() || DEFAULT_BLOCK_LABELS[source]

    if (THEME_AUTHORED.includes(source)) {
      // A care block with nothing written IS the empty case — there is no
      // product to fall back to.
      const body = (block.body || "").trim()
      if (!body) {
        continue
      }
      blocks.push({ source, label, body })
      continue
    }

    // Everything else reads the product, and the caller has already looked.
    if (!available[source]) {
      continue
    }
    blocks.push({ source, label })
  }

  if (!blocks.length) {
    return null
  }

  return {
    // `rows` rather than a grid: a band of one block in a 2-up grid renders a
    // half-width card against dead space, and a partner who never chose a
    // layout has not asked for that.
    layout: band.layout || "rows",
    ...(band.heading?.trim() ? { heading: band.heading.trim() } : {}),
    blocks,
  }
}
