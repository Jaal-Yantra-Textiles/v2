import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPayuLink } from "../../api/admin/lib/create-payu-link"

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
}

const notLinked = (reason: string): PayuCartLink => ({
  payment_link: null,
  invoice_number: null,
  reason,
})

/**
 * Never throws. A missing payment link must not cost the caller the order it
 * just created, so every failure is a returned reason.
 */
export const createPayuLinkForCart = async (
  scope: any,
  cartId: string,
  opts?: { description?: string }
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

  const ba = cart.billing_address || {}
  const created = await createPayuLink(
    {
      amount: total,
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

  return {
    payment_link: created.payment_link,
    invoice_number: created.invoice_number,
    reason: null,
  }
}
