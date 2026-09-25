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
import productionRunReservationsLink from "../../links/production-run-reservations-link"
import { resolveRunVariant } from "./lib/run-variant"

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
  | "unapproved_run"

export type TransferMovePlan = {
  move: boolean
  quantity: number
  from_location_id: string
  to_location_id?: string
  skip_reason?: MoveSkipReason
  /**
   * What the run ACCEPTED, when the approval said. `null` means the run states
   * no quantities at all, which is not the same as zero — the plan then trusts
   * what was counted rather than inventing a cap.
   */
  accepted_quantity?: number | null
}

/** The approval facts a posting decision needs. Nothing else from the run. */
export type RunApprovalFacts = {
  approval_decision?: string | null
  produced_quantity?: number | null
  rejected_quantity?: number | null
}

/**
 * PURE: how many units did this run's approval actually ACCEPT?
 *
 * `produced_quantity` is the partner's claim; `rejected_quantity` is what the
 * review threw out. Accepted is the difference, floored at 0 — a rejected count
 * larger than the produced one is a data error, and a negative acceptance would
 * post a movement backwards.
 *
 * Returns null when the run states no produced quantity. Null is "unstated",
 * not zero: capping a real receipt at 0 because a column was never filled in
 * would silently strand goods that are physically at the destination.
 */
export function acceptedQuantity(run: RunApprovalFacts): number | null {
  const produced = run.produced_quantity
  if (produced == null || Number.isNaN(Number(produced))) return null
  const rejected = Number(run.rejected_quantity ?? 0) || 0
  return Math.max(0, Number(produced) - rejected)
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
  receivedQuantity?: number | null,
  run?: RunApprovalFacts | null
): TransferMovePlan {
  const sent = Number(transfer.quantity ?? 0)
  const counted = Number(
    receivedQuantity == null || Number.isNaN(Number(receivedQuantity))
      ? sent
      : receivedQuantity
  )

  const from = String(transfer.from_location_id || "")
  const to = transfer.to_location_id ? String(transfer.to_location_id) : undefined

  /**
   * 🔴 Post only what was ACCEPTED (2026-09-13 founder call).
   *
   * A run that produced 3 and had 1 rejected accepted 2. Posting all 3 would
   * put a rejected garment in our books at our location while it is physically
   * still the partner's problem — a wrong SPLIT, which is the exact family that
   * once minted a phantom jacket and put it on sale at ₹11,000.
   *
   * The cap is a MINIMUM against what was counted, never a replacement for it:
   * if 2 were accepted but only 1 arrived, 1 moved. Goods that did not turn up
   * are not posted because the paperwork says they were accepted.
   */
  const accepted = run ? acceptedQuantity(run) : null
  const quantity = accepted == null ? counted : Math.min(counted, accepted)

  const base = {
    quantity,
    from_location_id: from,
    to_location_id: to,
    accepted_quantity: accepted,
  }

  if (!to) return { ...base, move: false, skip_reason: "customer_leg" }
  if (from && from === to) return { ...base, move: false, skip_reason: "same_location" }

  /**
   * 🔴 THE APPROVAL GATE (#891, 2026-09-13).
   *
   * Partner completion is a CLAIM; admin approval is the ACCEPTANCE of that
   * claim, and stock must not enter our books on an unaccepted one. Checked
   * before the quantity test so an unapproved run reports why it did not post,
   * rather than hiding behind a zero it was capped to.
   *
   * The receipt still happens — the box really did arrive, and refusing to
   * record that would lose a physical fact to an accounting rule. What does not
   * happen is the movement. `inventory_posted_at` stays null, and the approval
   * path posts it later; that column is the only thing standing between this
   * gate and goods stranded on the partner's books forever.
   *
   * A run passed as null/undefined is NOT treated as unapproved: callers that
   * do not know the run (and the historical backfill) keep the old behaviour
   * rather than silently declining to move real goods.
   */
  if (run && run.approval_decision !== "approved") {
    return { ...base, move: false, skip_reason: "unapproved_run" }
  }

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
  run: {
    variant_id?: string | null
    approved_variant_id?: string | null
    design_id?: string | null
  }
): Promise<string | undefined> {
  /**
   * 🔴 Was a verbatim second copy of `stockFinishedGoodsStep`'s resolution —
   * run's variant wins, else `design_product_variant[0]`, then variant →
   * inventory item. Two copies of "what did this run make" is how the two ends
   * of a goods movement come to credit different products.
   *
   * `undefined` covers both "no variant yet" and "the design has several and
   * nothing says which" — the caller credits nothing either way, which is the
   * safe outcome here: a hop that cannot name the product must not invent one.
   * See `lib/run-variant.ts`. #2057
   */
  const resolved = await resolveRunVariant(container, {
    variant_id: run.variant_id,
    approved_variant_id: run.approved_variant_id,
    design_id: run.design_id,
  })
  return resolved.inventory_item_id
}

