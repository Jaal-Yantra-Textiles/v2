import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  INVENTORY_ORDER_STATUS_CHANGED_EVENT,
} from "../workflows/inventory_orders/update-inventory-order"
import { INVENTORY_DEPENDENCY_MET_STATUS } from "../workflows/production-runs/lib/run-dependencies"
import { releaseRunsAwaitingInventoryOrder } from "../workflows/production-runs/lib/release-dependent-runs"

/**
 * Goods arriving release the stage that was waiting for them (#1529).
 *
 * A chain frequently opens with a supplier rather than a maker — a weaver is
 * sent an inventory order, and the partner who works that cloth cannot start
 * until it is with them. Before this, that edge existed only in someone's head:
 * an admin watched the inventory order and dispatched the next stage by hand,
 * and a delivery that landed overnight simply sat there.
 *
 * Deliberately keyed on `Delivered`, not `Shipped` — see
 * INVENTORY_DEPENDENCY_MET_STATUS. And deliberately hung off the order's
 * status-changed event, which `updateInventoryOrderStep` is the single choke
 * point for, so a delivery recorded by the partner, by an admin edit, or by the
 * shipment tracking sync all release the chain the same way.
 */
export default async function inventoryOrderDeliveredReleaseRuns({
  event,
  container,
}: SubscriberArgs<{ id?: string; status?: string; previous_status?: string | null }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const inventoryOrderId = event.data?.id
  const status = event.data?.status

  if (!inventoryOrderId || String(status) !== INVENTORY_DEPENDENCY_MET_STATUS) {
    return
  }

  try {
    await releaseRunsAwaitingInventoryOrder(container, String(inventoryOrderId))
  } catch (e: any) {
    // Never let this throw back into the event bus: the delivery is a fact that
    // has already been recorded, and failing here must not make it look
    // otherwise. The chain stays recoverable by hand.
    logger.error(
      `[inventory-order-delivered] failed to release runs waiting on ${inventoryOrderId}: ${e?.message || String(e)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: INVENTORY_ORDER_STATUS_CHANGED_EVENT,
}
