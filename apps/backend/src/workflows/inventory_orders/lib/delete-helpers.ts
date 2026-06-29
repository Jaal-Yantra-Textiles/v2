import { MedusaError } from "@medusajs/framework/utils"

/**
 * Pure guards for deleting an inventory order (#778 H11). Kept container-free so
 * they're unit testable.
 */

/**
 * Statuses that must NOT be hard-deleted: stock has been posted and/or a carrier
 * fulfillment is active. Deleting these silently orphans posted stock and live
 * shipments. The order must be cancelled first (which reverses posted stock and
 * moves it to "Cancelled"), then it can be deleted.
 */
const NON_DELETABLE = new Set(["Shipped", "Delivered", "Partial"])

export const isDeletableStatus = (status: string | null | undefined): boolean =>
  !status || !NON_DELETABLE.has(status)

export const assertDeletable = (status: string | null | undefined): void => {
  if (!isDeletableStatus(status)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Inventory order in status "${status}" cannot be deleted; cancel it first (which reverses any posted stock and active fulfillments).`
    )
  }
}
