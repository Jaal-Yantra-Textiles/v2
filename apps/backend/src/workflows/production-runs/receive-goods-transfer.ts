import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"

/**
 * #891 S3 — receiving a goods transfer is what actually moves the inventory.
 *
 * Until this slice, a hop could be created and shipped but never received:
 * nothing in the codebase wrote `goods_transfer.status = "delivered"`. Stock
 * therefore stayed banked at the producing partner's location forever, and the
 * customer leg shipped from somewhere the goods were not — which is how a
 * `-1` appears at one location beside a `+1` at another (the 2026-09-10
 * incident on iitem_01M25K1PHQ86CQ0SKVDJ47EMCS).
 *
 * Receipt is deliberately a HUMAN act, not a carrier event. A carrier's
 * "delivered" scan means the box arrived; it does not mean anyone opened it and
 * counted what was inside. That is the same decision #888 made for inventory
 * orders, and both `inventory_shipment.ts` and `goods_transfer.ts` say so in
 * their model comments.
 *
 * 🔑 The reservation moves with the goods. A transfer that relocates stock but
 * leaves an order's reservation pointing at the origin reproduces the very
 * negative this slice exists to prevent, one step later.
 */

export type ReceiveGoodsTransferInput = {
  run_id: string
  transfer_id: string
  /** What was actually counted. Defaults to the quantity that was sent. */
  received_quantity?: number
  notes?: string | null
  actor_id?: string | null
  actor_type?: "user" | "partner" | "system"
}

export type ReceiveGoodsTransferResult = {
  transfer_id: string
  status: "delivered"
  received_quantity: number
  /** Whether inventory was actually moved, and if not, why not. */
  moved: boolean
  skip_reason?: MoveSkipReason
  inventory_item_id?: string
  from_location_id?: string
  to_location_id?: string
  /** Reservations repointed from the origin to the destination. */
  reservations_repointed: number
  shortfall: number
}

export type MoveSkipReason =
  | "customer_leg"
  | "same_location"
  | "zero_quantity"

export type TransferMovePlan = {
  move: boolean
  quantity: number
  from_location_id: string
  to_location_id?: string
  skip_reason?: MoveSkipReason
}

/**
 * PURE: may this transfer be received?
 *
 * Throws rather than returning false — every caller's only sensible response is
 * to stop, and a boolean invites one of them not to. Mirrors
 * `assertReplaceableTransfer`, which guards the other end of the lifecycle.
 */
export function assertReceivableTransfer(
  transfer: { id?: string; production_run_id?: string; status?: string } | null,
  runId: string,
  requestedId: string
): void {
  if (!transfer || transfer.production_run_id !== runId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Goods transfer ${requestedId} not found on production run ${runId}.`
    )
  }
  if (transfer.status === "delivered") {
    // Receiving twice would move the stock twice. The first receipt is the
    // record; a correction is a new transfer, not a second receipt.
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Transfer ${transfer.id} has already been received — receiving it again would move the same goods twice.`
    )
  }
  if (transfer.status === "cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Transfer ${transfer.id} is cancelled — goods that were never sent cannot be received.`
    )
  }
}

/**
 * PURE: what inventory movement does this receipt imply?
 *
 * Three cases move NOTHING, and each of them would be a real over- or
 * under-count if it did:
 *
 *  - **customer_leg** — a transfer with no destination is goods leaving for a
 *    customer. The core fulfillment path already decrements when it ships;
 *    decrementing here as well would take the same garment out of stock twice.
 *  - **same_location** — origin and destination are the same stock location.
 *    A read-then-write of `stocked_quantity` against one level would be a
 *    no-op at best; it is never a real movement.
 *  - **zero_quantity** — nothing arrived, so nothing moved. The transfer is
 *    still marked received, because "the box came and was empty" is a fact
 *    worth recording.
 */
export function planTransferMove(
  transfer: {
    quantity?: number | null
    from_location_id?: string | null
    to_location_id?: string | null
  },
  receivedQuantity?: number | null
): TransferMovePlan {
  const sent = Number(transfer.quantity ?? 0)
  const quantity = Number(
    receivedQuantity == null || Number.isNaN(Number(receivedQuantity))
      ? sent
      : receivedQuantity
  )

  const from = String(transfer.from_location_id || "")
  const to = transfer.to_location_id ? String(transfer.to_location_id) : undefined

  const base = { quantity, from_location_id: from, to_location_id: to }

  if (!to) return { ...base, move: false, skip_reason: "customer_leg" }
  if (from && from === to) return { ...base, move: false, skip_reason: "same_location" }
  if (!(quantity > 0)) return { ...base, move: false, skip_reason: "zero_quantity" }

  return { ...base, move: true }
}

