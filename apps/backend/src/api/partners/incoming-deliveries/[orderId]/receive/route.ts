/**
 * @route POST /partners/incoming-deliveries/:orderId/receive
 * @scope partner
 *
 * #2286 — the receiving partner confirms what actually arrived.
 *
 * Runs the SAME `receiveInventoryOrderWorkflow` the admin uses, so partner and
 * admin receipts are one cumulative record: a second confirmation of goods
 * already received posts nothing, and a line short is recorded as short.
 *
 * Guards:
 * - The order's DESTINATION must be the caller's own warehouse; anything else is
 *   a 404 (a partner cannot receive — or learn of — someone else's delivery).
 * - `lines` is REQUIRED: the point is the partner stating the numbers, not
 *   "whatever was ordered". Lines they omit receive nothing.
 * - No `stock_location_id` anywhere: goods land at the partner's own warehouse,
 *   never somewhere they choose.
 *
 * Success: 200 -> { order_id, received, postings, destination_location_ids }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { receiveInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/receive-inventory-order"
import { resolveInventoryOrderDestination } from "../../../../../workflows/inventory_orders/lib/order-destination"
import { resolvePartnerHomeLocation } from "../../../lib/partner-home-location"
import type { PartnerReceiveIncomingReq } from "../../validators"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.orderId
  const body = (req.validatedBody ?? req.body) as PartnerReceiveIncomingReq

  const { partner, location_id } = await resolvePartnerHomeLocation(req.auth_context, req.scope)
  const destination = await resolveInventoryOrderDestination(req.scope, orderId)
  if (!location_id || !destination || destination !== location_id) {
    return res.status(404).json({ message: `Incoming delivery ${orderId} not found` })
  }

  const { result, errors } = await receiveInventoryOrderWorkflow(req.scope).run({
    input: {
      orderId,
      lines: body.lines.map((l) => ({ order_line_id: l.order_line_id, quantity: l.quantity })),
      stock_location_id: null,
      notes: body.notes ?? null,
      received_by: (req as any).auth_context?.actor_id ?? null,
      received_by_partner_id: partner?.id ?? null,
    },
    throwOnError: false,
  })

  if (errors?.length) {
    const err = errors[0]?.error as any
    const type = err?.type || err?.constructor?.name
    if (type === MedusaError.Types.NOT_FOUND) {
      return res.status(404).json({ message: err.message })
    }
    return res.status(400).json({ message: err?.message || "Could not record the receipt" })
  }

  res.status(200).json(result)
}
