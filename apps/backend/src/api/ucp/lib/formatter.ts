/**
 * UCP Protocol Formatter
 *
 * Transforms Medusa internal objects into UCP-compliant response shapes.
 * Spec: https://github.com/Universal-Commerce-Protocol/ucp
 */

import { medusaToUcpAddress } from "./address-translator"
import { resolveUcpStatus, resolveMissingRequirements, type UcpStatus } from "./status-maps"
import { buildUcpFulfillment } from "./fulfillment"
import { listShippingOptionsSafe } from "./shipping-options"
import { paymentNextAction } from "./payment-next-action"

export const UCP_VERSION = "2026-04-08"

export type UcpFormatterContext = {
  storeName: string
  storefrontUrl: string
  baseUrl: string
}

// =====================================================
// UCP Envelope
// =====================================================

function ucpEnvelope(ctx: UcpFormatterContext, cartMetadata?: Record<string, unknown>) {
  return {
    version: UCP_VERSION,
    status: "success" as const,
    capabilities: {
      "dev.ucp.shopping.catalog.search": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.catalog.lookup": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.cart": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.order": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.fulfillment": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.discount": [{ version: UCP_VERSION }],
    },
  }
}

/**
 * Response envelope for stateless catalog endpoints (no cart context). Per the
 * UCP REST binding, the envelope carries `version` + advertised `capabilities`.
 */
export function catalogEnvelope() {
  return {
    version: UCP_VERSION,
    status: "success" as const,
    capabilities: {
      "dev.ucp.shopping.catalog.search": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.catalog.lookup": [{ version: UCP_VERSION }],
    },
  }
}

// =====================================================
// Messages
// =====================================================

type UcpMessage =
  | { type: "error"; code: string; content: string; severity: string; path?: string }
  | { type: "info"; code?: string; content: string }

function buildCheckoutMessages(ctx: UcpFormatterContext, cart: any, status: UcpStatus): UcpMessage[] {
  const messages: UcpMessage[] = []

  if (status === "completed") {
    messages.push({ type: "info", code: "checkout_completed", content: "Checkout completed successfully." })
    return messages
  }
  if (status === "canceled") {
    messages.push({ type: "info", code: "checkout_canceled", content: "This checkout session has been canceled." })
    return messages
  }

  const missing = resolveMissingRequirements(cart)

  if (missing.includes("items")) {
    messages.push({
      type: "error", code: "missing_items",
      content: "Checkout session has no line items. Add items via PUT /ucp/checkout-sessions/{id}.",
      severity: "recoverable", path: "$.line_items",
    })
  }
  if (missing.includes("email")) {
    messages.push({
      type: "error", code: "missing_email",
      content: "Buyer email is required. Provide it via PUT /ucp/checkout-sessions/{id} with buyer.email.",
      severity: "recoverable", path: "$.buyer.email",
    })
  }
  if (missing.includes("shipping_address")) {
    messages.push({
      type: "error", code: "missing_shipping_address",
      content: "Shipping address is required. Provide it via PUT /ucp/checkout-sessions/{id} with shipping_address.",
      severity: "recoverable", path: "$.shipping_address",
    })
  }

  if (status === "ready_for_complete") {
    messages.push({
      type: "info", code: "ready_for_complete",
      content: "Checkout is ready. POST /ucp/checkout-sessions/{id}/complete with payment.instruments[].",
    })
  } else if (missing.length === 0) {
    messages.push({ type: "info", code: "checkout_in_progress", content: `Checkout session for ${ctx.storeName}.` })
  }

  return messages
}

// =====================================================
// Line Items
// =====================================================

function formatLineItems(items: any[]) {
  return items.map((item: any) => {
    const unitAmount = item.unit_price ?? item.raw_unit_price?.value ?? 0
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.id,
        title: item.title || item.product_title || "",
        price: unitAmount,
      },
      quantity: item.quantity,
      totals: [
        { type: "line_total", display_text: "Line total", amount: unitAmount * item.quantity },
      ],
    }
  })
}

// =====================================================
// Totals
// =====================================================

function computeSubtotal(cart: any): number {
  const items = cart.items || []
  if (items.length > 0) {
    return items.reduce((acc: number, item: any) => {
      const unit = item.unit_price ?? item.raw_unit_price?.value ?? 0
      return acc + unit * (item.quantity || 0)
    }, 0)
  }
  return cart.item_subtotal ?? cart.item_total ?? cart.subtotal ?? cart.raw_subtotal?.value ?? 0
}

