import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  buildUpiIntentForm,
  buildReturnUrls,
  findPayuSession,
  parseUpiIntentResponse,
} from "./lib"
import { findStorefrontBySalesChannel } from "../../../mcp/lib/store-resolver"

/**
 * POST /store/payu/intent
 * Generate a UPI Intent (`upi://pay?...` deep link) for a cart's PayU payment
 * session, via PayU's S2S `/_payment` flow (bankcode=INTENT). The session must
 * already be initialized (create_payment_collection + initialize_payment_session
 * with provider pp_payu_payu). Returns the deep link the customer taps in any
 * UPI app; the order completes via the PayU webhook / /store/payu/complete.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const { cart_id, upi_app, return_url_base } = (req.body || {}) as {
    cart_id?: string
    upi_app?: string
    return_url_base?: string
  }

  if (!cart_id) {
    return res.status(400).json({ message: "cart_id is required" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "sales_channel_id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.currency_code",
      "payment_collection.payment_sessions.amount",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: cart_id },
  })

  const cart = carts?.[0] as any
  if (!cart) {
    return res.status(404).json({ message: "Cart not found" })
  }

  const session = findPayuSession(cart)
  if (!session) {
    return res.status(400).json({
      message:
        "No PayU payment session on this cart. Create a payment collection and initialize a 'pp_payu_payu' session first.",
    })
  }

  const data = session.data || {}
  if (!data.payment_url || !data.hash || !data.txnid) {
    return res
      .status(400)
      .json({ message: "PayU session is not fully initialized (missing hash/txnid)." })
  }

  // Return URLs: caller override → owning storefront origin → request origin.
  let origin = return_url_base || null
  if (!origin) {
    try {
      const sf = await findStorefrontBySalesChannel(req.scope, cart.sales_channel_id)
      if (sf?.domain) origin = `https://${sf.domain}`
    } catch {
      /* best-effort */
    }
  }
  if (!origin) {
    const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]
    const host = req.get("host")
    if (host) origin = `${proto}://${host}`
  }
  const { surl, furl } = buildReturnUrls(origin, cart_id)

  const form = buildUpiIntentForm(data, {
    surl,
    furl,
    clientIp: (req.get("x-forwarded-for") || (req as any).ip || "").split(",")[0].trim(),
    deviceInfo: req.get("user-agent") || "Medusa",
    upiAppName: upi_app,
  })

  let parsed
  try {
    const resp = await fetch(String(data.payment_url), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    })
    const text = await resp.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      // PayU returned the HTML hosted page → S2S UPI Intent not enabled for this MID.
      logger.warn(`[PayU Intent] Non-JSON response for cart ${cart_id} (S2S/UPI likely not enabled)`)
      return res.status(409).json({
        type: "cart",
        message:
          "PayU returned the hosted page, not a UPI intent. Enable S2S UPI Intent on this merchant, or use the hosted checkout / payment link.",
      })
    }
    parsed = parseUpiIntentResponse(json)
  } catch (e: any) {
    logger.error(`[PayU Intent] Request failed for cart ${cart_id}: ${e.message}`)
    return res.status(502).json({ message: "PayU UPI intent request failed", error: e.message })
  }

  if (!parsed.upi_link) {
    return res.status(409).json({
      type: "cart",
      message: "PayU did not return a UPI intent link (UPI intent may not be enabled).",
    })
  }

  // Persist the intent on the session (best-effort) so later steps can read it.
  try {
    const paymentModule = req.scope.resolve(Modules.PAYMENT) as any
    await paymentModule.updatePaymentSession({
      id: session.id,
      currency_code: session.currency_code,
      amount: session.amount,
      data: {
        ...data,
        upi_intent_uri: parsed.upi_link,
        upi_payment_id: parsed.payment_id,
      },
    })
  } catch (e: any) {
    logger.warn(`[PayU Intent] Could not persist intent on session: ${e.message}`)
  }

  return res.json({
    type: "upi_intent",
    upi_link: parsed.upi_link,
    qr_url: parsed.qr_url,
    txnid: data.txnid,
    payment_id: parsed.payment_id,
  })
}
