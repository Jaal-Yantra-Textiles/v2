/**
 * What a partner actually DOES — derived from evidence, never declared (#2061).
 *
 * Two questions the platform keeps asking, and keeps answering from the wrong
 * place:
 *
 *   1. Does this partner sell direct?           → storefront, key, domain
 *   2. Does this partner handle physical goods?  → warehouse, carriers
 *
 * They are INDEPENDENT. Most of this platform is both: surveyed on prod
 * 2026-09-15, 12 of the 14 partners who own a store are `manufacturer`. GOF,
 * Perennial and Unique Pashmina each describe themselves as weavers AND run a
 * verified custom domain — they make the goods and they sell them. One enum
 * cannot hold two orthogonal facts, so `workspace_type` is necessarily wrong
 * about one of them for those partners. It is a partner-UI sidebar persona.
 * Do not gate on it. See #2061 for the full survey.
 *
 * WHY DERIVED AND NOT DECLARED
 * ----------------------------
 * Self-declaration is what produced the mess: `workspace_type` defaults to
 * `'manufacturer'` on every row, and `metadata.use_type` (retired in #2061)
 * reached 5 partners of 31. Meanwhile the marketing routes have been quietly
 * answering question 1 correctly for months, from a fact about the world —
 * a partner is a live brand when a storefront is actually provisioned. This
 * module is that rule, promoted out of two copies and given a sibling for
 * question 2.
 *
 * 🔴 "NO EVIDENCE" IS NOT "NO"
 * ----------------------------
 * A partner created this morning has no runs, no stock and no catalogue —
 * identical, to any counter, to a consultancy that will never ship anything.
 * Resolving that silence to `false` would let a future gate refuse a warehouse
 * to every brand-new maker on the platform, which is precisely the failure
 * `expectsPaymentMethod` is written to avoid. So the answer is three-valued
 * and `unknown` is a real answer: say so, and let the caller decide whether it
 * may act on a guess.
 */

/** Yes / no / not enough evidence to say. Never collapse `unknown` to `false`. */
export type Capability = "yes" | "no" | "unknown"

export type StorefrontLike = {
  vercel_linked?: boolean | null
  storefront_domain?: string | null
} | null | undefined

/**
 * Does this partner sell direct to consumers?
 *
 * The observable fact is a provisioned storefront. This is the rule the
 * marketing partners/metrics routes already use to count live brands; it is
 * defined once here so the two of them cannot drift apart.
 *
 * Two-valued on purpose: a storefront either exists or it does not, and the
 * absence is not ambiguous the way an empty counter is — nothing has been
 * provisioned, so nothing is being sold through us.
 */
export const sellsDirect = (partner: StorefrontLike): boolean =>
  partner?.vercel_linked === true && Boolean(partner?.storefront_domain)

/**
 * Observable traces that a partner deals in physical things.
 *
 * Every field is a COUNT of rows that exist, not an opinion. `productCount` is
 * the control: without it, "no shippable products" cannot be told apart from
 * "no products".
 */
export type PhysicalGoodsEvidence = {
  /** Production runs — someone physically made something. */
  productionRunCount: number
  /** Stock locations linked to the partner (the typed #2053 link). */
  stockLocationCount: number
  /** Inventory items the partner holds. */
  inventoryItemCount: number
  /** Products whose variants ship (Medusa derives that from a shipping profile). */
  shippableProductCount: number
  /** All products, shippable or not. */
  productCount: number
}

/**
 * Does this partner handle physical goods — i.e. do they need a warehouse,
 * stock locations and carrier registrations at all?
 *
 * - `yes`     they have made, held or listed something that ships.
 * - `unknown` nothing to go on. Most partners on the day they are created,
 *             AND — see below — every partner whose catalogue simply has no
 *             shipping profiles configured.
 *
 * 🔴 `no` IS NOT DERIVABLE TODAY, AND THE TEMPTING RULE IS WRONG.
 * The obvious completion is "has products, none of them ship → no". It would
 * be wrong for most of the partner base. #1195 documents that **most of this
 * catalogue has no shipping profile** and sells `manage_inventory: false`
 * variants, and Medusa derives shippability from exactly those two things. So
 * `shippableProductCount === 0` is overwhelmingly "nobody configured a
 * shipping profile", not "these goods are not physical" — and a weaver selling
 * handwoven shawls would be labelled non-physical by it.
 *
 * Telling a designer's pattern apart from an unconfigured shawl needs a signal
 * the catalogue does not carry yet. Until it does, this function can confirm
 * physical goods and can decline to guess, and that is all. A caller that
 * needs a real `no` — a gate that withholds a warehouse — must wait for that
 * signal rather than read `unknown` as one.
 */
export const handlesPhysicalGoods = (
  evidence: PhysicalGoodsEvidence
): Capability => {
  const {
    productionRunCount,
    stockLocationCount,
    inventoryItemCount,
    shippableProductCount,
  } = evidence

  if (
    productionRunCount > 0 ||
    stockLocationCount > 0 ||
    inventoryItemCount > 0 ||
    shippableProductCount > 0
  ) {
    return "yes"
  }

  return "unknown"
}
