import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ensureOrderFulfillment } from "../../../../../workflows/orders/fulfillment-context"
import { attachExistingShiprocketAwb } from "../../../../../workflows/orders/shiprocket-attach-awb"

/**
 * POST /admin/orders/:id/shiprocket-attach-awb
 *
 * #437 — attach an EXISTING Shiprocket AWB to a (converted) order. For parcels
 * already shipped/delivered outside this system. Reuses or creates a plain
 * (manual) fulfillment for the order, looks the AWB up on Shiprocket (read-only
 * — no new shipment is created), stamps the carrier refs onto fulfillment.data,
 * and auto-syncs the fulfillment status to the AWB's real Shiprocket state.
 *
 * A bad/foreign AWB or Shiprocket error surfaces as a clean MedusaError, not a
 * 500.
 */
const Body = z.object({ awb: z.string().trim().min(1, "An AWB is required") })

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const { awb } = Body.parse((req.body as Record<string, unknown>) ?? {})

  const fulfillmentId = await ensureOrderFulfillment(req.scope, orderId)
  const result = await attachExistingShiprocketAwb(req.scope, {
    orderId,
    fulfillmentId,
    awb,
  })

  res.status(200).json({ shiprocket_awb: result })
}
