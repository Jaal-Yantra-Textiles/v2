import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { FULLFILLED_ORDERS_MODULE } from "../../../../../../modules/fullfilled_orders"
import { PRODUCTION_RUNS_MODULE } from "../../../../../../modules/production_runs"

/**
 * DELETE /admin/production-runs/:id/transfers/:transferId
 *
 * Cancel a planned hop (#891). A transfer row is created BEFORE any carrier
 * call so a failed booking leaves something visible to retry — which means a
 * booking that is never retried leaves a `draft` behind forever, and the run's
 * transfer list slowly fills with movements that never happened.
 *
 * Only a `draft` can be cancelled here. Once a carrier has been booked the
 * movement is real and the AWB has been paid for: cancelling that is a carrier
 * operation, not a row edit, and pretending otherwise would leave a live
 * shipment tracking against a transfer we claim is cancelled.
 *
 * `cancelled` is terminal, and nothing is deleted — the row stays as the record
 * that a hop was planned and abandoned.
 */
export const DELETE = async (
  req: MedusaRequest & { params: { id: string; transferId: string } },
  res: MedusaResponse
) => {
  const { id: runId, transferId } = req.params
  const service: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)

  const transfer = await service
    .retrieveGoodsTransfer(transferId)
    .catch(() => null)

  if (!transfer || transfer.production_run_id !== runId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Goods transfer ${transferId} not found on production run ${runId}`
    )
  }

  if (transfer.status === "cancelled") {
    return res.status(200).json({ goods_transfer: transfer, message: "Already cancelled" })
  }

  if (transfer.status !== "draft") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Only a draft transfer can be cancelled — this one is "${transfer.status}". Cancel the carrier shipment first.`
    )
  }

  await service.updateGoodsTransfers({ id: transferId, status: "cancelled" })
  const updated = await service.retrieveGoodsTransfer(transferId)

  // Timeline row, best-effort — the cancellation is already persisted.
  try {
    const runService: any = req.scope.resolve(PRODUCTION_RUNS_MODULE)
    await runService.createProductionRunActivities({
      production_run_id: runId,
      activity_type: "lifecycle_event",
      kind: "goods_transfer_cancelled",
      actor_type: "admin",
      actor_id: (req as any).auth_context?.actor_id ?? null,
      partner_id: null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: `Planned transfer of ${transfer.quantity} unit${
        Number(transfer.quantity) === 1 ? "" : "s"
      } cancelled before booking`,
      payload: {
        goods_transfer_id: transferId,
        from_location_id: transfer.from_location_id,
        to_location_id: transfer.to_location_id,
        quantity: transfer.quantity,
        reason: transfer.reason ?? null,
      },
      occurred_at: new Date(),
    })
  } catch (e: any) {
    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(
        `[admin.production-runs] transfer ${transferId} cancelled but timeline write failed: ${e?.message}`
      )
  }

  res.status(200).json({ goods_transfer: updated })
}