/**
 * PURE: the difference between what was sent and what was counted.
 *
 * Never negative — receiving MORE than was sent is a data-entry question, not a
 * shortfall, and reporting it as `-2` short would read as a surplus nobody can
 * act on.
 */
export function transferShortfall(
  sentQuantity?: number | null,
  receivedQuantity?: number | null
): number {
  const sent = Number(sentQuantity ?? 0)
  const received = Number(receivedQuantity ?? 0)
  return Math.max(0, sent - received)
}

/** Resolve the inventory item the run's output is banked as. */
async function resolveRunInventoryItem(
  container: MedusaContainer,
  run: { variant_id?: string | null; design_id?: string | null }
): Promise<string | undefined> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // Same resolution order as `stockFinishedGoodsStep` — the run's own variant
  // wins, the design lookup is the fallback for runs that predate the column.
  let variantId: string | undefined = run.variant_id ?? undefined
  if (!variantId && run.design_id) {
    const { data } = await query.graph({
      entity: "design_product_variant",
      filters: { design_id: run.design_id },
      fields: ["product_variant_id"],
    })
    variantId = data?.[0]?.product_variant_id
  }
  if (!variantId) return undefined

  const { data: variantInventory } = await query.graph({
    entity: "product_variant_inventory_item",
    filters: { variant_id: variantId },
    fields: ["inventory_item_id"],
  })
  return variantInventory?.[0]?.inventory_item_id
}

/**
 * Move `quantity` of `inventoryItemId` from one location to the other.
 *
 * Read-then-absolute-write, because this codebase has no `adjustInventory` —
 * which is exactly why the origin side is clamped at zero. An origin level that
 * is already short must not be driven negative by a receipt; the shortfall is
 * reported instead.
 */
async function moveInventory(
  container: MedusaContainer,
  inventoryItemId: string,
  fromLocationId: string,
  toLocationId: string,
  quantity: number
): Promise<void> {
  const inventoryService: any = container.resolve(Modules.INVENTORY)

  const [originLevel] = await inventoryService.listInventoryLevels({
    inventory_item_id: inventoryItemId,
    location_id: fromLocationId,
  })
  if (originLevel) {
    await inventoryService.updateInventoryLevels(originLevel.id, {
      stocked_quantity: Math.max(
        0,
        (originLevel.stocked_quantity || 0) - quantity
      ),
    })
  }

  const [destinationLevel] = await inventoryService.listInventoryLevels({
    inventory_item_id: inventoryItemId,
    location_id: toLocationId,
  })
  if (destinationLevel) {
    await inventoryService.updateInventoryLevels(destinationLevel.id, {
      stocked_quantity: (destinationLevel.stocked_quantity || 0) + quantity,
    })
  } else {
    await inventoryService.createInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: toLocationId,
      stocked_quantity: quantity,
    })
  }
}

/**
 * Repoint the run's reservations at the destination.
 *
 * A reservation is held at a LOCATION. Move the stock and leave the reservation
 * behind, and the origin now owes a unit it no longer has while the destination
 * holds one nothing has claimed — the same negative, one step later.
 *
 * Quantities are deliberately NOT adjusted on a short receipt. The goods that
 * did arrive are at the destination, so that is where the claim belongs;
 * reconciling a shortfall is a separate decision, and silently shrinking a
 * customer's reservation here would make it invisible.
 */
