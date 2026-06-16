import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  getShiprocketPickupStatus,
  registerShiprocketPickup,
} from "../../../../../modules/shipping-providers/pickup-locations"
import { ShiprocketApiError } from "../../../../../modules/shipping-providers/shiprocket/client"

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
 * Shiprocket API failures (e.g. the 422 validation bag from addpickup) are
 * surfaced as a structured `shiprocket_error` response with per-field messages,
 * rather than an opaque 500 (#427).
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

/** Map a Shiprocket API error onto a clean, actionable HTTP response. */
const respondShiprocketError = (
  res: MedusaResponse,
  e: ShiprocketApiError
): void => {
  const s = e.status
  // 422 validation passes through; rejected creds (401/403) → 424; other 4xx
  // pass through; anything else is an upstream failure → 502.
  const status =
    s === 422 ? 422 : s === 401 || s === 403 ? 424 : s >= 400 && s < 500 ? s : 502
  res.status(status).json({
    type: "shiprocket_error",
    message: e.message,
    field_errors: e.fieldErrors,
  })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const status = await getShiprocketPickupStatus(req.scope, req.params.id)
    res.json({ pickup: status })
  } catch (e) {
    if (e instanceof ShiprocketApiError) return respondShiprocketError(res, e)
    throw e
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const email = await resolveActorEmail(req)
  try {
    const result = await registerShiprocketPickup(req.scope, req.params.id, {
      email,
    })
    res.json({ pickup: result })
  } catch (e) {
    if (e instanceof ShiprocketApiError) return respondShiprocketError(res, e)
    throw e
  }
}
