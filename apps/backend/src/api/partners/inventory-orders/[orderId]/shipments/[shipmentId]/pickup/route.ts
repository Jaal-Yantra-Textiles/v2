/**
 * @route POST /partners/inventory-orders/:orderId/shipments/:shipmentId/pickup
 * @scope partner
 *
 * Book the courier pickup for a shipment the partner already created — the
 * retry when booking at create time failed or no date was chosen.
 *
 * Body: { pickup_date: "YYYY-MM-DD", pickup_time?: "HH:mm" }  (time defaults to 14:00)
 * Success: 200 -> { pickup: { scheduled, pickup_date, pickup_time, reason } }
 *   `scheduled: false` carries the carrier's reason (e.g. a pickup already
 *   booked for that warehouse today); nothing is recorded in that case.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { assertPartnerOwnsInventoryOrder, getPartnerFromAuthContext } from "../../../../../helpers"
import { bookShipmentPickup, loadOrderShipment } from "../../../../../../../workflows/inventory_orders/lib/inventory-shipment-actions"

const bodySchema = z.object({
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickup_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
})

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { orderId, shipmentId } = req.params
  const parsed = bodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ message: "pickup_date (YYYY-MM-DD) is required; pickup_time is HH:mm", details: parsed.error.issues })
  }
  const partner = req.auth_context?.actor_id ? await getPartnerFromAuthContext(req.auth_context, req.scope) : null
  if (!partner) return res.status(401).json({ message: "Partner authentication required" })
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id)

  try {
    const shipment = await loadOrderShipment(req.scope, orderId, shipmentId)
    const pickup = await bookShipmentPickup(req.scope, {
      orderId,
      shipment,
      pickupDate: parsed.data.pickup_date,
      pickupTime: parsed.data.pickup_time,
    })
    return res.json({ pickup })
  } catch (e: any) {
    if (e?.type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: e.message })
    if (e?.type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: e.message })
    if (e?.type === MedusaError.Types.INVALID_DATA) return res.status(400).json({ message: e.message })
    return res.status(502).json({ message: e?.message ?? "Pickup booking failed" })
  }
}
