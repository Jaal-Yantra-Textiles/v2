/**
 * What ticking a design in the quote wizard actually resolves to.
 *
 * The backend already answers this question in three different shapes and the
 * wizard only ever handled two of them:
 *
 *   • one variant backs the design  → `variant_id` is set, tick and go
 *   • no variant backs it yet       → `made_to_order`, ticking MINTS one
 *   • SEVERAL variants back it      → `variant_id` is null and nothing else
 *
 * The third case is the one that was unreachable. `quotable` is
 * `Boolean(variant_id)` so it is false, and `made_to_order` is true only when
 * there are ZERO candidates — so the row rendered permanently disabled, under
 * the backend's own instruction:
 *
 *     "<name>" is sold as 3 variants — pick the one to quote.
 *
 * An instruction the operator is shown and cannot obey. A multi-variant design
 * simply could not be quoted from this screen.
 *
 * This is a pure function on purpose. The wizard's selection path runs through
 * React state, a data table and an async mint, and a rule buried in there can
 * only be tested by rendering it. Kept out here, the rule can be broken
 * deliberately and watched go red.
 */

export type DesignCandidate = {
  variant_id: string
  title: string | null
  sku: string | null
  product_id: string | null
  product_title: string | null
}

/** The fields of a quotable design that decide what a tick means. */
export type PickableDesign = {
  id: string
  quotable: boolean
  made_to_order: boolean
  variant_id: string | null
  product_id: string | null
  candidates: DesignCandidate[]
}

export type DesignPick = {
  /** The variant the line is priced through. Null while a choice is pending. */
  variant_id: string | null
  /** The product the basket is keyed by. Null while a choice is pending. */
  product_id: string | null
  /** The operator must choose a variant before this row can be ticked. */
  needs_choice: boolean
  /** Ticking this row mints a made-to-order variant before selecting it. */
  mints_on_pick: boolean
  /** Whether any action on this row can lead to a quotable line. */
  selectable: boolean
  /** Why not, when `selectable` is false. Null otherwise. */
  blocked_reason: string | null
}

const pick = (over: Partial<DesignPick>): DesignPick => ({
  variant_id: null,
  product_id: null,
  needs_choice: false,
  mints_on_pick: false,
  selectable: false,
  blocked_reason: null,
  ...over,
})

/**
 * Resolve what ticking `design` means, given the variant the operator has
 * chosen for it so far (if any).
 *
 * `chosenVariantId` is only consulted in the several-candidates case. Passing
 * one for a design that already resolves to a single variant does NOT override
 * it — the backend picked that variant, and letting a stale UI selection win
 * would quote a different variant than the one the row displays.
 */
export const resolveDesignPick = (
  design: PickableDesign,
  chosenVariantId?: string | null
): DesignPick => {
  // 1. The backend resolved it to exactly one variant.
  if (design.variant_id) {
    if (!design.product_id) {
      // The basket is keyed by product, so a variant with no product behind it
      // would tick and then silently drop out of the selection.
      return pick({
        blocked_reason: "This design's variant has no product behind it.",
      })
    }
    return pick({
      variant_id: design.variant_id,
      product_id: design.product_id,
      selectable: true,
    })
  }

  // 2. Nothing backs it yet — ticking mints. The mint returns the ids, so
  //    there is nothing to resolve here beyond saying that it will happen.
  if (design.made_to_order) {
    return pick({ mints_on_pick: true, selectable: true })
  }

  // 3. Several variants back it. This is the case the wizard never had.
  if (design.candidates.length > 1) {
    const chosen = design.candidates.find(
      (c) => c.variant_id === chosenVariantId
    )
    if (!chosen) {
      return pick({ needs_choice: true, selectable: true })
    }
    if (!chosen.product_id) {
      return pick({
        needs_choice: true,
        selectable: true,
        blocked_reason: "That variant has no product behind it — pick another.",
      })
    }
    return pick({
      variant_id: chosen.variant_id,
      product_id: chosen.product_id,
      selectable: true,
    })
  }

  // 4. Exactly one candidate but no resolved variant_id, or none at all.
  //    Not something the operator can fix by choosing.
  return pick({
    blocked_reason: "There is no product behind this design yet.",
  })
}

/** The candidates to offer, in a stable order, with a readable label each. */
export const candidateOptions = (
  design: PickableDesign
): { value: string; label: string }[] =>
  design.candidates.map((c) => ({
    value: c.variant_id,
    label: [c.product_title, c.title].filter(Boolean).join(" · ")
      || c.sku
      || c.variant_id,
  }))
