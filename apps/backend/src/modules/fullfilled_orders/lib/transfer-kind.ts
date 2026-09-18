/**
 * #2144 — the two kinds of goods transfer, and what tells them apart.
 *
 * `goods_transfer` was built for one movement (#891): a production run's
 * FINISHED OUTPUT travelling from the partner who made it to wherever it is
 * finished, QC'd, stocked or shipped. Everything about it assumes a run — the
 * inventory item is derived from the run's variant, and posting is gated on the
 * run's approval, because partner completion is a claim and approval is our
 * acceptance of it.
 *
 * Material moves too, and none of that applies. Cloth we already bought lands
 * at a partner's bench and part of it goes on to our warehouse, or to a second
 * partner who will do the next operation. Nothing was produced, so there is no
 * claim to accept and no approval to wait for. The only question at the far end
 * is whether somebody counted it.
 *
 * 🔴 So the row carries exactly ONE of `production_run_id` / `inventory_item_id`
 * and that pair is the discriminator. Both set is ambiguous — two different
 * rules would claim the same row, and they disagree about whether an approval
 * gate applies. Neither set is unusable: nothing says what moved.
 *
 * These are pure so the classification can be tested without a container, and
 * because getting it wrong moves real stock to the wrong place.
 */

import { MedusaError } from "@medusajs/framework/utils"

export type TransferKind = "run_output" | "material"

export type TransferKindFacts = {
  id?: string | null
  production_run_id?: string | null
  inventory_item_id?: string | null
}

export type TransferClassification =
  | { ok: true; kind: TransferKind }
  | { ok: false; reason: "ambiguous" | "unspecified"; message: string }

const present = (v: unknown): boolean =>
  typeof v === "string" && v.trim().length > 0

/**
 * PURE: which kind of movement is this row?
 *
 * Returns a refusal rather than guessing. A row with both ids set could be read
 * either way, and the two readings disagree on the approval gate — one of them
 * would post unapproved output to our books.
 */
export function classifyTransfer(
  transfer: TransferKindFacts | null | undefined
): TransferClassification {
  const hasRun = present(transfer?.production_run_id)
  const hasItem = present(transfer?.inventory_item_id)

  if (hasRun && hasItem) {
    return {
      ok: false,
      reason: "ambiguous",
      message:
        `Transfer ${transfer?.id ?? "(new)"} names both a production run and an inventory item. ` +
        `One is run output (posting waits for the run's approval) and the other is material ` +
        `(posting waits only for someone to count it) — the row cannot be both.`,
    }
  }
  if (hasRun) return { ok: true, kind: "run_output" }
  if (hasItem) return { ok: true, kind: "material" }

  return {
    ok: false,
    reason: "unspecified",
    message:
      `Transfer ${transfer?.id ?? "(new)"} names neither a production run nor an inventory item, ` +
      `so nothing says what moved.`,
  }
}

/** Convenience: the kind, or null when the row is not classifiable. */
export const transferKind = (
  transfer: TransferKindFacts | null | undefined
): TransferKind | null => {
  const c = classifyTransfer(transfer)
  return c.ok ? c.kind : null
}

/**
 * PURE: does the approval gate apply to this transfer?
 *
 * Only run output has an approval to wait for. Stated as its own function
 * because the alternative — every caller remembering to pass `run: null` for
 * material — is one forgotten argument away from holding a partner's cloth
 * hostage to an approval that will never exist, since there is no run to
 * approve.
 */
export const requiresRunApproval = (
  transfer: TransferKindFacts | null | undefined
): boolean => transferKind(transfer) === "run_output"

export type MaterialTransferDraft = {
  inventory_item_id?: string | null
  from_location_id?: string | null
  to_location_id?: string | null
  quantity?: number | null
}

export type MaterialTransferValidation =
  | { ok: true }
  | { ok: false; message: string }

/**
 * PURE: is this a movement we can actually carry out?
 *
 * 🔴 A material transfer must name a DESTINATION. On run output a missing
 * destination means the customer leg — goods leaving for a buyer, where the
 * core fulfillment path does the decrement and this one deliberately does
 * nothing. Material has no such leg, so a missing destination here is not a
 * special case to skip; it is a movement to nowhere, and skipping it silently
 * would leave the material counted at the origin while somebody carries it away.
 */
export function validateMaterialTransfer(
  draft: MaterialTransferDraft
): MaterialTransferValidation {
  if (!present(draft.inventory_item_id)) {
    return { ok: false, message: "A material transfer must name the inventory item being moved." }
  }
  if (!present(draft.from_location_id)) {
    return { ok: false, message: "A material transfer must name where the material is now." }
  }
  if (!present(draft.to_location_id)) {
    return {
      ok: false,
      message:
        "A material transfer must name a destination. Unlike a run's output, material has no customer leg — a movement with nowhere to go would leave the material counted where it no longer is.",
    }
  }
  if (String(draft.from_location_id) === String(draft.to_location_id)) {
    return { ok: false, message: "Origin and destination are the same location — nothing would move." }
  }
  const qty = Number(draft.quantity ?? 0)
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, message: `A material transfer must move a positive quantity (got ${draft.quantity}).` }
  }
  return { ok: true }
}

/**
 * PURE: the inventory item a transfer moves, when the row names it itself.
 *
 * Run output derives its item from the run's variant/design
 * (`resolveTransferInventoryItem`) because a run is the only thing that says
 * what was made. Material names it outright — there is nothing to derive from.
 */
export const materialTransferItemId = (
  transfer: TransferKindFacts | null | undefined
): string | null =>
  present(transfer?.inventory_item_id) ? String(transfer!.inventory_item_id) : null

/**
 * May this material transfer be received?
 *
 * Throws, mirroring `assertReceivableTransfer` on the run path — every caller's
 * only sensible response is to stop, and a boolean invites one of them not to.
 * Scoped by the row itself rather than by a parent run, because a material
 * transfer has no parent.
 */
export function assertReceivableMaterialTransfer(
  transfer: (TransferKindFacts & { status?: string | null }) | null,
  requestedId: string
): void {
  if (!transfer) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Material transfer ${requestedId} not found.`
    )
  }
  const classified = classifyTransfer(transfer)
  if (!classified.ok || classified.kind !== "material") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      classified.ok
        ? `Transfer ${requestedId} is a production run's output — receive it on the run, where its approval gate applies.`
        : classified.message
    )
  }
  if (transfer.status === "delivered") {
    // Receiving twice moves the stock twice. The first receipt is the record;
    // a correction is a new transfer, not a second receipt.
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Transfer ${requestedId} has already been received — receiving it again would move the same material twice.`
    )
  }
  if (transfer.status === "cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Transfer ${requestedId} is cancelled — material that was never sent cannot be received.`
    )
  }
}
