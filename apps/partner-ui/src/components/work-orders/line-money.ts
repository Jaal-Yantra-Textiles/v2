/**
 * #1894 — what a partner is charged for one unit of an order line.
 *
 * `extra_cost` is the per-unit dye / finishing charge. The order's
 * `total_price` already includes it, so a row computed from `price` alone does
 * not sum to the total rendered beneath those rows — with nothing on screen
 * explaining the gap. On the GOF Asia order that gap was ₹8,030 across 73 m.
 *
 * Both fields arrive untyped from the partner API, and either may be null.
 */
type MoneyLine = { price?: unknown; extra_cost?: unknown }

export const lineUnitPrice = (line: MoneyLine | null | undefined): number =>
  (Number(line?.price) || 0) + (Number(line?.extra_cost) || 0)

export const lineTotal = (
  line: MoneyLine | null | undefined,
  quantity: unknown
): number => lineUnitPrice(line) * (Number(quantity) || 0)