/**
 * Move `quantity` of `inventoryItemId` from one location to the other.
 *
 * Exported for the MATERIAL transfer path (#2144), which moves cloth between
 * two locations with no run behind it. Same arithmetic, same origin clamp —
 * deliberately shared rather than copied, because two functions that both
 * decrement stock are two chances to disagree about whether an origin may go
 * negative.
 *
 * Read-then-absolute-write, because this codebase has no `adjustInventory` —
 * which is exactly why the origin side is clamped at zero. An origin level that
 * is already short must not be driven negative by a receipt; the shortfall is
 * reported instead.
 */
export async function moveInventory(
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
/**
 * PURE: the reservations at this location that belong to this run.
 *
 * `linkedIds` is what the typed production-run↔reservation link says. When it
 * says anything, it decides. When it says NOTHING we fall back to
 * `metadata.production_run_id` — not for elegance, but because an empty link
 * result is indistinguishable from "this run holds no reservations", and every
 * reservation created before #2029 item 3 carries only the blob. Concluding
 * "none" there would strand exactly the rows this function exists to move.
 *
 * Exported for tests: the choice between the two sources is the whole decision,
 * and it should be assertable without an inventory module behind it.
 */
export function selectRunReservations(
  reservations: any,
  productionRunId: string,
  linkedIds?: ReadonlySet<string> | null
): any[] {
  const all = Array.isArray(reservations) ? reservations : []
  if (linkedIds && linkedIds.size > 0) {
    return all.filter((r: any) => linkedIds.has(String(r?.id ?? "")))
  }
  return all.filter(
    (r: any) => String(r?.metadata?.production_run_id || "") === productionRunId
  )
}

/**
 * The reservation ids the link claims for this run, or an empty set.
 *
 * Never throws: a link read that fails must degrade to the blob scan, which is
 * what shipped before, rather than stranding reservations at the origin.
 */
export async function readLinkedReservationIds(
  container: MedusaContainer,
  productionRunId: string
): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: productionRunReservationsLink.entryPoint,
      filters: { production_runs_id: productionRunId },
      fields: ["reservation_item_id"],
    })
    for (const row of (data || []) as any[]) {
      const id = String(row?.reservation_item_id ?? "").trim()
      if (id) {
        ids.add(id)
      }
    }
  } catch {
    // Fall through to the blob scan.
  }
  return ids
}

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

  /**
   * Which of these belong to this run (#2029 item 3).
   *
   * The typed link is asked first. It used to be a JSON scan — `metadata` is
   * not filterable, so every reservation at the location was listed and sifted
   * in-app, which is what the old comment here admitted.
   *
   * ⚠️ The link is read as a SET of ids and intersected with the list above,
   * rather than used to fetch reservations directly. The list is already scoped
   * to the origin location, and that scoping is load-bearing: a reservation the
   * run holds somewhere ELSE must not be dragged to this destination by a
   * receipt it had nothing to do with.
   */
  const linkedIds = await readLinkedReservationIds(container, productionRunId)
  const mine = selectRunReservations(reservations, productionRunId, linkedIds)

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

  const plan = planTransferMove(transfer, input.received_quantity, run)
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
    /**
     * Stamped ONLY when inventory actually moved. A receipt that was gated by
     * `unapproved_run` leaves this null, which is what
     * `postPendingTransfersForRun` looks for when the approval lands. Setting
     * it on every receipt would make the deferred posting unfindable and strand
     * the goods on the partner's books permanently.
     */
    ...(result.moved ? { inventory_posted_at: new Date() } : {}),
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


