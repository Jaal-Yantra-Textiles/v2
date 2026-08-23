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
 * The two unquotable cases are genuinely different and say so:
 * - no product behind the design at all — nothing to price;
 * - sold as several variants — pick one, and here they are.
 */
export type QuotableDesign = {
  id: string
  name: string | null
  thumbnail_url: string | null
  product_type: string | null
  status: string | null
  /** True when exactly one variant backs it, so a line can be built. */
  quotable: boolean
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
    variant_id: resolution?.variant_id ?? null,
    product_id: resolution?.variant_id
      ? (resolution.candidates.find((c) => c.variant_id === resolution.variant_id)
          ?.product_id ?? null)
      : null,
    candidates: resolution?.candidates ?? [],
    reason: resolution?.variant_id ? null : (resolution?.reason ?? null),
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
