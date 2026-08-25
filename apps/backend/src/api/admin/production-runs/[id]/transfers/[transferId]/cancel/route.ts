import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { FULLFILLED_ORDERS_MODULE } from "../../../../../../../modules/fullfilled_orders"
import { PRODUCTION_RUNS_MODULE } from "../../../../../../../modules/production_runs"

/**
 * POST /admin/production-runs/:id/transfers/:transferId/cancel
 *
 * Record that a BOOKED hop is not happening (#891 follow-up).
 *
 * ## Why the DELETE beside this is not enough
 *
 * `DELETE .../transfers/:transferId` cancels a `draft` only, and refuses
 * anything booked on the reasoning that cancelling an AWB is a carrier
 * operation rather than a row edit. That reasoning is right and this does not
 * weaken it — but it left no way to record the case that actually happens: the
 * CARRIER cancelled the waybill at their end, and the row went on claiming
 * `in_transit` for a consignment nobody is carrying. A transfer list that says
 * "in transit" about a dead shipment is worse than one that says nothing.
 *
 * So this cancels a booked transfer only when the caller states plainly that
 * the carrier has already cancelled it, and records WHO said so and WHEN.
 * Without `carrier_cancelled: true`, a booked transfer is refused exactly as
 * before.
 *
 * 🔴 It does NOT call the carrier. Nothing here voids a live waybill, and
 * pretending otherwise is the failure mode worth avoiding: an operator who
 * believed this call cancelled the AWB would stop chasing the carrier. This
 * route is about the row.
 *
 * 🔴 A `delivered` transfer can never be cancelled. The goods arrived, so a
 * cancellation would be a false statement about the physical world — and
 * `resolveRunGoodsLocation` trusts a delivered transfer to say where stock is.
 *
 * Nothing is deleted. The cancelled row stays as the record that the hop was
 * attempted, and a replacement created with `replaces_transfer_id` links to it
 * in both directions.
 */

const CancelSchema = z.object({
  /**
   * "The carrier has already cancelled this waybill." Required to cancel a
   * booked hop — an assertion the caller makes, recorded against them.
   */
  carrier_cancelled: z.boolean().optional().default(false),
  /** Why. Kept on the row: a cancellation with no reason is a puzzle later. */
  reason: z.string().trim().max(500).optional(),
})

export const POST = async (
  req: MedusaRequest & { params: { id: string; transferId: string } },
  res: MedusaResponse
) => {
  const { id: runId, transferId } = req.params
  const parsed = CancelSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const { carrier_cancelled, reason } = parsed.data

  const service: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)

  const transfer = await service.retrieveGoodsTransfer(transferId).catch(() => null)
  if (!transfer || transfer.production_run_id !== runId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Goods transfer ${transferId} not found on production run ${runId}`
    )
  }

  if (transfer.status === "cancelled") {
    return res
      .status(200)
      .json({ goods_transfer: transfer, message: "Already cancelled" })
  }

  if (transfer.status === "delivered") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This transfer is delivered — the goods arrived, so it cannot be cancelled. Record a new transfer if they moved again."
    )
  }

  if (transfer.status !== "draft" && !carrier_cancelled) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `This transfer is "${transfer.status}" and carries a carrier booking. Cancel the waybill with the carrier first, then repeat this call with carrier_cancelled: true to record it here — this route does not call the carrier.`
    )
  }

  const actorId = (req as any).auth_context?.actor_id ?? null
  const cancelledAt = new Date()

  // Merged, never assigned — `metadata` is a shared blob, and an overwrite here
  // would take a replacement back-link with it.
  await service.updateGoodsTransfers({
    id: transferId,
    status: "cancelled",
    metadata: {
      ...((transfer.metadata ?? {}) as Record<string, unknown>),
      cancelled_at: cancelledAt.toISOString(),
      cancelled_by: actorId,
      cancellation_reason: reason ?? null,
      // Recorded as an ASSERTION, not as a carrier fact anything verified.
      carrier_cancellation_asserted: carrier_cancelled,
    },
  })
  const updated = await service.retrieveGoodsTransfer(transferId)

  // Timeline row, best-effort — the cancellation is already persisted.
  try {
    const runService: any = req.scope.resolve(PRODUCTION_RUNS_MODULE)
    const units = `${transfer.quantity} unit${
      Number(transfer.quantity) === 1 ? "" : "s"
    }`
    await runService.createProductionRunActivities({
      production_run_id: runId,
      activity_type: "lifecycle_event",
      kind: "goods_transfer_cancelled",
      actor_type: "admin",
      actor_id: actorId,
      partner_id: null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: carrier_cancelled
        ? `Carrier cancelled the shipment for ${units}${reason ? ` — ${reason}` : ""}`
        : `Planned transfer of ${units} cancelled before booking`,
      payload: {
        goods_transfer_id: transferId,
        from_location_id: transfer.from_location_id,
        to_location_id: transfer.to_location_id,
        quantity: transfer.quantity,
        reason: transfer.reason ?? null,
        previous_status: transfer.status,
        shipment_id: transfer.shipment_id ?? null,
        carrier_cancellation_asserted: carrier_cancelled,
        cancellation_reason: reason ?? null,
      },
      occurred_at: cancelledAt,
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
