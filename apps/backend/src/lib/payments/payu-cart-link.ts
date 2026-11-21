import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createPayuLink } from "../../api/admin/lib/create-payu-link"
import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { planCartCollection } from "./deposit-collection"
import { deactivatePayuLink } from "./payu-link-admin"
import {
  formatExpiryForBuyer,
  PAYU_LINK_METADATA_KEY,
  payuLinkTtlHours,
  readTrackedLink,
  toPayuIstDateTime,
  type TrackedPayuLink,
} from "./payu-link-expiry"

/**
 * A shareable PayU payment link for an existing cart.
 *
 * ## Why a PayU link is not a second way to pay
 *
 * It looked like one. It is not: `createPayuLink` puts the cart id in `udf1`,
 * and `processPayuLinkWebhook` re-verifies the txn with PayU and then runs
 * `completeCartFromExternalPayment` on **that same cart** — the identical end
 * state as a storefront checkout, order and all. The amount comes off the cart,
 * where `is_custom_price` already pinned it, so the link cannot quote a number
 * the cart disagrees with.
 *
 * ## 🔴 INR only
 *
 * PayU settles in INR. `POST /store/payu/payment-link` only *warns* on a
 * non-INR cart and builds the link anyway, which would present a ₹ amount for a
 * €150 cart. Here a non-INR cart gets no PayU link and says so — the storefront
 * checkout link is the answer for those, and it already works.
 */

export type PayuCartLink = {
  payment_link: string | null
  invoice_number: string | null
  /** Plain words for a human. Null on success. */
  reason: string | null
  /** ISO instant the link stops working (#2564). Null when no link. */
  expires_at?: string | null
  /** The same instant in buyer words, IST. Null when no link. */
  expires_label?: string | null
  /** Invoice number of the previous link we switched off, if any. */
  replaced_invoice_number?: string | null
}

const notLinked = (reason: string): PayuCartLink => ({
  payment_link: null,
  invoice_number: null,
  reason,
  expires_at: null,
  expires_label: null,
  replaced_invoice_number: null,
})

/**
 * Never throws. A missing payment link must not cost the caller the order it
 * just created, so every failure is a returned reason.
 */
export const createPayuLinkForCart = async (
  scope: any,
  cartId: string,
  opts?: { description?: string; now?: Date }
): Promise<PayuCartLink> => {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

  let cart: any = null
  try {
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "currency_code",
        "total",
        "metadata",
        "billing_address.first_name",
        "billing_address.last_name",
        "billing_address.phone",
        "shipping_address.phone",
      ],
      filters: { id: cartId },
    })
    cart = data?.[0] ?? null
  } catch (e: any) {
    logger?.warn?.(`[payu-cart-link] cart lookup failed for ${cartId}: ${e?.message ?? e}`)
    return notLinked("Could not read the cart, so no payment link was created.")
  }

  if (!cart) {
    return notLinked("Could not read the cart, so no payment link was created.")
  }

  const currency = String(cart.currency_code ?? "").toLowerCase()
  if (currency !== "inr") {
    return notLinked(
      `PayU settles in INR and this order is in ${currency.toUpperCase() || "an unknown currency"}. Share the checkout link instead.`
    )
  }

  const total = Number(cart.total)
  if (!Number.isFinite(total) || total <= 0) {
    return notLinked(
      "The order total is not a positive amount yet, so a payment link would ask for nothing."
    )
  }

  /**
   * 🔴 What is due NOW, not the cart total. A quote cart with a payment
   * schedule owes its DEPOSIT now (#1451); this link used `cart.total` and so
   * asked a 10%-deposit buyer for 100%. Same planner as the storefront's
   * collection, so the link and the checkout cannot disagree.
   */
  let amount = total
  try {
    const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByCartId(cartId)
    const plan = planCartCollection({
      cartTotal: total,
      cartCurrency: currency,
      schedule,
    })
    if (plan.basis === "refuse") return notLinked(plan.reason)
    amount = plan.amount
  } catch (e: any) {
    logger?.warn?.(`[payu-cart-link] could not plan the amount for ${cartId}: ${e?.message ?? e}`)
    return notLinked("Could not work out what is due on this cart, so no payment link was created.")
  }

  /**
   * 🔴 #2564 — every link now expires. Without `expiryDate` PayU keeps a link
   * open for 365 days, at the price it was minted with.
   */
  const now = opts?.now ?? new Date()
  const expiresAt = new Date(now.getTime() + payuLinkTtlHours() * 3600 * 1000)

  const ba = cart.billing_address || {}
  const created = await createPayuLink(
    {
      amount,
      expiryDate: toPayuIstDateTime(expiresAt),
      description: opts?.description || `Order ${cartId}`,
      customer: {
        name: [ba.first_name, ba.last_name].filter(Boolean).join(" ") || undefined,
        email: cart.email || undefined,
        mobileNumber: ba.phone || cart.shipping_address?.phone || undefined,
      },
      // → udf1, so the webhook completes THIS cart.
      reference: cartId,
    } as any,
    logger
  )

  if (!created.payment_link) {
    return notLinked(
      created.error
        ? `PayU did not return a payment link: ${created.error}`
        : "PayU did not return a payment link."
    )
  }

  /**
   * Track the new link and switch the previous one off (#2564). A buyer must
   * never hold two payable links for one cart — the older one quotes an older
   * total. Best-effort: a failure here is logged loudly but does not cost the
   * caller the link it just got; the sweep job retries closing the old link
   * only through this record, so the record is written regardless.
   */
  const previous = readTrackedLink(cart.metadata)
  let replaced: string | null = null
  if (previous && !previous.closed_at && previous.invoice_number !== created.invoice_number) {
    const off = await deactivatePayuLink(previous.invoice_number)
    if (off.ok) {
      replaced = previous.invoice_number
    } else {
      logger?.error?.(
        `[payu-cart-link] could NOT switch off previous link ${previous.invoice_number} ` +
          `on cart ${cartId}: ${off.error}. It stays payable until PayU's own expiry — close it in the PayU dashboard.`
      )
    }
  }

  const tracked: TrackedPayuLink = {
    invoice_number: String(created.invoice_number ?? ""),
    url: created.payment_link,
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
    closed_at: null,
    closed_reason: null,
    expiry_notified_at: null,
  }
  try {
    const cartService: any = scope.resolve(Modules.CART)
    await cartService.updateCarts(cartId, {
      metadata: { ...(cart.metadata ?? {}), [PAYU_LINK_METADATA_KEY]: tracked },
    })
  } catch (e: any) {
    logger?.error?.(
      `[payu-cart-link] link ${created.invoice_number} minted but NOT tracked on cart ${cartId}: ` +
        `${e?.message ?? e}. The expiry job will not see it.`
    )
  }

  return {
    payment_link: created.payment_link,
    invoice_number: created.invoice_number,
    reason: null,
    expires_at: tracked.expires_at,
    expires_label: formatExpiryForBuyer(expiresAt),
    replaced_invoice_number: replaced,
  }
}
