/**
 * #2144 — moving MATERIAL we already own between two locations.
 *
 * The case, dated: 86 m of GOF cloth is delivered to Ksaman Naturals' bench.
 * She keeps what she will cut; the rest goes on to our warehouse, or to a
 * second partner who does the next operation. That onward hop is a real
 * movement of real stock and, until now, there was no way to record it.
 *
 * 🔴 It is NOT a second receipt on the inventory order. The order's receipt
 * says what arrived from the supplier; posting the balance straight to the
 * warehouse at that moment would put stock somewhere it physically is not —
 * the same error as treating a carrier's `Delivered` as a count, one layer up.
 * The cloth is at the partner's bench until somebody at the far end counts it.
 *
 * ## Why this reuses `goods_transfer`
 *
 * #891 already solved the hard half for a run's finished output: from → to, an
 * optional carrier booking, an `in_transit` state, and — the part worth reusing
 * most — a deliberate split between `received_at` (someone counted the box) and
 * `inventory_posted_at` (it is on our books). Material needs all of that.
 *
 * What it does NOT need is the approval gate. That gate exists because partner
 * completion is a CLAIM and admin approval is our acceptance of it. Nothing was
 * produced here, so there is no claim; the only gate is the count at the far
 * end. `planTransferMove` already skips the gate when passed no run, which is
 * exactly right — see `requiresRunApproval`.
 *
 * ## Nothing moves on send
 *
 * Stock stays counted at the ORIGIN for the whole journey and moves in one step
 * on receipt. A decrement on dispatch would make the material exist nowhere
 * while it is on a van, and "nowhere" is the state that makes a consumption log
 * go negative.
 */

import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import {
  assertReceivableMaterialTransfer,
  materialTransferItemId,
  validateMaterialTransfer,
} from "../../modules/fullfilled_orders/lib/transfer-kind"
import {
  moveInventory,
  planTransferMove,
  transferShortfall,
} from "../production-runs/receive-goods-transfer"

export type CreateMaterialTransferInput = {
  inventoryItemId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  /** Why it is moving. Defaults to `stock` — parking it at the destination. */
  reason?: "finishing" | "qc" | "packaging" | "stock" | "other"
  /** The inventory order this material originally came in on, for the trail. */
  sourceInventoryOrderId?: string | null
  notes?: string | null
  actingUserId?: string | null
}

export type MaterialTransfer = {
  id: string
  inventory_item_id: string | null
  from_location_id: string
  to_location_id: string | null
  quantity: number
  status: string
  [k: string]: any
}

/**
 * Record an onward movement of material. Nothing is posted yet.
 *
 * Born `in_transit` rather than `draft`: a material hop is recorded because it
 * is happening — the partner is handing the roll over — and a draft state here
 * would be a row nobody ever advances.
 */
export async function createMaterialTransfer(
  container: MedusaContainer,
  input: CreateMaterialTransferInput
): Promise<MaterialTransfer> {
  const validation = validateMaterialTransfer({
    inventory_item_id: input.inventoryItemId,
    from_location_id: input.fromLocationId,
    to_location_id: input.toLocationId,
    quantity: input.quantity,
  })
  if (!validation.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, validation.message)
  }

  const service: any = container.resolve(FULLFILLED_ORDERS_MODULE)

  const row = await service.createGoodsTransfers({
    // 🔴 Null, and that is the discriminator. A material transfer has no run,
    // and a placeholder here would make `classifyTransfer` read it as output
    // and hold it behind an approval that can never arrive.
    production_run_id: null,
    inventory_item_id: input.inventoryItemId,
    design_id: null,
    quantity: input.quantity,
    from_location_id: input.fromLocationId,
    to_location_id: input.toLocationId,
    reason: input.reason ?? "stock",
    status: "in_transit",
    shipped_at: new Date(),
    notes: input.notes ?? null,
    metadata: {
      kind: "material",
      source_inventory_order_id: input.sourceInventoryOrderId ?? null,
      created_by: input.actingUserId ?? null,
    },
  })

  return (Array.isArray(row) ? row[0] : row) as MaterialTransfer
}

export type ReceiveMaterialTransferInput = {
  transferId: string
  /** What was actually counted. Omit to accept the quantity that was sent. */
  receivedQuantity?: number | null
  notes?: string | null
  actingUserId?: string | null
}

export type ReceiveMaterialTransferResult = {
  transfer_id: string
  moved: boolean
  skip_reason?: string
  quantity: number
  inventory_item_id: string | null
  from_location_id: string
  to_location_id?: string
  /** Sent minus counted, never negative. */
  shortfall: number
}

/**
 * Count the material in at the far end, and move the stock.
 *
 * The receipt and the posting happen together here — unlike run output, there
 * is no approval that could arrive later, so holding the two apart would leave
 * material stranded at an origin it has physically left.
 */
export async function receiveMaterialTransfer(
  container: MedusaContainer,
  input: ReceiveMaterialTransferInput
): Promise<ReceiveMaterialTransferResult> {
  const service: any = container.resolve(FULLFILLED_ORDERS_MODULE)

  const [transfer] = await service.listGoodsTransfers(
    { id: input.transferId },
    { take: 1 }
  )

  // Throws on a missing, already-received, cancelled, ambiguous or run-scoped
  // row. Receiving twice would move the same material twice.
  assertReceivableMaterialTransfer(transfer ?? null, input.transferId)

  const itemId = materialTransferItemId(transfer)
  if (!itemId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Transfer ${input.transferId} names no inventory item, so there is nothing to move.`
    )
  }

  // No run is passed, deliberately: the approval gate does not apply to
  // material. `planTransferMove` still refuses a same-location or zero move.
  const plan = planTransferMove(transfer, input.receivedQuantity, null)
  const shortfall = transferShortfall(transfer.quantity, input.receivedQuantity)

  if (plan.move && plan.to_location_id) {
    await moveInventory(
      container,
      itemId,
      plan.from_location_id,
      plan.to_location_id,
      plan.quantity
    )
  }

  await service.updateGoodsTransfers({
    id: input.transferId,
    status: "delivered",
    received_at: new Date(),
    received_quantity: plan.quantity,
    // Only set when the stock actually moved. A transfer received but not
    // posted is the one state a reader must not mistake for "moved".
    ...(plan.move ? { inventory_posted_at: new Date() } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  })

  return {
    transfer_id: input.transferId,
    moved: plan.move,
    skip_reason: plan.skip_reason,
    quantity: plan.quantity,
    inventory_item_id: itemId,
    from_location_id: plan.from_location_id,
    to_location_id: plan.to_location_id,
    shortfall,
  }
}
