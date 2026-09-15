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
 * Every field is a COUNT of rows that exist, not an opinion. All three are
 * traces of goods that physically existed: something was made, something is
 * held somewhere, something is in stock.
 *
 * 🔴 PRODUCT COUNTS ARE DELIBERATELY ABSENT. Do not add them back.
 * The catalogue says nothing about physicality. Measured on prod 2026-09-15
 * (`backfill-product-shipping-profiles` preview): **97 of 97 products carry a
 * shipping profile**, and `createProductsWorkflow` assigns the store's default
 * profile to anything created normally. So "has shippable products" is true of
 * every partner with any catalogue at all — including a hypothetical
 * digital-only one — and is a false positive, not evidence.
 */
export type PhysicalGoodsEvidence = {
  /** Production runs — someone physically made something. */
  productionRunCount: number
  /** Stock locations linked to the partner (the typed #2053 link). */
  stockLocationCount: number
  /** Inventory items the partner holds. */
  inventoryItemCount: number
}

/**
 * Does this partner handle physical goods — i.e. do they need a warehouse,
 * stock locations and carrier registrations at all?
 *
 * - `yes`     they have made or held something real.
 * - `unknown` nothing to go on. Most partners on the day they are created.
 *
 * 🔴 `no` IS NOT DERIVABLE TODAY, AND THE SHIPPING PROFILE CANNOT FIX IT.
 *
 * The obvious completion is "has products, none of them ship → no". It does
 * not work, and it cannot be made to work by configuring the catalogue better:
 *
 *   - Measured on prod 2026-09-15, **97 of 97 products carry a shipping
 *     profile** (`backfill-product-shipping-profiles` preview; `list_products`
 *     count confirms 97 is the whole catalogue). The field is SATURATED.
 *   - `createProductsWorkflow` assigns the store's `type: "default"` profile to
 *     any product created normally, so a digital product would acquire one
 *     automatically and read as physical.
 *
 * So shippability carries no information in either direction, and the earlier
 * reading of #1195 — "most of this catalogue has no profile, so a zero means
 * unconfigured" — is out of date: that backfill has since been run. Either way
 * the answer is the same, for a stronger reason.
 *
 * Telling a designer's pattern apart from a shawl needs a signal the catalogue
 * does not carry AT ALL. Until one exists, this function can confirm physical
 * goods and can decline to guess, and that is all. A caller that needs a real
 * `no` — a gate that withholds a warehouse — must wait for that signal rather
 * than read `unknown` as one.
 */
export const handlesPhysicalGoods = (
  evidence: PhysicalGoodsEvidence
): Capability => {
  const { productionRunCount, stockLocationCount, inventoryItemCount } =
    evidence

  if (
    productionRunCount > 0 ||
    stockLocationCount > 0 ||
    inventoryItemCount > 0
  ) {
    return "yes"
  }

  return "unknown"
}
