import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../../lib/bot-recipients"
import { planCartCollection } from "../../lib/payments/deposit-collection"
import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { sendDesignOrderCreatedEmailWorkflow } from "../email/workflows/send-design-order-created-email"
import { loadAwaitingMaterials } from "./lib/awaiting-materials"

/**
 * Send a freshly created design order's link to its buyer, and say honestly
 * whether it went.
 *
 * ## Why this never throws
 *
 * 🔴 The create route has already committed a cart with real prices on it. A
 * delivery failure that became a 500 would destroy the response — and with it
 * the only place the operator is shown the checkout link — for an order that
 * exists regardless. So every failure is a returned verdict, logged at error,
 * and the panel tells the human to send the link by hand. Exactly the contract
 * `deliverQuoteEmail` follows, and for the same reason.
 *
 * ## The suppression trap
 *
 * Every provider silently returns `BOT_SUPPRESSED_SEND_ID` for a known crawler
 * address without mailing anything (#1333). Reporting that as delivered would
 * tell the operator the buyer has their link when nothing was sent, so it is
 * treated as a failure here — "we chose not to mail this" and "the buyer has
 * their link" must not collapse into the same true.
 */
export type EmailLineItem = {
  title: string
  thumbnail: string | null
  quantity: number
  unit_price: number
  line_total: number
}

/**
 * The cart's lines as the email shows them (#2576). A line with no readable
 * price is dropped rather than shown as ₹0.00 — the same rule as the total:
 * a silent wrong number is worse than a missing row. Only http(s) pictures
 * are kept; a data: URL is stripped by Gmail and Outlook anyway.
 */
export const emailLineItems = (raw: unknown): EmailLineItem[] => {
  if (!Array.isArray(raw)) return []
  const out: EmailLineItem[] = []
  for (const li of raw as any[]) {
    // 🔴 Number(null) is 0 — an absent price must not become "₹0.00".
    if (li?.unit_price === null || li?.unit_price === undefined || li?.unit_price === "") continue
    const unit = Number(li.unit_price)
    const qty = Number(li?.quantity ?? 1)
    if (!Number.isFinite(unit) || !Number.isFinite(qty) || qty <= 0) continue
    const thumb = typeof li?.thumbnail === "string" && /^https?:\/\//.test(li.thumbnail) ? li.thumbnail : null
    out.push({
      title: String(li?.title ?? "").trim() || "Your piece",
      thumbnail: thumb,
      quantity: qty,
      unit_price: unit,
      line_total: Math.round(unit * qty * 100) / 100,
    })
  }
  return out
}

/**
 * The deposit section of the email (#2645): what is due NOW, the balance and
 * when it is asked for. `null` when the cart has no deposit (pay in full).
 */
export type EmailDeposit = {
  /** Due now — the same figure the PayU link and checkout charge. */
  amount: number
  /** Null for a fixed-amount deposit. */
  deposit_pct: number | null
  balance_amount: number
  balance_trigger: string
  /** Buyer words: "when your order is ready — we'll email you a payment link". */
  balance_when: string
}

export const balanceWhen = (trigger: unknown): string =>
  trigger === "dispatch"
    ? "when your order is ready to ship — we'll email you a payment link"
    : "when your order is ready — we'll email you a payment link"

/**
 * PURE. The deposit figures the buyer is told, from the SAME planner the
 * PayU link and checkout use (`planCartCollection`), so the email cannot quote
 * a deposit the link does not charge. The balance is the remainder
 * (`total − deposit`, to the cent), never a second percentage.
 *
 * - no schedule → `{ deposit: null }` (an ordinary pay-in-full order).
 * - a deposit that equals the total → `{ deposit: null }` (nothing later).
 * - a refused plan → `{ refused: reason }`: the caller must NOT send an email
 *   quoting the full total for a deposit order.
 */
