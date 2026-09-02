/**
 * What an inventory order is really worth, once the amounts that are not goods
 * are counted (#1737).
 *
 * 🔴 ONE place. `assessInventoryOrderClaims` (the write guard) and
 * `payable-inventory-orders` (the offer screen) must agree to the paisa, or the
 * screen offers a figure the guard rejects and the operator learns the rule
 * from a 400 — the defect `runPayableOffer` was extracted to prevent (#1616).
 *
 * PURE, so the arithmetic can be tested without a database.
 */

export type ChargeType = "tax" | "shipping" | "discount" | "adjustment"

export type OrderCharge = {
  type?: ChargeType | string | null
  amount?: number | string | null
}

/**
 * Which types RAISE what we owe and which LOWER it.
 *
 * 🔑 The sign lives here, not on the stored amount. A `tax` of 200 and a
 * `discount` of 200 are the same number and opposite facts; storing a signed
 * amount would let one typo turn an obligation into a reduction with nothing in
 * the way. An amount is always positive and its type decides the direction.
 */
const RAISES = new Set<string>(["tax", "shipping"])
const LOWERS = new Set<string>(["discount", "adjustment"])

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const round = (value: number): number => Math.round(value * 100) / 100

export type ChargeTotals = {
  /** Tax + shipping. What the partner is owed ON TOP of the goods. */
  raises: number
  /** Discounts + adjustments. What has been written off. */
  lowers: number
  /** `raises - lowers`. May be negative; that is a net reduction, not an error. */
  net: number
}

/**
 * PURE: fold a list of charges into the two directions.
 *
 * ⚠️ An UNKNOWN type is counted in neither direction and is not silently
 * treated as a raise. A type this code does not understand is a question, and
 * guessing it upward would invent an obligation — the direction that overpays.
 * Callers that care can compare `raises + lowers` against the row count.
 */
export const foldOrderCharges = (
  charges: OrderCharge[] | null | undefined
): ChargeTotals => {
  const rows = Array.isArray(charges) ? charges.filter(Boolean) : []

  let raises = 0
  let lowers = 0
  for (const charge of rows) {
    /**
     * ⚠️ `Math.abs`, because the type carries the sign. A negative amount that
     * slipped into the column would otherwise flip its own type's direction and
     * a `tax` of -200 would quietly reduce what we owe.
     */
    const amount = Math.abs(num(charge?.amount))
    const type = String(charge?.type ?? "")
    if (RAISES.has(type)) raises += amount
    else if (LOWERS.has(type)) lowers += amount
  }

  return {
    raises: round(raises),
    lowers: round(lowers),
    net: round(raises - lowers),
  }
}

/**
 * PURE: the ceiling a claim against this order may not exceed.
 *
 * 🔴 `total_price` is GOODS and stays that way — see the model. This adds the
 * charges rather than folding them in, so an order with no charges yields
 * EXACTLY `total_price` and every existing row behaves identically. That
 * property is what makes this safe to put behind a live money guard, and there
 * is a test that asserts it.
 *
 * ⚠️ Never below zero. A write-off larger than the order would otherwise
 * produce a negative ceiling, which reads as "this partner owes us" — a claim
 * no data here supports.
 */
export const orderPayableCeiling = (
  order: { total_price?: number | string | null } | null | undefined,
  charges: OrderCharge[] | null | undefined
): number => {
  const goods = num(order?.total_price)
  const { net } = foldOrderCharges(charges)
  return round(Math.max(0, goods + net))
}
