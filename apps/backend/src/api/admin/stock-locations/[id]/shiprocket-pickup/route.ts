import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
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
 * POST → register (idempotent), recording the acting user's email as the pickup
 *        contact and the nickname on the location.
 *
 * Shiprocket API failures throw a `ShiprocketApiError` (a MedusaError), so the
 * framework's error handler returns a clean `{ type, message }` with the right
 * status (e.g. a 422 validation bag → 400 INVALID_DATA carrying the per-field
 * messages in the text) instead of an opaque 500 (#427).
 */

/** The logged-in admin's email, used as the Shiprocket pickup contact. */
const resolveActorEmail = async (
  req: MedusaRequest
): Promise<string | undefined> => {
  try {
    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) return undefined
    const userService: any = req.scope.resolve(Modules.USER)
    const user = await userService.retrieveUser(actorId)
    return user?.email
  } catch {
    return undefined
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status = await getShiprocketPickupStatus(req.scope, req.params.id)
  res.json({ pickup: status })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const email = await resolveActorEmail(req)
  const result = await registerShiprocketPickup(req.scope, req.params.id, {
    email,
  })
  res.json({ pickup: result })
}
