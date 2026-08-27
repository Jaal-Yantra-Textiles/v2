import { resolveDesignVariants, type DesignResolution } from "./design-lines"

/**
 * The design picker's rows (#1486).
 *
 * ## Why quotability is computed here rather than filtered out
 *
 * 🔑 A design that CANNOT be quoted still appears in the list, greyed, with the
 * reason on it. Hiding it makes the picker lie: the partner knows the design
 * exists, cannot find it, and has no way to learn that the fix is "create a
 * product from it first". A picker that silently omits things is how a
 * five-minute task becomes a support message.
 *
 * The two remaining cases are genuinely different and say so:
 * - sold as several variants — pick one, and here they are;
 * - not visible to this caller — indistinguishable from "does not exist", on
 *   purpose, so an id cannot be probed.
 *
 * ## "No product behind it" is no longer a refusal
 *
 * It used to be the commonest reason a row was greyed, and it was the wrong
 * answer for custom work: a design whose production run is in the FUTURE has
 * no product by definition, and telling the partner to go and create a
 * catalogue product for something nobody has bought is a step that existed
 * only because the resolver needed a variant to point at.
 *
 * Such a row now reads as `made_to_order` — quotable, with the variant minted
 * and priced from the estimator when it is actually added to a basket. The
 * flag is separate from `quotable` rather than folded into it because the two
 * mean different things to the UI: one has a variant and a settled price
 * behind it, the other will have both a moment after it is picked.
 */
export type QuotableDesign = {
  id: string
  name: string | null
  thumbnail_url: string | null
  product_type: string | null
  status: string | null
  /** True when exactly one variant backs it, so a line can be built. */
  quotable: boolean
  /**
   * True when nothing backs it yet, but a made-to-order variant will be minted
   * and priced when it is added to a basket.
   *
   * ⚠️ NOT a promise that it can be priced. The estimator may still find
   * nothing to go on, and the readiness preflight is where that is reported —
   * pricing every row of the picker would mean an estimator run per row, which
   * is how a picker that feels fine against a seed becomes unusable against a
   * real catalogue.
   */
  made_to_order: boolean
  /** The variant a line would be priced through. Null unless `quotable`. */
  variant_id: string | null
  /**
   * The product that variant belongs to. The wizard needs it because its
   * basket is "selected products → their variants → quantities", so picking a
   * design has to select the product behind it for the variant to appear at all.
   */
  product_id: string | null
  /** Every variant it could be quoted through — the picker for the many case. */
  candidates: DesignResolution["candidates"]
  /** Why not, in words for a partner. Null when `quotable`. */
  reason: string | null
}

/** PURE: one design row + its resolution → what the picker renders. */
export function toQuotableDesign(
  design: any,
  resolution: DesignResolution | undefined
): QuotableDesign {
  return {
    id: design?.id,
    name: design?.name ?? null,
    thumbnail_url: design?.thumbnail_url ?? null,
    product_type: design?.product_type ?? null,
    status: design?.status ?? null,
    quotable: Boolean(resolution?.variant_id),
    made_to_order: Boolean(
      resolution?.visible && !resolution.variant_id && resolution.candidates.length === 0
    ),
    variant_id: resolution?.variant_id ?? null,
    product_id: resolution?.variant_id
      ? (resolution.candidates.find((c) => c.variant_id === resolution.variant_id)
          ?.product_id ?? null)
      : null,
    candidates: resolution?.candidates ?? [],
    /**
     * Silent for a made-to-order row: there is nothing wrong with it, and a
     * reason string next to it renders as a problem in every UI that shows
     * one. The made-to-order FLAG is what the picker should label it with.
     */
    reason:
      resolution?.variant_id ||
      (resolution?.visible && resolution.candidates.length === 0)
        ? null
        : (resolution?.reason ?? null),
  }
}

/** Annotate a page of designs. One batched resolution for the whole page. */
export async function annotateQuotableDesigns(
  scope: any,
  input: { designs: any[]; partner_id?: string | null }
): Promise<QuotableDesign[]> {
  const designs = (input.designs ?? []).filter((d) => d?.id)
  if (!designs.length) return []

  const resolutions = await resolveDesignVariants(scope, {
    design_ids: designs.map((d) => String(d.id)),
    partner_id: input.partner_id ?? null,
  })

  return designs.map((d) => toQuotableDesign(d, resolutions.get(String(d.id))))
}
