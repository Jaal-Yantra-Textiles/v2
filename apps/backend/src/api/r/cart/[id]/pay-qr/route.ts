import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import QRCode from "qrcode"

import { readTrackedLink } from "../../../../../lib/payments/payu-link-expiry"

/**
 * GET /r/cart/:id/pay-qr — a PNG QR of the cart's current PayU payment link,
 * for the design-order email (#2564).
 *
 * ## Why a hosted image and not a data: URL
 *
 * Gmail and Outlook strip `data:` images from mail, so a QR embedded inline
 * arrives as a broken box. A URL is fetched (and proxied) like any image.
 *
 * ## Why it stops rendering
 *
 * The image is drawn at READ time from `cart.metadata.payu_link`, so a buyer
 * opening an old email after the link expired, was replaced by an amend, or
 * after they paid, sees no QR rather than a code that leads to a dead or
 * wrong-priced link. 410 Gone in those cases.
 *
 * Public, like `/r/cart/:id`: the cart id (a ULID) is the credential. The QR
 * only encodes the PayU link URL that is already in the same email as text.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "completed_at", "metadata"],
      filters: { id: req.params.id },
    })
    const cart = data?.[0]
    const link = readTrackedLink(cart?.metadata)

    const live =
      cart &&
      link &&
      !cart.completed_at &&
      !cart.metadata?.cancelled_at &&
      !link.closed_at &&
      Date.parse(link.expires_at) > Date.now() &&
      /^https:\/\//.test(link.url)

    if (!live) {
      res.status(410).send("This payment link is no longer active.")
      return
    }

    const png = await QRCode.toBuffer(link!.url, { type: "png", margin: 2, width: 360 })
    res.setHeader("Content-Type", "image/png")
    // Short cache: the link can be replaced or expire at any moment.
    res.setHeader("Cache-Control", "public, max-age=300")
    res.status(200).send(png)
  } catch (e: any) {
    logger?.error?.(`[pay-qr] failed for cart ${req.params.id}: ${e?.message ?? e}`)
    res.status(500).send("Could not draw the QR code.")
  }
}
