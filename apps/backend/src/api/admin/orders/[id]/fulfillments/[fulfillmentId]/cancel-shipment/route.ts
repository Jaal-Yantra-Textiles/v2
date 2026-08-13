import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { cancelShipmentForFulfillment } from "../../../../../../../workflows/orders/cancel-shipment"

/** The logged-in admin's email, recorded on the cancellation's audit entry. */
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

/**
 * POST /admin/orders/:id/fulfillments/:fulfillmentId/cancel-shipment
 *
 * Void a carrier waybill when a shipment can't go out as booked — a pickup that
 * never happens, a partner change, an address caught late. Cancels at the
 * carrier, clears the carrier refs off the fulfillment so a fresh label can be
 * generated (possibly on a different carrier), and emails the customer.
 *
 * ADMIN ONLY, deliberately. A cancel costs real money at the carrier and the
 * partner-change decision that usually motivates it is an admin's to make; the
 * partner portal shows the AWB and points at support instead.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const fulfillmentId = req.params.fulfillmentId
  const body = (req.validatedBody || req.body || {}) as {
    reason?: string
    force?: boolean
    notify_customer?: boolean
  }

  const result = await cancelShipmentForFulfillment(req.scope, {
    orderId,
    fulfillmentId,
    reason: body.reason,
    force: body.force === true,
    notifyCustomer: body.notify_customer !== false,
    actingEmail: await resolveActorEmail(req),
  })

  res.status(200).json({ cancelled_shipment: result })
}
