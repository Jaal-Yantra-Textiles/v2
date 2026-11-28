import {
  formatMoneyFor,
  paymentMethodWords,
  readAmount,
} from "../../workflows/email/workflows/order-confirmation-email-lib"

/**
 * What the `order-refunded` email says (#2645 "Refund email"). Pure, so every
 * money rule here is unit-tested.
 *
 * 🔴 Never read the buyer's position off `order.total` after a refund. Medusa
 * books a refund on a not-overpaid order as a CREDIT LINE, so the order total
 * DROPS by the refund and "total − paid" reads as nothing owed even when a
 * deposit order still has its balance to come. What the buyer paid is
 * captured − refunded on the payment collections; what they still owe comes
 * from the payment schedule (`total_due − net paid`), never from the order.
 */

export const ORDER_REFUNDED_TEMPLATE = "order-refunded"

/** Where the balance's due moment is described, by the schedule's trigger. */
export const BALANCE_WHEN_WORDS: Record<string, string> = {
  dispatch: "when your order ships",
  manual: "when your order is ready",
  sample_approved: "once you approve your sample",
}

export type RefundEmailVars = {
  customer_first_name: string
  order_display_id: string
  order_id: string
  order_email: string
  currency_code: string
  /** The refund this email is about, formatted. */
  refund_amount: string
  /** The admin's explanation, verbatim. Null renders no note block. */
  note: string | null
  /** Everything captured on the order, before refunds. Null when unreadable. */
  paid_total: string | null
  /** Every refund on the order so far, including this one. */
  refunded_total: string | null
  /** What the buyer has paid and kept with us: captured − refunded. */
  net_paid: string | null
  /** How the money came in, in buyer words ("UPI via PayU"). */
  payment_method: string | null
  /**
   * Bitcoin only: the BTCPay claim link. A Bitcoin refund sends nothing until
   * the buyer opens it and gives an address, so the email must say "claim",
   * not "we've sent". Null for every other payment method.
   */
  bitcoin_claim_link: string | null
  /** Still owed on a deposit order. Null when nothing is owed. */
  balance_due: string | null
  /** "when your order ships" … — set only with balance_due. */
  balance_when: string | null
  /** The balance has already been raised: a pay link is out. */
  balance_due_now: boolean
  balance_link: string | null
  /** Nothing more to pay. */
  paid_in_full: boolean
  partner_name: string
  business_url: string
  current_year: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Captured and refunded across every collection on the order. */
export const paymentTotals = (order: any): { captured: number; refunded: number } => {
  const collections: any[] = Array.isArray(order?.payment_collections)
    ? order.payment_collections
    : []
  let captured = 0
  let refunded = 0
  for (const c of collections) {
    const payments: any[] = Array.isArray(c?.payments) ? c.payments : []
    // Prefer the payment rows (captures/refunds) — the collection's rolled-up
    // figures lag a refund made through the payment module directly.
    const pc = payments.reduce(
      (s, p) =>
        s +
        (Array.isArray(p?.captures)
          ? p.captures.reduce((a: number, x: any) => a + (readAmount(x?.amount) ?? 0), 0)
          : 0),
      0
    )
    const pr = payments.reduce(
      (s, p) =>
        s +
        (Array.isArray(p?.refunds)
          ? p.refunds.reduce((a: number, x: any) => a + (readAmount(x?.amount) ?? 0), 0)
          : 0),
      0
    )
    captured += Math.max(pc, readAmount(c?.captured_amount) ?? 0)
    refunded += Math.max(pr, readAmount(c?.refunded_amount) ?? 0)
  }
  return { captured: round2(captured), refunded: round2(refunded) }
}

/** Every refund row on the order, newest first. */
export const orderRefunds = (
  order: any
): Array<{ id: string; amount: number; created_at: string | null; payment_id: string | null }> => {
  const out: Array<{ id: string; amount: number; created_at: string | null; payment_id: string | null }> = []
  for (const c of order?.payment_collections ?? []) {
    for (const p of c?.payments ?? []) {
      for (const r of p?.refunds ?? []) {
        const amount = readAmount(r?.amount)
        if (!r?.id || amount === null) continue
        out.push({
          id: r.id,
          amount,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
          payment_id: p?.id ?? null,
        })
      }
    }
  }
  return out.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
}

/**
 * What the buyer still owes and when. Only a payment schedule can say so: an
 * order without one was paid in full (see `describeOrderBalance`).
 */
export const refundBalance = (
  schedule: any,
  netPaid: number
): { amount: number | null; when: string | null; due_now: boolean; link: string | null } => {
  const none = { amount: null, when: null, due_now: false, link: null }
  if (!schedule) return none
  const status = String(schedule.balance_status ?? "")
  if (status === "paid" || status === "waived") return none
  const totalDue = readAmount(schedule.total_due)
  const scheduled = readAmount(schedule.balance_amount)
  const owed = totalDue !== null ? round2(totalDue - netPaid) : scheduled
  if (owed === null || owed <= 0.009) return none
  const trigger = String(schedule.balance_trigger ?? "dispatch")
  const dueNow = status === "due"
  return {
    amount: owed,
    when: dueNow ? null : BALANCE_WHEN_WORDS[trigger] ?? BALANCE_WHEN_WORDS.dispatch,
    due_now: dueNow,
    link: dueNow ? schedule.balance_link_ref ?? null : null,
  }
}

const firstNameOf = (order: any): string =>
  String(
    order?.customer?.first_name ||
      order?.shipping_address?.first_name ||
      order?.billing_address?.first_name ||
      (order?.email ? String(order.email).split("@")[0] : "") ||
      "there"
  ).trim()

export function buildRefundEmailVars(input: {
  order: any
  schedule?: any | null
  refund_amount: number
  note?: string | null
  partner_name?: string | null
  business_url?: string
  bitcoin_claim_link?: string | null
  now?: Date
}): RefundEmailVars {
  const { order } = input
  const currency = String(order?.currency_code || "INR").toLowerCase()
  const money = formatMoneyFor(currency)
  const { captured, refunded } = paymentTotals(order)
  const netPaid = round2(captured - refunded)
  const balance = refundBalance(input.schedule ?? null, netPaid)
  const firstPayment =
    (order?.payment_collections ?? []).flatMap((c: any) => c?.payments ?? [])[0] ?? null
  const note = String(input.note ?? "").trim() || null

  return {
    customer_first_name: firstNameOf(order),
    order_display_id: order?.display_id ? `#${order.display_id}` : order?.id || "",
    order_id: order?.id || "",
    order_email: order?.email || "",
    currency_code: currency,
    refund_amount: money(round2(input.refund_amount)),
    note,
    paid_total: captured > 0 ? money(captured) : null,
    refunded_total: refunded > 0 ? money(refunded) : null,
    net_paid: captured > 0 ? money(Math.max(netPaid, 0)) : null,
    payment_method: paymentMethodWords(firstPayment),
    bitcoin_claim_link: /^https:\/\//i.test(String(input.bitcoin_claim_link || "")) ? String(input.bitcoin_claim_link) : null,
    balance_due: balance.amount !== null ? money(balance.amount) : null,
    balance_when: balance.when,
    balance_due_now: balance.due_now,
    balance_link: balance.link,
    paid_in_full: balance.amount === null,
    partner_name: String(input.partner_name ?? ""),
    business_url: input.business_url ?? "https://jaalyantra.com",
    current_year: String((input.now ?? new Date()).getFullYear()),
  }
}

// ---------------------------------------------------------------------------
// Idempotency: one automatic email per refund id, stamped on order metadata.
// ---------------------------------------------------------------------------

export const REFUND_EMAILS_METADATA_KEY = "refund_emails_sent"

export type RefundEmailStamp = { refund_id: string; sent_at: string; source: "auto" | "manual" }

export const refundEmailStamps = (metadata: any): RefundEmailStamp[] => {
  const raw = metadata?.[REFUND_EMAILS_METADATA_KEY]
  return Array.isArray(raw) ? raw.filter((s: any) => s && typeof s.refund_id === "string") : []
}

export const wasRefundEmailed = (metadata: any, refundId: string | null | undefined): boolean =>
  Boolean(refundId) && refundEmailStamps(metadata).some((s) => s.refund_id === refundId)

/** The order's metadata with this refund stamped; unchanged if already there. */
export const stampRefundEmail = (
  metadata: any,
  stamp: RefundEmailStamp
): Record<string, any> => {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {}
  if (wasRefundEmailed(base, stamp.refund_id)) return base
  base[REFUND_EMAILS_METADATA_KEY] = [...refundEmailStamps(base), stamp]
  return base
}

/**
 * The BTCPay claim link for a Bitcoin refund of `amount`: the newest entry in
 * the payment's `btcpay_refunds` with that amount (the provider appends one per
 * refund), else the newest entry. Null when the order has no Bitcoin payment.
 */
export function bitcoinClaimLinkFor(order: any, amount: number): string | null {
  const payments = (order?.payment_collections ?? [])
    .flatMap((c: any) => c?.payments ?? [])
    .filter((p: any) => String(p?.provider_id || "").startsWith("pp_bitcoin"))
  const entries: any[] = payments.flatMap((p: any) =>
    Array.isArray(p?.data?.btcpay_refunds) ? p.data.btcpay_refunds : []
  )
  if (!entries.length) return null
  const newestFirst = [...entries].sort((a, b) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")))
  const match = newestFirst.find((e) => Math.abs(Number(e?.amount) - Number(amount)) < 0.005) ?? newestFirst[0]
  return match?.link ? String(match.link) : null
}
