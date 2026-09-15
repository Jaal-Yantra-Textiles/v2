/**
 * Which variant of a multi-variant design is being quoted (#1970).
 *
 * The backend has answered this question for months and nobody could hear it.
 * `design-lines.ts:140` resolves a design's variant as
 * `candidates.length === 1 ? candidates[0].variant_id : null`, and when there
 * are several it returns them all with the reason
 * *"…is sold as N variants — pick the one to quote."* The list reaches the
 * client and is typed on `QuotableDesign.candidates` — but no component ever
 * rendered it, so the row appeared greyed out, told the partner to pick, and
 * offered nothing to pick with.
 *
 * 🔴 It never resolves to row 0. Picking the first candidate to make the row
 * work would be the `stores[0]` / `take:1` mistake on a document a buyer
 * signs: a quote for a size nobody chose. The partner chooses, or the design
 * stays unpickable.
 *
 * Pure, and in its own file, for the reason its sibling `quote-line-designs.ts`
 * gives: `apps/partner-ui` has no CI and no DOM test harness, so anything left
 * inside a component is checked by nothing at all.
 */

export type DesignCandidate = {
  variant_id: string
  title?: string | null
  sku?: string | null
  product_id?: string | null
  product_title?: string | null
}

export type CandidateDesignLike = {
  variant_id?: string | null
  product_id?: string | null
  candidates?: DesignCandidate[] | null
}

/** The variant and product a pick will actually carry. */
export type DesignPick = { variant_id: string; product_id: string }

/**
 * The design backs several variants and the partner has to say which.
 *
 * Distinct from "nothing backs it yet" (`candidates.length === 0`), which is
 * the made-to-order case and keeps its own message. Collapsing the two would
 * offer an empty dropdown on a design that needs a product minted instead.
 */
export const needsVariantChoice = (
  design: CandidateDesignLike | null | undefined
): boolean =>
  !design?.variant_id && (design?.candidates?.length ?? 0) > 1

/**
 * The options to show, in the words a partner recognises.
 *
 * The variant title is the size for a design-minted product; the SKU is the
 * fallback, and the id is the last resort so a row is never blank.
 */
export const candidateOptions = (
  design: CandidateDesignLike | null | undefined
): Array<{ value: string; label: string }> =>
  (design?.candidates ?? []).map((c) => ({
    value: c.variant_id,
    label: String(c.title ?? c.sku ?? c.variant_id),
  }))

/**
 * What ticking this design should put in the basket, or null when it cannot
 * be ticked yet.
 *
 * 🔴 BOTH ids or nothing. `toggleDesign` in quote-products-form keys the
 * basket by variant AND adds the product to `product_ids`; a candidate whose
 * `product_id` is missing would tick the box, add no product, and leave a
 * quantity keyed to a variant the next step cannot find. Refusing is the
 * honest answer — the same rule `resolveMintSalesChannel` follows.
 */
export const resolveDesignPick = (
  design: CandidateDesignLike | null | undefined,
  chosenVariantId?: string | null
): DesignPick | null => {
  if (!design) return null

  // Already resolved: one candidate, or a made-to-order variant just minted.
  if (design.variant_id && design.product_id) {
    return { variant_id: design.variant_id, product_id: design.product_id }
  }

  if (!needsVariantChoice(design)) return null

  const chosen = String(chosenVariantId ?? "")
  if (!chosen) return null

  // Only a candidate the backend actually offered. A variant id arriving from
  // anywhere else is not a thing this design is sold as.
  const match = (design.candidates ?? []).find((c) => c.variant_id === chosen)
  if (!match?.product_id) return null

  return { variant_id: match.variant_id, product_id: match.product_id }
}

/**
 * Record or clear one design's chosen variant.
 *
 * 🔴 Clearing DELETES the key rather than writing `""`, mirroring `assignDesign`
 * in quote-line-designs.ts: an empty string is a value, and a later
 * `resolveDesignPick` would treat "chosen nothing" as a candidate lookup that
 * fails rather than as "not chosen".
 */
export const chooseCandidate = (
  current: Record<string, string> | undefined,
  designId: string,
  variantId?: string | null
): Record<string, string> => {
  const next = { ...(current ?? {}) }
  if (!variantId) delete next[designId]
  else next[designId] = variantId
  return next
}
