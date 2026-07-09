// Pure mapping from a Faire order → the pieces createOrderWorkflow needs.
// Kept side-effect-free so it can be unit-tested without a container.

// Faire sends money as integer minor units in *_cents fields (2-decimal
// currencies). Medusa v2 order line-item unit_price and payment-collection
// amounts are decimal MAJOR units (e.g. 49.99, not 4999) — same contract the
// sibling Etsy plugin honours via etsyMoney(). Divide by 100 so orders are not
// created at 100× the real total.
export const faireMoney = (cents?: number): number => {
  const n = Number(cents)
  return Number.isFinite(n) ? n / 100 : 0
}

const splitName = (name?: string): { first: string; last: string } => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: "Faire", last: "Buyer" }
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

// Faire ExternalMoneyV2 = { amount_minor, currency }. Returns integer minor
// units + ISO currency, or null when the field is absent/not a money object.
const moneyOf = (m: any): { minor: number; currency: string } | null =>
  m && typeof m === "object" && m.amount_minor != null
    ? { minor: Number(m.amount_minor) || 0, currency: String(m.currency || "") }
    : null

// Faire order addresses carry ISO-3 `country_code` ("CAN") + a full `country`
// name ("Canada"); Medusa wants a lowercase ISO-2. Map the ISO-3 codes for the
// regions Faire operates in; pass through anything already 2-letter.
const ISO3_TO_ISO2: Record<string, string> = {
  USA: "us", CAN: "ca", GBR: "gb", AUS: "au", NZL: "nz", DEU: "de", FRA: "fr",
  ITA: "it", ESP: "es", PRT: "pt", NLD: "nl", BEL: "be", LUX: "lu", AUT: "at",
  IRL: "ie", CHE: "ch", SWE: "se", DNK: "dk", FIN: "fi", NOR: "no", POL: "pl",
  CZE: "cz", GRC: "gr", HUN: "hu", ROU: "ro", BGR: "bg", HRV: "hr", SVK: "sk",
  SVN: "si", EST: "ee", LVA: "lv", LTU: "lt", CYP: "cy", MLT: "mt",
}
const faireCountryToIso2 = (raw?: string): string | undefined => {
  const s = String(raw ?? "").trim()
  if (!s) return undefined
  if (s.length === 2) return s.toLowerCase()
  const iso2 = ISO3_TO_ISO2[s.toUpperCase()]
  return iso2 ?? undefined // full country names ("Canada") can't be mapped safely
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
  const items: any[] = Array.isArray(order?.items) ? order.items : []

  // ExternalOrderV2 has NO top-level currency/total. Currency comes off any
  // item's ExternalMoneyV2 `price` (fall back to the payout currency, then the
  // legacy top-level fields for back-compat). See docs verified 2026-07-09.
  const itemMoney = items.map((it) => moneyOf(it?.price)).find(Boolean)
  const currency = String(
    itemMoney?.currency ||
      moneyOf(order?.payout_costs?.total_payout)?.currency ||
      order?.currency ||
      order?.currency_code ||
      "usd"
  ).toLowerCase()

  // Buyer name: ExternalOrderV2.customer { first_name, last_name }, else the
  // recipient name on the address. (`address.company_name`/`retailer_id` is the
  // wholesale store, not the person.) Legacy fields kept as fallbacks.
  const customer = order?.customer ?? {}
  const buyerName =
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    address?.name ||
    order?.buyer_name ||
    order?.customer_name ||
    [address?.first_name, address?.last_name].filter(Boolean).join(" ") ||
    ""
  const { first, last } = splitName(buyerName)

  // Faire usually does NOT expose the retailer's email via API — fall back to a
  // synthetic, non-deliverable address keyed by order token so the guest
  // customer is stable and we never accidentally email a real inbox.
  const email =
    (typeof order?.buyer_email === "string" && order.buyer_email) ||
    (typeof order?.email === "string" && order.email) ||
    `faire+${orderToken}@marketplace.invalid`

  const unitMinorOf = (it: any): number => {
    const m = moneyOf(it?.price)
    return m
      ? m.minor
      : Number(it?.price_cents ?? it?.wholesale_price_cents ?? it?.unit_price_cents ?? 0)
  }

  const mappedItems = items.map((it) => ({
    title: String(it?.product_name ?? it?.name ?? it?.title ?? "Faire item").slice(0, 250),
    quantity: Math.max(1, Number(it?.quantity ?? it?.qty) || 1),
    unit_price: faireMoney(unitMinorOf(it)),
    metadata: {
      faire_order_token: orderToken,
      faire_item_id: it?.id != null ? String(it.id) : null,
      faire_product_token:
        it?.product_id != null
          ? String(it.product_id)
          : it?.product_token != null
            ? String(it.product_token)
            : null,
      faire_sku: it?.sku ?? null,
      faire_variant_id: it?.variant_id != null ? String(it.variant_id) : null,
    },
  }))

  // No order-level total exists — sum line values (unit price × qty). Honour an
  // explicit total_cents/grand_total_cents if a caller ever supplies one.
  const explicitTotalCents = order?.total_cents ?? order?.grand_total_cents
  const total =
    explicitTotalCents != null
      ? faireMoney(explicitTotalCents)
      : faireMoney(
          items.reduce(
            (sum, it) =>
              sum + unitMinorOf(it) * Math.max(1, Number(it?.quantity ?? it?.qty) || 1),
            0
          )
        )

  const shipping_address = {
    first_name: address?.first_name ?? first,
    last_name: address?.last_name ?? last,
    company: address?.company_name ?? undefined,
    address_1:
      address?.address1 ?? address?.address_1 ?? address?.street1 ?? "",
    address_2:
      address?.address2 ?? address?.address_2 ?? address?.street2 ?? "",
    city: address?.city ?? "",
    province: address?.state_code ?? address?.state ?? address?.province ?? "",
    postal_code: address?.postal_code ?? address?.zip ?? "",
    country_code: faireCountryToIso2(address?.country_code ?? address?.country),
    phone: address?.phone_number ?? address?.phone ?? undefined,
  }

  return {
    order_token: orderToken,
    email,
    buyer_name: buyerName || null,
    currency_code: currency,
    total,
    shipping_address,
    items: mappedItems,
  }
}
