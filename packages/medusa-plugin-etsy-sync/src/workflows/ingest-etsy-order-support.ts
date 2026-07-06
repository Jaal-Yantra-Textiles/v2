// Pure mapping from an Etsy receipt (order) → the pieces createOrderWorkflow needs.
// Kept side-effect-free so it can be unit-tested without a container.

export type EtsyMoney = { amount?: number; divisor?: number; currency_code?: string }

export const etsyMoney = (m?: EtsyMoney): number => {
  if (!m || m.amount == null) return 0
  const divisor = m.divisor && m.divisor > 0 ? m.divisor : 100
  return m.amount / divisor
}

const splitName = (name?: string): { first: string; last: string } => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: "Etsy", last: "Buyer" }
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

export type MappedEtsyOrder = {
  receipt_id: string
  email: string
  buyer_name: string | null
  currency_code: string
  total: number
  shipping_address: Record<string, any>
  items: Array<{
    title: string
    quantity: number
    unit_price: number
    metadata: Record<string, any>
  }>
}

export function mapReceiptToOrder(receipt: any): MappedEtsyOrder {
  const receiptId = String(receipt?.receipt_id ?? receipt?.order_id ?? "")
  const currency = String(
    receipt?.currency_code ||
      receipt?.grandtotal?.currency_code ||
      "usd"
  ).toLowerCase()

  const { first, last } = splitName(receipt?.name)

  // Etsy usually does NOT expose the buyer email via API — fall back to a
  // synthetic, non-deliverable address keyed by receipt so the guest customer
  // is stable and we never accidentally email a real inbox.
  const email =
    (typeof receipt?.buyer_email === "string" && receipt.buyer_email) ||
    `etsy+${receiptId}@marketplace.invalid`

  const transactions: any[] = Array.isArray(receipt?.transactions)
    ? receipt.transactions
    : []

  const items = transactions.map((t) => ({
    title: String(t?.title || "Etsy item").slice(0, 250),
    quantity: Math.max(1, Number(t?.quantity) || 1),
    unit_price: etsyMoney(t?.price),
    metadata: {
      etsy_transaction_id: t?.transaction_id != null ? String(t.transaction_id) : null,
      etsy_listing_id: t?.listing_id != null ? String(t.listing_id) : null,
      etsy_product_id: t?.product_id != null ? String(t.product_id) : null,
      sku: t?.sku ?? null,
    },
  }))

  const shipping_address = {
    first_name: first,
    last_name: last,
    address_1: receipt?.first_line || "",
    address_2: receipt?.second_line || "",
    city: receipt?.city || "",
    province: receipt?.state || "",
    postal_code: receipt?.zip || "",
    country_code: String(receipt?.country_iso || "").toLowerCase() || undefined,
  }

  return {
    receipt_id: receiptId,
    email,
    buyer_name: receipt?.name || null,
    currency_code: currency,
    total: etsyMoney(receipt?.grandtotal),
    shipping_address,
    items,
  }
}