export const emailDeposit = (input: {
  schedule: any
  total: number
  currencyCode?: string | null
}): { deposit: EmailDeposit | null; refused?: string } => {
  if (!input.schedule) return { deposit: null }
  const plan = planCartCollection({
    cartTotal: input.total,
    cartCurrency: input.currencyCode ?? null,
    schedule: input.schedule,
  })
  if (plan.basis === "refuse") return { deposit: null, refused: plan.reason }
  if (plan.basis !== "deposit") return { deposit: null }
  const amount = Number(plan.amount)
  const balance = Math.round((input.total - amount) * 100) / 100
  if (!(balance > 0)) return { deposit: null }
  const pct = input.schedule.deposit_pct
  return {
    deposit: {
      amount,
      deposit_pct: pct === null || pct === undefined ? null : Number(pct),
      balance_amount: balance,
      balance_trigger: String(input.schedule.balance_trigger ?? "manual"),
      balance_when: balanceWhen(input.schedule.balance_trigger),
    },
  }
}

/** Public URL of the PayU-link QR image for a cart (#2564). */
export const payQrUrl = (cartId: string): string =>
  `${(process.env.MEDUSA_BACKEND_URL || "https://v3.jaalyantra.com").replace(/\/+$/, "")}` +
  `/r/cart/${encodeURIComponent(cartId)}/pay-qr`

export type DesignOrderEmailDelivery = {
  /** True only when a provider accepted a real message. */
  sent: boolean
  /** The address it was addressed to, whether or not it went. */
  to: string | null
  /** Why it did not go. Null on success. Shown to a human, so plain words. */
  reason: string | null
}