async function repointReservations(
  container: MedusaContainer,
  productionRunId: string,
  inventoryItemId: string,
  fromLocationId: string,
  toLocationId: string
): Promise<number> {
  const inventoryService: any = container.resolve(Modules.INVENTORY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const reservations = await inventoryService.listReservationItems({
    inventory_item_id: inventoryItemId,
    location_id: fromLocationId,
  })

  // `metadata` is JSON, so the run filter happens in-app — the same reason the
  // partner reservation list filters in-app.
  const mine = (Array.isArray(reservations) ? reservations : []).filter(
    (r: any) => String(r?.metadata?.production_run_id || "") === productionRunId
  )

  let moved = 0
  for (const reservation of mine) {
    try {
      await inventoryService.updateReservationItems({
        id: reservation.id,
        location_id: toLocationId,
      })
      moved++
    } catch (e: any) {
      // The stock has already moved; a reservation left behind is a reportable
      // inconsistency, not a reason to unwind a physical receipt.
      logger.error(
        `[goods-transfer] reservation ${reservation.id} could not follow the goods to ${toLocationId}: ${e?.message}`
      )
    }
  }
  return moved
}

/** Put the receipt on the run's timeline. Best-effort — never unwinds the move. */
async function recordReceiptActivity(
  container: MedusaContainer,
  run: { id: string; partner_id?: string | null },
  transfer: any,
  result: ReceiveGoodsTransferResult,
  notes?: string | null
): Promise<void> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const summary =
      `${result.received_quantity} unit${result.received_quantity === 1 ? "" : "s"} received` +
      (result.shortfall ? ` (${result.shortfall} short)` : "") +
      (result.moved ? "" : ` — inventory not moved (${result.skip_reason})`)

    await runService.createProductionRunActivities({
      production_run_id: run.id,
      activity_type: "lifecycle_event",
      kind: "goods_transfer_received",
      actor_type: "system",
      actor_id: null,
      partner_id: run.partner_id ?? null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary,
      payload: {
        goods_transfer_id: transfer.id,
        from_location_id: result.from_location_id ?? null,
        to_location_id: result.to_location_id ?? null,
        quantity: Number(transfer.quantity ?? 0),
        received_quantity: result.received_quantity,
        shortfall: result.shortfall,
        moved: result.moved,
        skip_reason: result.skip_reason ?? null,
        reservations_repointed: result.reservations_repointed,
        notes: notes ?? null,
      },
      occurred_at: new Date(),
    })
  } catch (e: any) {
    logger.error(
      `[goods-transfer] transfer ${transfer.id} received but timeline write failed: ${e?.message}`
    )
  }
}

export async function receiveGoodsTransfer(
  container: MedusaContainer,
  input: ReceiveGoodsTransferInput
): Promise<ReceiveGoodsTransferResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const transferService: any = container.resolve(FULLFILLED_ORDERS_MODULE)

  const [transfer] = await transferService.listGoodsTransfers({
    id: input.transfer_id,
  })
  assertReceivableTransfer(transfer, input.run_id, input.transfer_id)

  const run = await runService.retrieveProductionRun(input.run_id)

  const plan = planTransferMove(transfer, input.received_quantity)
  const shortfall = transferShortfall(transfer.quantity, plan.quantity)

  const result: ReceiveGoodsTransferResult = {
    transfer_id: transfer.id,
    status: "delivered",
    received_quantity: plan.quantity,
    moved: false,
    skip_reason: plan.skip_reason,
    from_location_id: plan.from_location_id,
    to_location_id: plan.to_location_id,
    reservations_repointed: 0,
    shortfall,
  }

  if (plan.move && plan.to_location_id) {
    const inventoryItemId = await resolveRunInventoryItem(container, run)
    if (!inventoryItemId) {
      // The receipt is still real — it just cannot be expressed as an inventory
      // movement, so say so loudly rather than reporting a move that never was.
      logger.warn(
        `[goods-transfer] transfer ${transfer.id} received but no inventory item resolves from run ${run.id} — stock not moved`
      )
    } else {
      await moveInventory(
        container,
        inventoryItemId,
        plan.from_location_id,
        plan.to_location_id,
        plan.quantity
      )
      result.moved = true
      result.inventory_item_id = inventoryItemId
      result.reservations_repointed = await repointReservations(
        container,
        String(transfer.production_run_id),
        inventoryItemId,
        plan.from_location_id,
        plan.to_location_id
      )
    }
  }

  await transferService.updateGoodsTransfers({
    id: transfer.id,
    status: "delivered",
    received_at: new Date(),
    received_quantity: plan.quantity,
    ...(input.notes ? { notes: input.notes } : {}),
  })

  await recordReceiptActivity(container, run, transfer, result, input.notes)

  logger.info(
    `[goods-transfer] ${transfer.id} received: ${result.received_quantity} unit(s)` +
      (result.moved
        ? ` moved ${plan.from_location_id} → ${plan.to_location_id}, ${result.reservations_repointed} reservation(s) repointed`
        : ` (no inventory movement: ${result.skip_reason ?? "unresolved item"})`)
  )

  return result
}

const receiveGoodsTransferStep = createStep(
  "receive-goods-transfer",
  async (input: ReceiveGoodsTransferInput, { container }) => {
    const result = await receiveGoodsTransfer(container, input)
    return new StepResponse(result)
  }
)

export const receiveGoodsTransferWorkflow = createWorkflow(
  "receive-goods-transfer",
  (input: ReceiveGoodsTransferInput) => {
    const result = receiveGoodsTransferStep(input)
    return new WorkflowResponse(result)
  }
)