/**
 * #891 (2026-09-13) — post the transfers that were RECEIVED BEFORE the run was
 * approved.
 *
 * The approval gate in `planTransferMove` means a box can arrive, be counted,
 * and move no stock because the claim had not been accepted yet. Without this,
 * that is permanent: `assertReceivableTransfer` refuses a second receipt (
 * rightly — it would move the same goods twice), so nothing would ever come
 * back to post the movement, and the goods would sit physically at our location
 * while our books still called them the partner's.
 *
 * So the posting is "delivered AND approved", whichever happens second:
 *
 *   approved → then received   the receipt posts, inline
 *   received → then approved   this posts it, here
 *
 * Idempotent by construction — it only ever looks at delivered transfers whose
 * `inventory_posted_at` is null, and stamps it as it posts. Re-approving a run
 * finds nothing to do. Transfers that predate the column read null and are
 * excluded by `received_at`-ordering plus the explicit legacy guard below,
 * because a legacy delivered transfer WAS already posted by the old
 * unconditional path and posting it again would double the stock.
 */
export async function postPendingTransfersForRun(
  container: MedusaContainer,
  runId: string,
  /**
   * Transfers received before this instant are treated as legacy — already
   * posted by the unconditional path that shipped before the column existed.
   * Defaults to the column's own release, so a real deployment needs no
   * argument and a test can pin it.
   */
  legacyBefore: Date = INVENTORY_POSTING_COLUMN_RELEASED_AT
): Promise<{ posted: number; skipped: number }> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const transferService: any = container.resolve(FULLFILLED_ORDERS_MODULE)

  const transfers: any[] = await transferService.listGoodsTransfers({
    production_run_id: runId,
    status: "delivered",
  })

  const pending = transfers.filter((t: any) =>
    isPendingPosting(t, legacyBefore)
  )
  if (!pending.length) return { posted: 0, skipped: 0 }

  const run = await runService.retrieveProductionRun(runId)

  let posted = 0
  let skipped = 0

  for (const transfer of pending) {
    const plan = planTransferMove(transfer, transfer.received_quantity, run)
    if (!plan.move || !plan.to_location_id) {
      skipped++
      continue
    }

    const inventoryItemId = await resolveRunInventoryItem(container, run)
    if (!inventoryItemId) {
      logger.warn(
        `[goods-transfer] run ${runId} approved but no inventory item resolves — transfer ${transfer.id} still unposted`
      )
      skipped++
      continue
    }

    await moveInventory(
      container,
      inventoryItemId,
      plan.from_location_id,
      plan.to_location_id,
      plan.quantity
    )
    const repointed = await repointReservations(
      container,
      runId,
      inventoryItemId,
      plan.from_location_id,
      plan.to_location_id
    )

    await transferService.updateGoodsTransfers({
      id: transfer.id,
      inventory_posted_at: new Date(),
    })

    posted++
    logger.info(
      `[goods-transfer] approval posted deferred transfer ${transfer.id}: ` +
        `${plan.quantity} unit(s) ${plan.from_location_id} → ${plan.to_location_id}, ` +
        `${repointed} reservation(s) repointed`
    )
  }

  return { posted, skipped }
}

/**
 * When `inventory_posted_at` shipped. A delivered transfer received BEFORE this
 * was posted by the old unconditional path, so its null means "legacy", not
 * "pending" — and posting it again would double real stock.
 */
export const INVENTORY_POSTING_COLUMN_RELEASED_AT = new Date("2026-09-17T00:00:00.000Z")

/**
 * PURE: is this delivered transfer waiting for an approval to post it?
 *
 * 🔴 The null on `inventory_posted_at` means two opposite things depending on
 * WHEN the transfer was received, which is the whole reason this is a named
 * function with its own tests rather than an inline `!t.inventory_posted_at`:
 *
 *   received after the column shipped  → null means NOT POSTED (post it)
 *   received before                    → null means UNRECORDED (already posted)
 *
 * Treating the second as pending would move the same goods a second time.
 */
export function isPendingPosting(
  transfer: {
    status?: string | null
    received_at?: Date | string | null
    inventory_posted_at?: Date | string | null
  },
  legacyBefore: Date
): boolean {
  if (transfer.status !== "delivered") return false
  if (transfer.inventory_posted_at) return false
  if (!transfer.received_at) return false
  return new Date(transfer.received_at).getTime() >= legacyBefore.getTime()
}
