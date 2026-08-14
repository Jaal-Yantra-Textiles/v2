import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { detachAwbFromFulfillment } from "../../../../../../../workflows/orders/external-awb"

/**
 * DELETE /admin/orders/:id/fulfillments/:fulfillmentId/external-awb
 *
 * Detach a waybill from a fulfillment WITHOUT touching the carrier.
 *
 * The counterpart `cancel-shipment` has been telling operators about since
 * #1286 — "Cancel it directly with the carrier, then detach the AWB here" —
 * while no detach existed anywhere to do it with. It is the correct exit for a
 * waybill no API can void for us: an unintegrated carrier, or one booked on an
 * account that isn't ours.
 *
 * Deliberately does NOT cancel at the carrier. Whether the waybill is dead is
 * the operator's assertion; conflating the two would let a detach quietly leave
 * a live billable waybill behind, or claim to have voided one it never touched.
 * When the carrier IS integrated and the waybill IS ours, use `cancel-shipment`
 * instead — that voids it for real and reverses the freight.
 */
const Body = z.object({
  reason: z.string().trim().max(500).optional(),
})

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

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = Body.parse((req.body as Record<string, unknown>) ?? {})

  const result = await detachAwbFromFulfillment(req.scope, {
    orderId: req.params.id,
    fulfillmentId: req.params.fulfillmentId,
    reason: body.reason,
    actingEmail: await resolveActorEmail(req),
  })

  res.status(200).json({ detached_awb: result })
}
