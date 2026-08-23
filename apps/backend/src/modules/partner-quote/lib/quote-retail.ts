/**
 * "Can I sell this, and at what?" — the reseller's section (#1428 follow-up).
 *
 * ## Why this needs its own price read
 *
 * The buyer's own price comes from the price list minted for their customer
 * group. The LIST price — what the same item sells for on the shop, to anyone —
 * is that same variant priced with no group in the context. Both numbers exist;
 * only one of them was ever fetched.
 *
 * 🔴 That is also why this could not be derived from the old `live` column. It
 * used to BE the catalogue price, by accident, because the group was missing
 * from the pricing context — the bug fixed in #1389. Reusing it would have
 * meant a "margin" that was only correct while the page was wrong.
 *
 * ## The claim this block is careful not to make
 *
 * 🔑 A list price is what WE sell at, not what the buyer will get. It is a
 * reference point, not a promise of resale value, and the copy says so. Where
 * there is no separate list price — the quote was made at catalogue — there is
 * no margin story, and the block renders nothing rather than "0%". A margin of
 * zero presented as a fact reads as "this is not worth reselling", which is a
 * conclusion we have no business drawing on the buyer's behalf.
 */

export type QuoteRetailLine = {
  variant_id: string
  product_title: string | null
  quantity: number
  /** What this buyer pays per unit. */
  unit_amount: number
  /** What the shop sells one at, to anyone. Null when we could not price it. */
  list_unit_amount: number | null
  /** list − yours, per unit. Null unless there is a positive spread. */
  unit_margin: number | null
  /** The spread as a percentage of the list price, rounded to a whole number. */
  margin_pct: number | null
}

export type QuoteRetail = {
  currency_code: string
  lines: QuoteRetailLine[]
  /** Summed over the basket at the quoted quantities. */
  total_at_list: number | null
  total_at_your_price: number
  total_margin: number | null
  /** Basket-level percentage. Null when no line had a list price. */
  margin_pct: number | null
  /** The catalogue words for the whole basket, deduped and ordered. */
  tags: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * PURE. Feed it the quoted lines and whatever list prices were resolvable.
 *
 * Returns null when there is nothing to say — no line had a list price above
 * what the buyer is paying — so the caller renders no section rather than an
 * empty one.
 */
export function composeQuoteRetail(input: {
  currency_code: string
  lines: Array<{
    variant_id: string
    product_title?: string | null
    quantity: number
    unit_amount: number | null | undefined
    product_tags?: string[] | null
  }>
  /** variant_id → the shop's own price for one. Missing entries are fine. */
  listPrices: Map<string, number>
}): QuoteRetail | null {
  const lines: QuoteRetailLine[] = []

  let totalList: number | null = null
  let totalYours = 0

  for (const line of input.lines ?? []) {
    /**
     * 🔴 `Number(null)` is 0, and 0 IS finite — so a plain `Number.isFinite`
     * guard does not skip an unpriced line, it books it at zero. The buyer's
     * total would then be understated and the margin overstated, on a block
     * whose entire job is to state a margin. Null and undefined are checked
     * FIRST, and only then is the value tested for being a number.
     *
     * The same shape has already turned "nobody named a deposit" into "take
     * nothing up front" (`splitDeposit`) and a rule-gated zero into free
     * shipping on every bulk order (#1430). Found by the test below, not by
     * reading this line.
     */
    if (line.unit_amount === null || line.unit_amount === undefined) continue
    const unit = Number(line.unit_amount)
    if (!Number.isFinite(unit)) continue

    const qty = Number(line.quantity) || 0
    totalYours += unit * qty

    const rawList = input.listPrices.get(line.variant_id)
    const list = Number.isFinite(Number(rawList)) ? Number(rawList) : null

    // 🔑 Only a POSITIVE spread is a margin. A list price at or below the
    // quoted price means the buyer negotiated to (or past) retail, and
    // presenting that as a margin of 0 or a negative one would be editorial.
    const spread = list !== null && list > unit ? round2(list - unit) : null

    if (list !== null) {
      totalList = round2((totalList ?? 0) + list * qty)
    }

    lines.push({
      variant_id: line.variant_id,
      product_title: line.product_title ?? null,
      quantity: qty,
      unit_amount: unit,
      list_unit_amount: list,
      unit_margin: spread,
      margin_pct: spread !== null && list ? Math.round((spread / list) * 100) : null,
    })
  }

  if (!lines.length) return null
  if (!lines.some((l) => l.unit_margin !== null)) return null

  const totalMargin =
    totalList === null ? null : round2(Math.max(0, totalList - round2(totalYours)))

  const tags = Array.from(
    new Set(
      (input.lines ?? []).flatMap((l) =>
        (l.product_tags ?? []).filter((t) => typeof t === "string" && t.trim())
      )
    )
  ).sort((a, b) => a.localeCompare(b))

  return {
    currency_code: input.currency_code,
    lines,
    total_at_list: totalList,
    total_at_your_price: round2(totalYours),
    total_margin: totalMargin,
    margin_pct:
      totalList && totalMargin !== null && totalList > 0
        ? Math.round((totalMargin / totalList) * 100)
        : null,
    tags,
  }
}
