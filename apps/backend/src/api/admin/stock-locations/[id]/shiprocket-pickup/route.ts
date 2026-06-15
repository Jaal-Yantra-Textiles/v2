import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  getShiprocketPickupStatus,
  registerShiprocketPickup,
} from "../../../../../modules/shipping-providers/pickup-locations"

/**
 * Shiprocket pickup-location registration for a stock location (#31, §9).
 *
 * On-demand by design (SHIPPING_PROVIDERS.md §9.3): a partner/operator only sees
 * or touches registration status when they explicitly ask — the inbound case
 * stays invisible plumbing, the outbound case is a deliberate opt-in.
 *
 * GET  → current registration + phone-verification status (null if unregistered)
 * POST → register (idempotent) and record the nickname on the location
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status = await getShiprocketPickupStatus(req.scope, req.params.id)
  res.json({ pickup: status })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const result = await registerShiprocketPickup(req.scope, req.params.id)
  res.json({ pickup: result })
}
