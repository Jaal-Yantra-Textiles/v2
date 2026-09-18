/**
 * @route POST /admin/inventory-orders/:id/receive
 * @scope admin
 *
 * #2115 / #2111 — record that the goods actually turned up, and put them on
 * the books at the order's destination.
 *
 * The door that did not exist. `Delivered` is a CARRIER event written by the
 * Shiprocket webhook; stock posting lives in the partner-completion workflow,
 * which refuses anything but `Processing`/`Partial`. So a parcel could be
 * OTP-delivered at the consignee's door and the level still read zero, with
 * nothing having failed anywhere.
 *
 * Body is optional: with no `lines`, everything still outstanding is received,
 * which is the ordinary case for an order the carrier delivered in full.
 *
 * Success: 200 -> { order_id, received, postings, destination_location_id }.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { receiveInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/receive-inventory-order"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const id = req.params.id
  const body = (req.validatedBody ?? req.body ?? {}) as {
    lines?: Array<{ order_line_id: string; quantity: number }>
    stock_location_id?: string
    notes?: string
  }

  const { result, errors } = await receiveInventoryOrderWorkflow(req.scope).run({
    input: {
      orderId: id,
      lines: body.lines ?? null,
      stock_location_id: body.stock_location_id ?? null,
      notes: body.notes ?? null,
      received_by: (req as any).auth_context?.actor_id ?? null,
    },
    throwOnError: false,
  })

  if (errors?.length) {
    const err = errors[0]?.error as any
    const type = err?.type || err?.constructor?.name
    if (type === MedusaError.Types.NOT_FOUND) {
      return res.status(404).json({ message: err.message })
    }
    return res
      .status(400)
      .json({ message: err?.message || "Failed to receive inventory order" })
  }

  return res.status(200).json(result)
}
