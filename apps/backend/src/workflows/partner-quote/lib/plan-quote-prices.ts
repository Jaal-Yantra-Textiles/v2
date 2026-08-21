/**
 * PURE: turn a frozen quote basket into the rows of a price list (#1389 S3).
 *
 * ## Why a price list at all
 *
 * Core resolves a price by `price_list_id IS NOT NULL DESC`, then rules
 * matched, then `amount ASC`, and only for an ACTIVE list inside its
 * `starts_at`/`ends_at`. So a price list scoped to the buyer's customer group
 * makes the quoted number the number the cart charges — and gets expiry and
 * revoke natively, with no cron and no sweeper.
 *
 * ⚠️ This REVERSES S1's rule that "nothing frozen ever prices a cart". That
 * rule existed because there was no way to make a buyer-specific price real.
 * There is; the model docblocks are updated alongside this.
 *
 * ## The tier
 *
 * A quoted line says "500 units at this unit price". That is a floor, not an
 * exact match: a buyer who orders 600 has earned the 500 tier. So each line
 * becomes ONE price row with `min_quantity = quoted quantity` and no ceiling.
 *
 * Ordering FEWER than quoted falls through to the base price, which is correct
 * — the discount was for the volume, and core simply finds no matching
 * price-list row at quantity 100.
 */

export type QuotePriceLine = {
  variant_id: string
  quantity: number
  /** The frozen unit amount. Same units the builder produced. */
  quoted_unit_amount?: number | null
}

export type PlannedQuotePrice = {
  variant_id: string
  currency_code: string
  amount: number
  min_quantity: number
  max_quantity: number | null
}

/**
 * One price row per quoted line, skipping any line the builder could not
 * price.
 *
 * 🔴 A line with no `quoted_unit_amount` is DROPPED, never defaulted to 0. A
 * zero here would not fail loudly — it would become an ACTIVE price of zero
 * that the cart happily charges, which is the worst possible failure mode for
 * this file.
 *
 * Duplicate variants collapse to the CHEAPEST row at a given quantity, because
 * that is what core would pick anyway (`amount ASC` breaks the tie) — better to
 * write the row we know wins than to leave two and hope.
 */
export function planQuotePrices(
  lines: QuotePriceLine[],
  currencyCode: string
): PlannedQuotePrice[] {
  const byKey = new Map<string, PlannedQuotePrice>()

  for (const line of lines || []) {
    const qty = Number(line?.quantity)
    const amount = line?.quoted_unit_amount

    if (!line?.variant_id) continue
    if (!Number.isFinite(qty) || qty <= 0) continue
    if (amount === null || amount === undefined) continue
    if (!Number.isFinite(Number(amount))) continue

    const key = `${line.variant_id}:${qty}`
    const row: PlannedQuotePrice = {
      variant_id: line.variant_id,
      currency_code: currencyCode,
      amount: Number(amount),
      min_quantity: qty,
      max_quantity: null,
    }

    const existing = byKey.get(key)
    if (!existing || row.amount < existing.amount) {
      byKey.set(key, row)
    }
  }

  return [...byKey.values()]
}

/**
 * PURE: has this price list actually been scoped to the buyer?
 *
 * 🔴 `rules_count = 0` applies a price list to EVERYONE. Core does not treat an
 * unruled list as an error — it treats it as universal — so a rule that
 * silently failed to attach turns one buyer's negotiated discount into a
 * platform-wide price cut. The rule is therefore asserted AFTER creation, from
 * a re-read, not assumed from the payload we sent.
 */
export function priceListScopedToGroup(
  priceList: { rules_count?: number | null; price_list_rules?: any[] } | null,
  groupId: string
): boolean {
  if (!priceList) return false
  if (!Number(priceList.rules_count ?? 0)) return false

  const rules = priceList.price_list_rules ?? []
  if (!rules.length) {
    // rules_count is positive but the expansion was not requested; the count is
    // the weaker signal, and it is the one that matters for "applies to all".
    return true
  }

  return rules.some((r: any) => {
    const attr = r?.attribute ?? r?.rule_attribute
    if (attr && attr !== "customer_group_id") return false
    const values = r?.value ?? r?.values
    if (Array.isArray(values)) {
      return values.some((v: any) => (v?.value ?? v) === groupId)
    }
    return values === groupId
  })
}
