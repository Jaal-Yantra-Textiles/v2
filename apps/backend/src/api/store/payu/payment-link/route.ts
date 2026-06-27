import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  buildPaymentLinkBody,
  oneapiHosts,
  parsePaymentLinkResponse,
  type PaymentLinkInput,
} from "./lib"

/**
 * POST /store/payu/payment-link
 * Create a shareable PayU payment link (OneAPI / OAuth). Returns a
 * `https://v.payu.in/…` URL whose checkout offers UPI + cards. Either pass
 * `amount` (+ optional customer) directly, or `cart_id` to derive the amount and
 * customer from the cart.
 *
 * Requires env: PAYU_CLIENT_ID, PAYU_CLIENT_SECRET, PAYU_MERCHANT_ID
 * (+ optional PAYU_ONEAPI_MODE = test|prod, default test).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const clientId = process.env.PAYU_CLIENT_ID
  const clientSecret = process.env.PAYU_CLIENT_SECRET
  const merchantId = process.env.PAYU_MERCHANT_ID
  if (!clientId || !clientSecret || !merchantId) {
    return res.status(400).json({
      message:
        "PayU OneAPI is not configured. Set PAYU_CLIENT_ID, PAYU_CLIENT_SECRET and PAYU_MERCHANT_ID.",
    })
  }
  const hosts = oneapiHosts(process.env.PAYU_ONEAPI_MODE)

  const b = (req.body || {}) as Record<string, any>
  const input: PaymentLinkInput = {
    amount: b.amount,
    description: b.description,
    invoiceNumber: b.invoice_number,
    isPartialPaymentAllowed: b.is_partial_payment_allowed,
    successURL: b.success_url,
    failureURL: b.failure_url,
    expiryDate: b.expiry_date,
    customer: b.customer,
  }

  // Derive amount + customer from a cart when cart_id is given.
  if (b.cart_id) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
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
      filters: { id: b.cart_id },
    })
    const cart = carts?.[0] as any
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" })
    }
    if ((cart.currency_code || "").toLowerCase() !== "inr") {
      logger.warn(`[PayU Link] cart ${b.cart_id} currency is ${cart.currency_code}, not INR`)
    }
    if (input.amount === undefined || input.amount === null) {
      input.amount = cart.total
    }
    if (!input.customer) {
      const ba = cart.billing_address || {}
      input.customer = {
        name: [ba.first_name, ba.last_name].filter(Boolean).join(" ") || undefined,
        email: cart.email || undefined,
        mobileNumber: ba.phone || cart.shipping_address?.phone || undefined,
      }
    }
    if (!input.description) input.description = `Order ${b.cart_id}`
    input.cartId = b.cart_id // → udf1, so the webhook maps the payment back
  }

  if (input.amount === undefined || input.amount === null || Number(input.amount) <= 0) {
    return res.status(400).json({ message: "amount (INR) or a cart_id with a total is required" })
  }
  if (!input.invoiceNumber) {
    input.invoiceNumber = `inv${String(Date.now()).slice(-13)}` // ≤16 chars
  }

  // 1) OAuth token (client_credentials)
  let token: string
  try {
    const tr = await fetch(hosts.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "create_payment_links",
      }).toString(),
    })
    const tj: any = await tr.json().catch(() => ({}))
    if (!tj.access_token) {
      logger.error(`[PayU Link] token failed (${tr.status}): ${JSON.stringify(tj)}`)
      return res.status(502).json({ message: "PayU token request failed", error: tj.error || tr.status })
    }
    token = tj.access_token
  } catch (e: any) {
    logger.error(`[PayU Link] token error: ${e.message}`)
    return res.status(502).json({ message: "PayU token request failed", error: e.message })
  }

  // 2) Create the payment link
  try {
    const cr = await fetch(hosts.links, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        merchantId: String(merchantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPaymentLinkBody(input)),
    })
    const cj: any = await cr.json().catch(() => ({}))
    const parsed = parsePaymentLinkResponse(cj)
    if (!parsed.payment_link) {
      logger.warn(`[PayU Link] no link (${cr.status}): ${cj?.message || JSON.stringify(cj)}`)
      return res.status(cr.status >= 400 ? cr.status : 502).json({
        message: cj?.message || "PayU did not return a payment link",
      })
    }

    // Persist the invoice number on the cart so the webhook can re-verify it via
    // OneAPI before completing the order. Merge metadata (Medusa replaces the
    // whole blob on update) — see the no-critical-data-in-metadata gotcha.
    if (b.cart_id && parsed.invoice_number) {
      try {
        const cartModule: any = req.scope.resolve(Modules.CART)
        const existing = await cartModule.retrieveCart(b.cart_id, { select: ["metadata"] })
        await cartModule.updateCarts(b.cart_id, {
          metadata: {
            ...(existing?.metadata || {}),
            payu_invoice_number: parsed.invoice_number,
            payu_payment_link: parsed.payment_link,
          },
        })
      } catch (e: any) {
        logger.warn(`[PayU Link] could not persist invoice on cart ${b.cart_id}: ${e.message}`)
      }
    }

    return res.json({
      type: "payment_link",
      payment_link: parsed.payment_link,
      invoice_number: parsed.invoice_number,
      total_amount: parsed.total_amount,
    })
  } catch (e: any) {
    logger.error(`[PayU Link] create error: ${e.message}`)
    return res.status(502).json({ message: "PayU payment link request failed", error: e.message })
  }
}
