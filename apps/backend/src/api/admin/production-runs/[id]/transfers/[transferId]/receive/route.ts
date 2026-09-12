import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { FULLFILLED_ORDERS_MODULE } from "../../../../../../../modules/fullfilled_orders"
import { receiveGoodsTransferWorkflow } from "../../../../../../../workflows/production-runs/receive-goods-transfer"

/**
 * POST /admin/production-runs/:id/transfers/:transferId/receive
 *
 * #891 S3 — the receipt. This is the call that actually moves inventory
 * between the two locations, and it is the only one that does.
 *
 * ## Why receipt is a human act
 *
 * A carrier's "delivered" scan means a box reached an address. It does not mean
 * anyone opened it and counted what was inside, and the two differ often enough
 * that trusting the scan would write confident wrong numbers into stock. So the
 * tracking webhook advances the SHIPMENT, and a person calls this to say what
 * actually arrived — the same split #888 made for inventory orders.
 *
 * ## What it does
 *
 * - decrements the origin level, increments the destination level
 * - repoints the run's reservations at the destination, because a reservation
 *   left behind re-creates the negative this slice exists to remove
 * - marks the transfer `delivered` with `received_at` / `received_quantity`,
 *   which is what `resolveRunGoodsLocation` reads to place the next hop and the
 *   customer leg
 *
 * Receiving twice is refused: the goods would move twice. A correction is a new
 * transfer, not a second receipt.
 */

const ReceiveSchema = z.object({
  /**
   * What was actually counted out of the box. Defaults to the quantity that
   * was sent — the common case, and the one an operator should not have to
   * retype. A smaller number is recorded as a shortfall rather than silently
   * reconciled.
   */
  received_quantity: z.number().min(0).optional(),
  /** Anything worth knowing about the receipt — damage, a partial count. */
  notes: z.string().trim().max(1000).optional(),
})

export const POST = async (
  req: MedusaRequest & { params: { id: string; transferId: string } },
  res: MedusaResponse
) => {
  const { id: runId, transferId } = req.params

  const parsed = ReceiveSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }

  const { result } = await receiveGoodsTransferWorkflow(req.scope).run({
    input: {
      run_id: runId,
      transfer_id: transferId,
      received_quantity: parsed.data.received_quantity,
      notes: parsed.data.notes ?? null,
      actor_id: (req as any).auth_context?.actor_id ?? null,
      actor_type: "user",
    },
  })

  const service: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)
  const goods_transfer = await service
    .retrieveGoodsTransfer(transferId)
    .catch(() => null)

  return res.status(200).json({ goods_transfer, receipt: result })
}