function formatTotals(cart: any) {
  const totals: { type: string; display_text: string; amount: number }[] = []

  totals.push({ type: "subtotal", display_text: "Subtotal", amount: computeSubtotal(cart) })

  const shipping = cart.shipping_total ?? cart.raw_shipping_total?.value ?? 0
  if (shipping > 0) {
    totals.push({ type: "fulfillment", display_text: "Shipping", amount: shipping })
  }

  const tax = cart.tax_total ?? cart.raw_tax_total?.value ?? 0
  if (tax > 0) {
    totals.push({ type: "tax", display_text: "Tax", amount: tax })
  }

  const discount = cart.discount_total ?? cart.raw_discount_total?.value ?? 0
  if (discount > 0) {
    totals.push({ type: "discount", display_text: "Discount", amount: -discount })
  }

  totals.push({ type: "total", display_text: "Total", amount: cart.total ?? cart.raw_total?.value ?? 0 })

  return totals
}

// =====================================================
// Checkout Session
// =====================================================

export async function formatUcpCheckoutSession(
  ctx: UcpFormatterContext,
  cart: any,
  includePaymentHandlers: boolean = true
) {
  const currency = (cart.currency_code || "usd").toUpperCase()
  const status = resolveUcpStatus(cart)

  const createdAt = cart.created_at || cart.metadata?.checkout_session_created_at
  const expiresAt = createdAt
    ? new Date(new Date(createdAt as string).getTime() + 6 * 60 * 60 * 1000).toISOString()
    : undefined

  const shippingOptions = await listShippingOptionsSafe(
    (cart as any)._container,
    cart.id
  )

  const session: Record<string, unknown> = {
    ucp: ucpEnvelope(ctx, cart.metadata),
    id: cart.id,
    status,
    currency,
    line_items: formatLineItems(cart.items || []),
    totals: formatTotals(cart),
    messages: buildCheckoutMessages(ctx, cart, status),
    links: [
      { type: "terms_of_service", url: `${ctx.storefrontUrl}/terms` },
      { type: "privacy_policy", url: `${ctx.storefrontUrl}/privacy` },
    ],
  }

  if (cart.email || cart.shipping_address?.first_name || cart.shipping_address?.phone) {
    session.buyer = {
      ...(cart.shipping_address?.first_name ? { first_name: cart.shipping_address.first_name } : {}),
      ...(cart.shipping_address?.last_name ? { last_name: cart.shipping_address.last_name } : {}),
      ...(cart.email ? { email: cart.email } : {}),
      ...(cart.shipping_address?.phone ? { phone_number: cart.shipping_address.phone } : {}),
    }
  }

  if (cart.shipping_address?.address_1) {
    session.shipping_address = medusaToUcpAddress(cart.shipping_address)
  }

  const fulfillment = buildUcpFulfillment(cart, shippingOptions)
  if (fulfillment) session.fulfillment = fulfillment

  if (expiresAt) session.expires_at = expiresAt

  return session
}

// =====================================================
// Product
// =====================================================

/**
 * ISO 4217 minor-unit exponent for a currency, resolved dynamically via Intl
 * (no hardcoded table): USD→2, JPY→0, KWD→3, etc. Falls back to 2 for unknown
 * codes. Medusa stores amounts in MAJOR units (e.g. 100.00), UCP wants integer
 * minor units, so every amount is scaled by 10^exponent.
 */
function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** UCP Price: integer minor units + uppercase ISO 4217 currency (^[A-Z]{3}$). */
function ucpPrice(majorAmount: number | string, currency: string | undefined) {
  const cur = currency || "usd"
  const major = Number(majorAmount) || 0
  return {
    amount: Math.round(major * Math.pow(10, currencyExponent(cur))),
    currency: cur.toUpperCase(),
  }
}

/**
 * All non-price-list money amounts on a Medusa variant, one per currency,
 * deduped and converted to UCP minor-unit prices. This is the dynamic
 * multi-currency view — whatever currencies the merchant has priced in Medusa.
 */
function variantPrices(v: any): { amount: number; currency: string }[] {
  const seen = new Set<string>()
  const out: { amount: number; currency: string }[] = []
  for (const p of v.prices || []) {
    // Skip price-list (sale/override) rows — base prices only for the catalog.
    if (p.price_list_id) continue
    const code = p.currency_code
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push(ucpPrice(p.amount ?? p.raw_amount?.value ?? 0, code))
  }
  return out
}

export type ProductFormatOptions = {
  storefrontUrl?: string
  /** Presentment currency (uppercase ISO 4217) to select variant.price from. */
  currency?: string
}

