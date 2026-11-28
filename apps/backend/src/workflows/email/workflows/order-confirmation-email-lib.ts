/**
 * What the `order-placed` confirmation shows beyond the total (#2578): the
 * pieces, what was paid and how, and how the order will reach the buyer.
 *
 * The email used to carry only a name, an order number, an item count and a
 * total — a buyer could not see what they had bought or whether anything was
 * still owed. Pure functions, so every rule here is unit-tested.
 *
 * 🔴 Money rule (same as the design-order email): an amount that cannot be
 * read is left OUT, never rendered as ₹0.00 — `Number(null)` is 0.
 */

export const formatMoneyFor =
  (currency: string | null | undefined) =>
  (amount: number): string => {
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: String(currency || "INR").toUpperCase(),
      }).format(amount)
    } catch {
      return `${amount.toFixed(2)} ${String(currency || "").toUpperCase()}`.trim()
    }
  }

/** A real number, or null for null/undefined/""/NaN. Never turns null into 0. */
export const readAmount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const raw = typeof v === "object" && v !== null && "value" in (v as any) ? (v as any).value : v
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export type ConfirmationLine = {
  title: string
  variant: string | null
  thumbnail: string | null
  quantity: number
  unit_price: string
  line_total: string
}

export const confirmationLines = (items: unknown, currency: string | null | undefined): ConfirmationLine[] => {
  if (!Array.isArray(items)) return []
  const money = formatMoneyFor(currency)
  const out: ConfirmationLine[] = []
  for (const li of items as any[]) {
    const unit = readAmount(li?.unit_price)
    const qty = readAmount(li?.quantity) ?? 1
    if (unit === null || qty <= 0) continue
    // The line's own total includes its tax; fall back to unit × qty.
    const subtotal = readAmount(li?.subtotal) ?? unit * qty
    const variant = String(li?.variant_title ?? "").trim()
    out.push({
      title: String(li?.product_title || li?.title || "").trim() || "Your piece",
      variant: variant && variant.toLowerCase() !== "default" ? variant : null,
      thumbnail:
        typeof li?.thumbnail === "string" && /^https?:\/\//.test(li.thumbnail) ? li.thumbnail : null,
      quantity: qty,
      unit_price: money(unit),
      line_total: money(subtotal),
    })
  }
  return out
}

/** Totals rows, each present only when it is a real, non-zero amount. */
export const confirmationTotals = (order: any) => {
  const money = formatMoneyFor(order?.currency_code)
  const row = (v: unknown) => {
    const n = readAmount(v)
    return n !== null && n > 0 ? money(n) : null
  }
  return {
    subtotal: row(order?.item_subtotal ?? order?.subtotal),
    shipping_total: row(order?.shipping_total),
    tax_total: row(order?.tax_total),
    discount_total: row(order?.discount_total),
  }
}

const METHOD_WORDS: Record<string, string> = {
  UPI: "UPI",
  CC: "credit card",
  DC: "debit card",
  NB: "net banking",
  EMI: "EMI",
  CASH: "wallet",
  BNPL: "pay later",
}

/** "UPI via PayU", "card via Stripe", "bank transfer" … from the first payment. */
export const paymentMethodWords = (payment: any): string | null => {
  if (!payment) return null
  const provider = String(payment?.provider_id || "").toLowerCase()
  if (provider.includes("payu")) {
    const mode = String(payment?.data?.mode || "").toUpperCase()
    return METHOD_WORDS[mode] ? `${METHOD_WORDS[mode]} via PayU` : "PayU"
  }
  if (provider.includes("stripe")) return "card via Stripe"
  if (provider.startsWith("pp_bitcoin")) return "Bitcoin"
  if (provider.includes("system_default") || provider.includes("manual")) return "bank transfer"
  return null
}

const isManualProvider = (id: unknown) => {
  const p = String(id || "").toLowerCase()
  return p.includes("system_default") || p.includes("manual")
}

/** Every payment in the collection is the cash / manual provider. */
export const isManualOnlyCollection = (c: any): boolean => {
  const payments: any[] = Array.isArray(c?.payments) ? c.payments : []
  return payments.length > 0 && payments.every((p) => isManualProvider(p?.provider_id))
}

/**
 * What a cancellation must give back: money actually CAPTURED, less any
 * refund already made. An authorization (a card hold, or a COD order that
 * was never paid) is released, not refunded. Null when nothing is owed back.
 */
