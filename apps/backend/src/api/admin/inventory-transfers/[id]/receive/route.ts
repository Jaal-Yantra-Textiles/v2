/**
 * @route POST /admin/inventory-transfers/:id/receive
 * @scope admin
 *
 * #2144 — somebody at the far end counted the material, so move the stock.
 *
 * Receipt and posting happen together here. On a run's output they are held
 * apart, because the approval that accepts the partner's claim can arrive
 * later; material has no such claim and no approval, so separating them would
 * only strand stock at an origin it has physically left.
 *
 * Body is optional: omit it and the quantity that was sent is accepted, which
 * is the ordinary case. Success: 200 -> the move that was made, or the reason
 * none was.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { receiveMaterialTransfer } from "../../../../../workflows/inventory-transfers/material-transfer"
import { receiveMaterialTransferSchema } from "../../validators"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const parsed = receiveMaterialTransferSchema.safeParse(
    (req as any).validatedBody ?? req.body ?? {}
  )
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  const result = await receiveMaterialTransfer(req.scope, {
    transferId: req.params.id,
    receivedQuantity: parsed.data.received_quantity ?? null,
    notes: parsed.data.notes ?? null,
    actingUserId: (req as any).auth_context?.actor_id ?? null,
  })

  res.status(200).json(result)
}
