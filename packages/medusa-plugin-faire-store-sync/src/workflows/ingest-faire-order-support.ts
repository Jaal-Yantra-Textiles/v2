// Pure mapping from a Faire order → the pieces createOrderWorkflow needs.
// Kept side-effect-free so it can be unit-tested without a container.

export const faireMoneyCents = (cents?: number): number => {
  const n = Number(cents)
  return Number.isFinite(n) ? n : 0
}

const splitName = (name?: string): { first: string; last: string } => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: "Faire", last: "Buyer" }
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

export type MappedFaireOrder = {
  order_token: string
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

export function mapFaireOrderToOrder(order: any): MappedFaireOrder {
  const orderToken = String(order?.order_token ?? order?.id ?? order?.token ?? "")

  const address = order?.address ?? order?.shipping_address ?? {}
  const currency = String(order?.currency ?? order?.currency_code ?? "usd").toLowerCase()

  const buyerName =
    order?.buyer_name ??
    order?.customer_name ??
    [address?.first_name, address?.last_name].filter(Boolean).join(" ")
  const { first, last } = splitName(buyerName)

  // Faire usually does NOT expose the retailer's email via API — fall back to a
  // synthetic, non-deliverable address keyed by order token so the guest
  // customer is stable and we never accidentally email a real inbox.
  const email =
    (typeof order?.buyer_email === "string" && order.buyer_email) ||
    (typeof order?.email === "string" && order.email) ||
    `faire+${orderToken}@marketplace.invalid`

  const items: any[] = Array.isArray(order?.items) ? order.items : []
  const mappedItems = items.map((it) => {
    const unitCents = Number(it?.wholesale_price_cents ?? it?.unit_price_cents ?? 0)
    return {
      title: String(it?.product_name ?? it?.name ?? it?.title ?? "Faire item").slice(0, 250),
      quantity: Math.max(1, Number(it?.quantity ?? it?.qty) || 1),
      unit_price: unitCents,
      metadata: {
        faire_order_token: orderToken,
        faire_item_id: it?.id != null ? String(it.id) : null,
        faire_product_token:
          it?.product_token != null ? String(it.product_token) : null,
        faire_sku: it?.sku ?? null,
        faire_variant_id:
          it?.variant_id != null ? String(it.variant_id) : null,
      },
    }
  })

  const shipping_address = {
    first_name: address?.first_name ?? first,
    last_name: address?.last_name ?? last,
    address_1: address?.street1 ?? address?.address1 ?? address?.address_1 ?? "",
    address_2: address?.street2 ?? address?.address2 ?? address?.address_2 ?? "",
    city: address?.city ?? "",
    province: address?.state ?? address?.province ?? "",
    postal_code: address?.zip ?? address?.postal_code ?? "",
    country_code: String(address?.country ?? address?.country_code ?? "").toLowerCase() || undefined,
    phone: address?.phone ?? undefined,
  }

  return {
    order_token: orderToken,
    email,
    buyer_name: buyerName || null,
    currency_code: currency,
    total: faireMoneyCents(order?.total_cents ?? order?.grand_total_cents),
    shipping_address,
    items: mappedItems,
  }
}