export const cancellationRefund = (order: any): string | null => {
  const money = formatMoneyFor(order?.currency_code)
  const collections: any[] = Array.isArray(order?.payment_collections) ? order.payment_collections : []
  const owed = collections.reduce(
    (sum, c) => sum + (readAmount(c?.captured_amount) ?? 0) - (readAmount(c?.refunded_amount) ?? 0),
    0
  )
  return owed > 0.009 ? money(Math.round(owed * 100) / 100) : null
}

export type ConfirmationPayment = {
  /** What we hold for this order (captured, or authorised and about to be). */
  paid: string | null
  method: string | null
  /** Still owed — a deposit order's balance. Null when nothing is due. */
  balance_due: string | null
  paid_in_full: boolean
}

export const confirmationPayment = (order: any): ConfirmationPayment => {
  const money = formatMoneyFor(order?.currency_code)
  const collections: any[] = Array.isArray(order?.payment_collections) ? order.payment_collections : []
  const held = collections.reduce((sum, c) => {
    const captured = readAmount(c?.captured_amount) ?? 0
    const authorized = readAmount(c?.authorized_amount) ?? 0
    // 🔴 A cash / manual payment is AUTHORIZED at checkout though nobody has
    // paid (COD): only what was captured is money. A card hold (Stripe/PayU)
    // is about to be captured, so it still counts.
    return sum + (isManualOnlyCollection(c) ? captured : Math.max(captured, authorized))
  }, 0)
  const summaryPaid = readAmount(order?.summary?.paid_total) ?? 0
  const paid = Math.max(held, summaryPaid)

  const total = readAmount(order?.total)
  const firstPayment = collections.flatMap((c) => c?.payments ?? [])[0] ?? null
  const balance = total !== null ? Math.round((total - paid) * 100) / 100 : null

  const unpaidCash =
    paid <= 0 && collections.some((c) => isManualOnlyCollection(c))
  return {
    paid: paid > 0 ? money(paid) : null,
    method: unpaidCash ? "cash on delivery" : paymentMethodWords(firstPayment),
    balance_due: balance !== null && balance > 0.009 ? money(balance) : null,
    paid_in_full: total !== null && paid > 0 && balance !== null && balance <= 0.009,
  }
}

export type ConfirmationDelivery = {
  /** "Standard shipping", "Pickup at Dharamshala" … */
  method: string | null
  /** Address as display lines, no blanks. */
  address_lines: string[]
  /** Every line is made for this buyer (a design), so it ships after making. */
  made_to_order: boolean
}

export const confirmationDelivery = (order: any): ConfirmationDelivery => {
  const methods: any[] = Array.isArray(order?.shipping_methods) ? order.shipping_methods : []
  const method = String(methods[0]?.name || "").trim() || null
  const a = order?.shipping_address || {}
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ").trim()
  const cityLine = [a.city, a.province, a.postal_code].filter(Boolean).join(", ")
  const lines = [name, a.company, a.address_1, a.address_2, cityLine, a.country_code ? String(a.country_code).toUpperCase() : ""]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
  // A country alone is not an address worth printing.
  const address_lines = lines.length > 1 ? lines : []
  const items: any[] = Array.isArray(order?.items) ? order.items : []
  const made_to_order =
    items.length > 0 && items.every((li) => Boolean(li?.metadata?.design_id))
  return { method, address_lines, made_to_order }
}

/**
 * The flat variables every customer order email shares (#2578): who, which
 * order, what, and the money. The confirmation adds partner branding on top;
 * the cancellation adds what will be refunded.
 */
export const orderEmailBasics = (order: any) => {
  const money = formatMoneyFor(order?.currency_code)
  const items: any[] = Array.isArray(order?.items) ? order.items : []
  const total = readAmount(order?.total)
  const firstName =
    order?.shipping_address?.first_name ||
    order?.billing_address?.first_name ||
    (order?.email ? String(order.email).split("@")[0] : "") ||
    "there"
  return {
    customer_first_name: firstName,
    order_display_id: order?.display_id ? `#${order.display_id}` : order?.id || "",
    order_id: order?.id || "",
    order_email: order?.email || "",
    order_total: total !== null ? money(total) : "",
    item_count: String(items.length),
    items: confirmationLines(items, order?.currency_code),
    ...confirmationTotals(order),
    payment: confirmationPayment(order),
    delivery: confirmationDelivery(order),
    current_year: String(new Date().getFullYear()),
  }
}