export function formatUcpProduct(product: any, opts: ProductFormatOptions = {}) {
  const { storefrontUrl, currency: wanted } = opts
  const wantedUpper = wanted?.toUpperCase()

  const variants = (product.variants || []).map((v: any) => {
    const prices = variantPrices(v)

    // Selling price: region-calculated price wins (tax/price-list aware), else
    // the priced entry in the requested/presentment currency, else first.
    const calc = v.calculated_price
    const calculated = calc?.calculated_amount != null
      ? ucpPrice(calc.calculated_amount, calc.currency_code)
      : null
    const byCurrency = wantedUpper
      ? prices.find((p) => p.currency === wantedUpper)
      : undefined
    const price = calculated || byCurrency || prices[0] || null

    // Strikethrough / list price when the calculated original differs.
    const listPrice = calc?.original_amount != null && calc.original_amount !== calc.calculated_amount
      ? ucpPrice(calc.original_amount, calc.currency_code)
      : undefined

    return {
      id: v.id,
      title: v.title || "",
      // Spec: variant.description is required and MUST be an object with ≥1
      // format. Medusa variants carry none, so mirror the title.
      description: { plain: v.title || product.title || "" },
      sku: v.sku || null,
      price,
      ...(listPrice ? { list_price: listPrice } : {}),
      // Extension: every currency the merchant prices this variant in.
      ...(prices.length ? { prices } : {}),
      availability: {
        available: v.inventory_quantity != null ? v.inventory_quantity > 0 : true,
        status: v.inventory_quantity != null
          ? v.inventory_quantity > 0 ? "in_stock" : "out_of_stock"
          : "in_stock",
      },
    }
  })

  // Price range in the presentment currency (fall back to whatever price[0] is).
  const priced = variants.filter((v: any) => v.price != null)
  const rangeCurrency = wantedUpper && priced.some((v: any) => v.price.currency === wantedUpper)
    ? wantedUpper
    : priced[0]?.price?.currency
  const inRange = priced
    .map((v: any) =>
      v.price.currency === rangeCurrency
        ? v.price.amount
        : v.prices?.find((p: any) => p.currency === rangeCurrency)?.amount
    )
    .filter((a: any) => a != null) as number[]
  const priceRange = inRange.length > 0
    ? {
        min: { amount: Math.min(...inRange), currency: rangeCurrency },
        max: { amount: Math.max(...inRange), currency: rangeCurrency },
      }
    : null

  const media = (product.images || []).map((img: any) => ({ url: img.url, type: "image" as const }))
  if (product.thumbnail && !media.some((m: any) => m.url === product.thumbnail)) {
    media.unshift({ url: product.thumbnail, type: "image" as const })
  }

  const handle = product.handle || ""

  return {
    id: product.id,
    title: product.title || "",
    // Spec: description is a Description object ({ plain|html|markdown }), not a string.
    description: { plain: product.description || "" },
    handle,
    ...(storefrontUrl && handle ? { url: `${storefrontUrl}/products/${handle}` } : {}),
    // Spec: categories are Category objects keyed by `value`, not bare strings.
    categories: (product.categories || [])
      .map((c: any) => (c?.name ? { value: c.name } : null))
      .filter(Boolean),
    price_range: priceRange,
    variants,
    media,
  }
}

// =====================================================
// Order
// =====================================================

export function formatUcpOrder(ctx: UcpFormatterContext, order: any) {
  const currency = (order.currency_code || "usd").toUpperCase()

  const lineItems = (order.items || []).map((item: any) => {
    const unitAmount = item.unit_price ?? item.raw_unit_price?.value ?? 0
    return {
      id: item.id,
      item: {
        id: item.variant_id || item.variant?.id || item.id,
        title: item.title || item.product_title || "",
        price: unitAmount,
      },
      quantity: item.quantity,
      totals: [{ type: "line_total", display_text: "Line total", amount: unitAmount * item.quantity }],
    }
  })

  const fulfillmentEvents = (order.fulfillments || []).map((f: any) => ({
    type: f.shipped_at ? "shipped" : "created",
    timestamp: f.shipped_at || f.created_at,
    tracking_number: f.labels?.[0]?.tracking_number || null,
    carrier: f.provider?.id || null,
    items: (f.items || []).map((i: any) => ({
      product_id: i.line_item?.product_id || null,
      quantity: i.quantity,
    })),
  }))

  const result: Record<string, unknown> = {
    ucp: ucpEnvelope(ctx),
    id: order.id,
    display_id: order.display_id || null,
    checkout_id: order.cart_id || null,
    permalink_url: `${ctx.storefrontUrl}/orders/${order.id}`,
    status: order.status || "pending",
    currency,
    line_items: lineItems,
    totals: formatTotals(order),
    fulfillment_status: order.fulfillment_status || "not_fulfilled",
    fulfillment_events: fulfillmentEvents,
    created_at: order.created_at,
    updated_at: order.updated_at,
    links: [{ type: "self", url: `${ctx.baseUrl}/ucp/orders/${order.id}` }],
  }

  if (order.email) result.buyer = { email: order.email }
  if (order.shipping_address) result.shipping_address = medusaToUcpAddress(order.shipping_address)

  return result
}