export const deliverDesignOrderEmail = async (
  scope: any,
  input: {
    cart: any
    checkoutUrl: string | null
    paymentLink?: string | null
    /** Buyer-words expiry of `paymentLink`, e.g. "Mon 23 Nov 2026, 6:30 pm IST" (#2564). */
    paymentLinkExpiresLabel?: string | null
    /** #2572 — "upi" when the QR is a UPI intent any UPI app pays, else "link". */
    paymentQrKind?: "upi" | "link" | null
  }
): Promise<DesignOrderEmailDelivery> => {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

  /**
   * 🔴 The cart handed in by `createDraftOrderFromDesignsWorkflow` is the row
   * returned by `createCarts` — created BEFORE `addLineItems` ran. It has no
   * `total` and no `items`. Trusting it emailed the buyer
   *
   *     "Your order is ready — null piece(s), ₹0.00"
   *
   * because `formatMoney` turns an absent amount into a formatted ZERO rather
   * than into nothing. So the money is read back from the cart, never taken
   * from the object the caller happens to hold.
   */
  let fresh: any = null
  try {
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "currency_code",
        "total",
        "tax_total",
        "items.id",
        "items.title",
        "items.thumbnail",
        "items.quantity",
        "items.unit_price",
        "items.metadata",
      ],
      filters: { id: input.cart?.id },
    })
    fresh = data?.[0] ?? null
  } catch (e: any) {
    logger?.warn?.(
      `[design-order] totals lookup failed for cart ${input.cart?.id}: ${e?.message ?? e}`
    )
  }

  const cart = fresh ?? input.cart
  const to = String(cart?.email ?? input.cart?.email ?? "").trim() || null

  const fail = (reason: string): DesignOrderEmailDelivery => {
    logger?.error?.(
      `[design-order] email NOT delivered cart=${cart?.id} to=${to ?? "—"}: ${reason}`
    )
    return { sent: false, to, reason }
  }

  /**
   * A design order with no buyer attached is ORDINARY here (#1817) — the
   * customer is attached later, or collected at checkout. So this is logged as
   * information, not as an error: there is nobody to mail yet, and that is not
   * a fault to report to anyone.
   */
  if (!to) {
    logger?.info?.(
      `[design-order] no buyer email on cart=${cart?.id}; nothing to send yet.`
    )
    return {
      sent: false,
      to: null,
      reason:
        "No buyer is attached yet, so there was nobody to email. Attach a customer from the order, or share the link yourself.",
    }
  }

  /**
   * An email without the link is worse than no email: it tells the buyer an
   * order exists and gives them no way to pay for it.
   */
  if (!input.checkoutUrl) {
    return fail(
      "there is no checkout link to send — we could not work out which storefront this order belongs to."
    )
  }

  /**
   * 🔴 No total, no email. `formatMoney` renders an absent amount as a
   * well-formed ZERO — "₹0.00" — which reads to a buyer as a real price rather
   * than as missing data. A silent wrong number is worse than a missing mail
   * the operator can see failed and send by hand.
   */
  const total = Number(cart?.total)
  if (!Number.isFinite(total) || total <= 0) {
    return fail(
      "the order total could not be read, and an email quoting a zero price is worse than none. Send the link by hand."
    )
  }

  /**
   * #2645 — a deposit order's email says what is due NOW. Read failures fail
   * the send (closed): an email quoting the full total on a deposit order is
   * #176's overcharge in writing.
   */
  let deposit: EmailDeposit | null = null
  try {
    const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByCartId(cart?.id)
    const planned = emailDeposit({ schedule, total, currencyCode: cart?.currency_code })
    if (planned.refused) {
      return fail(
        `the order's deposit cannot be charged as set (${planned.refused}), so an email would quote the wrong amount.`
      )
    }
    deposit = planned.deposit
  } catch (e: any) {
    return fail(
      `could not read the order's deposit (${e?.message ?? e}), and an email that might quote the full total on a deposit order is worse than none.`
    )
  }

  const itemCount = Array.isArray(cart?.items) ? cart.items.length : null
  const items = emailLineItems(cart?.items)
  const taxTotal = Number(cart?.tax_total)

  /**
   * "Your fabric is being made by hand" (#2626) — shown only when a design on
   * this order has a run held on cloth that has not been delivered. The section
   * is extra; a failed read leaves it out and the order email goes as usual.
   */
  const orderDesigns = (Array.isArray(cart?.items) ? cart.items : [])
    .map((li: any) => ({
      id: String(li?.metadata?.design_id ?? "").trim(),
      title: String(li?.title ?? "").trim() || "Your piece",
    }))
    .filter((d: { id: string }) => d.id)
  const awaitingMaterials = await loadAwaitingMaterials(scope, orderDesigns)

  try {
    const { result } = await sendDesignOrderCreatedEmailWorkflow(scope).run({
      input: {
        to,
        data: {
          cart_id: cart?.id ?? null,
          checkout_url: input.checkoutUrl,
          payment_link: input.paymentLink ?? null,
          // #2564 — a scannable QR of the PayU link, drawn by /r/cart/:id/pay-qr,
          // and when the link stops working. Only with a link.
          payment_qr_url:
            input.paymentLink && cart?.id ? payQrUrl(cart.id) : null,
          // #2572 — lets the template say "any UPI app" only when it is true.
          payment_qr_kind: input.paymentLink ? input.paymentQrKind ?? "link" : null,
          // A plain boolean for `{{#if}}` — Handlebars cannot compare strings.
          payment_qr_is_upi: Boolean(input.paymentLink) && input.paymentQrKind === "upi",
          payment_link_expires_at: input.paymentLink
            ? input.paymentLinkExpiresLabel ?? null
            : null,
          currency_code: cart?.currency_code ?? null,
          total,
          // #2645 — null for pay-in-full; `{{#if deposit}}` in the template.
          deposit,
          item_count: itemCount,
          // What the buyer is paying for, one row per design (#2576).
          items,
          // Shown only when GST is on the cart (design-order prices are
          // GST-exclusive, so the lines alone would not add up to the total).
          tax_total: Number.isFinite(taxTotal) && taxTotal > 0 ? taxTotal : null,
          // #2626 — a plain boolean for `{{#if}}`, and the pieces waiting on cloth.
          awaiting_materials: awaitingMaterials.length > 0,
          awaiting_materials_lines: awaitingMaterials.map((l) => ({
            design: l.design,
            suppliers: l.suppliers.join(" and ") || null,
            maker: l.maker,
          })),
          current_year: `${new Date().getFullYear()}`,
        },
      },
    })

    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      return fail(
        "the recipient is a known crawler address and mail to it is suppressed."
      )
    }

    logger?.info?.(`[design-order] link emailed cart=${cart?.id} to=${to}`)
    return { sent: true, to, reason: null }
  } catch (e: any) {
    /**
     * The commonest cause is a missing `design-order-created` template row —
     * `fetchEmailTemplateStep` throws rather than sending a generic shell. The
     * message is surfaced as-is so the operator can see which it was.
     */
    return fail(e?.message ?? String(e))
  }
}
