/**
 * @route GET /partners/inventory-orders/:orderId/shipments/:shipmentId/label
 * @scope partner
 *
 * A fresh printable label for one of the partner's inventory-order shipments.
 * Delhivery's PDF link expires after 24 hours, so screens call this when the
 * partner taps "Label" instead of trusting a stored URL.
 *
 * Success: 200 -> { label_url, format, expires_in_hours }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { assertPartnerOwnsInventoryOrder, getPartnerFromAuthContext } from "../../../../../helpers"
import { freshShipmentLabel, loadOrderShipment } from "../../../../../../../workflows/inventory_orders/lib/inventory-shipment-actions"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { orderId, shipmentId } = req.params
  const partner = req.auth_context?.actor_id ? await getPartnerFromAuthContext(req.auth_context, req.scope) : null
  if (!partner) return res.status(401).json({ message: "Partner authentication required" })
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id)

  try {
    const shipment = await loadOrderShipment(req.scope, orderId, shipmentId)
    const label = await freshShipmentLabel(req.scope, shipment)
    if (!label.label_url) {
      return res.status(404).json({ message: "The carrier has no label for this shipment yet. Try again in a minute." })
    }
    return res.json(label)
  } catch (e: any) {
    if (e?.type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: e.message })
    if (e?.type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: e.message })
    return res.status(502).json({ message: `Could not fetch the label from the carrier: ${e?.message ?? e}` })
  }
}
