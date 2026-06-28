/**
 * POST /store/payu/upi-qr
 *
 * Turn a UPI payment into a scannable QR code. Accepts an explicit `upi_link`, a
 * `vpa` (+ optional amount/payee/note) to build one, or a `cart_id` to reuse the
 * `upi://pay` intent already generated for that cart (payu_generate_upi_intent).
 * Returns a PNG data URL the agent can show the shopper, plus the upi_link
 * itself (tappable on mobile). Completion still happens via the PayU webhook —
 * the agent should poll get_checkout_status after the shopper pays.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import QRCode from "qrcode"
import { isUpiLink, resolveUpiLink } from "./lib"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body || {}) as Record<string, any>

  let upiLink = resolveUpiLink({
    upi_link: body.upi_link,
    vpa: body.vpa,
    amount: body.amount,
    payee_name: body.payee_name,
    note: body.note,
  })

  // Fall back to the cart's stored PayU UPI intent.
  if (!upiLink && body.cart_id) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "payment_collection.payment_sessions.provider_id", "payment_collection.payment_sessions.data"],
      filters: { id: body.cart_id },
    })
    const sessions: any[] = (carts?.[0] as any)?.payment_collection?.payment_sessions || []
    const payu = sessions.find((s) => String(s?.provider_id || "").includes("payu"))
    const stored = payu?.data?.upi_intent_uri
    if (isUpiLink(stored)) upiLink = stored
  }

  if (!upiLink) {
    return res.status(400).json({
      type: "upi_qr",
      error:
        "No UPI link to encode. Pass upi_link, or a vpa (+amount), or a cart_id that already has a generated UPI intent (run payu_generate_upi_intent first).",
    })
  }

  try {
    const qr_data_url = await QRCode.toDataURL(upiLink, { margin: 1, width: 320 })
    return res.json({ type: "upi_qr", upi_link: upiLink, qr_data_url })
  } catch (e: any) {
    logger.error(`[UPI QR] failed to render QR: ${e?.message}`)
    return res.status(500).json({ type: "upi_qr", error: "Failed to render the QR code" })
  }
}
