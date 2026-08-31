/**
 * PURE: the basket the buyer's page prices, from the quote's frozen lines and
 * whatever quantities they have dialled.
 *
 * ## Why it is a function rather than four lines in the route
 *
 * Because a field went missing from those four lines and nothing could see it.
 * The route mapped `variant_id`, `quantity`, `position`, `note` — and dropped
 * `quoted_unit_weight_grams`, the weight the MINT was given for a line the
 * catalogue cannot weigh.
 *
 * 🔴 That drop made every DESIGN-led quote unacceptable online. A design is
 * quoted before its garment exists as a product, so the made-to-order variant
 * minted for it carries no weight; the operator types one per line instead.
 * Without it `buildShippingEstimate` fell back to the variant, found nothing,
 * and refused the WHOLE basket — and the resulting `live_error` reaches
 * `composeQuoteAcceptance` as `unusable_reason`, which tells the buyer:
 *
 *   "This quote is no longer open. Ask for a fresh one and it will be priced
 *    again."
 *
 * on a quote minted minutes earlier and open for a fortnight. Live on
 * `01M1BPV6TM…` (Oshen, four design lines).
 *
 * A mapping that silently omits a pricing input is exactly the shape a test
 * can hold, so it lives here where one can reach it.
 */

export type FrozenQuoteLine = {
  variant_id: string
  quantity: number
  position?: number | null
  note?: string | null
  quoted_unit_weight_grams?: number | null
}

export type EffectiveQuoteLine = {
  variant_id: string
  quantity: number
  /**
   * `undefined`, never `null`, when a line has no position — the view's own
   * line type declares `position?: number` and a null would not assign to it.
   */
  position?: number
  note: string | null
  /** The mint's own figure, carried forward. Null means "ask the catalogue". */
  unit_weight_grams: number | null
}

/**
 * @param lines  the quote's frozen rows
 * @param dial   the `?lines=` query value, or null
 *
 * A malformed dial is IGNORED rather than refused: the quoted basket is always
 * a correct answer, and a link mangled by an email client should not cost the
 * buyer their price.
 */
export function effectiveQuoteLines(
  lines: FrozenQuoteLine[] | null | undefined,
  dial?: string | null
): EffectiveQuoteLine[] {
  const base: EffectiveQuoteLine[] = (lines ?? []).map((l) => ({
    variant_id: l.variant_id,
    quantity: Number(l.quantity),
    position: l.position ?? undefined,
    note: l.note ?? null,
    unit_weight_grams: l.quoted_unit_weight_grams ?? null,
  }))

  if (!dial) return base

  let byVariant: Map<string, number>
  try {
    const parsed = JSON.parse(dial) as Array<{
      variant_id: string
      quantity: number
    }>
    byVariant = new Map(parsed.map((d) => [d.variant_id, d.quantity]))
  } catch {
    return base
  }

  return base.map((l) => ({
    ...l,
    quantity: Number(byVariant.get(l.variant_id) ?? l.quantity),
  }))
}
