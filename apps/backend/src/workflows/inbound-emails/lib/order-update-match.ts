/**
 * Pure helpers for "a supplier emailed about an order we already have"
 * (log-inbound-order-update). No container, so they are unit-tested directly.
 */

export type ExtractedOrderUpdate = {
  order_number?: string | null
  update_type?: string | null
  status_text?: string | null
  tracking_number?: string | null
  carrier?: string | null
  tracking_url?: string | null
  expected_delivery_date?: string | null
  summary?: string | null
}

export type OrderForMatch = {
  id: string
  metadata?: Record<string, any> | null
}

/** "#JH27228 " → "JH27228". Blank or non-string → null. */
export const normalizeOrderNumber = (raw: unknown): string | null => {
  if (typeof raw !== "string" && typeof raw !== "number") return null
  const s = String(raw).trim().replace(/^#+/, "").trim().toUpperCase()
  return s || null
}

/**
 * The supplier's own order number, as our orders record it. The inbound-email
 * create path writes `supplier_order_number`; the older seeded flow wrote
 * `order_number`. Both are read so either kind of order matches.
 */
const orderNumbersOf = (order: OrderForMatch): string[] =>
  [order.metadata?.supplier_order_number, order.metadata?.order_number]
    .map(normalizeOrderNumber)
    .filter((n): n is string => !!n)

/** Every order whose recorded supplier order number equals `orderNumber`. */
export const matchOrdersByNumber = <T extends OrderForMatch>(
  orders: T[],
  orderNumber: string | null
): T[] => {
  if (!orderNumber) return []
  return orders.filter((o) => orderNumbersOf(o).includes(orderNumber))
}

/** One line for the order timeline. */
export const buildUpdateSummary = (
  extracted: ExtractedOrderUpdate,
  subject: string
): string => {
  const head =
    (extracted.update_type || extracted.status_text || "").toString().trim() ||
    "Supplier email"
  const parts = [
    extracted.carrier && extracted.tracking_number
      ? `${extracted.carrier} ${extracted.tracking_number}`
      : extracted.tracking_number || extracted.carrier || null,
    extracted.expected_delivery_date ? `ETA ${extracted.expected_delivery_date}` : null,
  ].filter(Boolean)
  const line = parts.length ? `${head}: ${parts.join(" · ")}` : head
  const detail = (extracted.summary || "").toString().trim() || subject
  return `${line} (${detail})`.slice(0, 500)
}
