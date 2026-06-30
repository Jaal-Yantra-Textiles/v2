import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ORDER_INVENTORY_MODULE } from "../modules/inventory_orders";
import type InventoryOrderService from "../modules/inventory_orders/service";
import {
  INVENTORY_ORDER_ACTIVITY_EVENTS,
  buildInventoryOrderActivity,
} from "../workflows/inventory_orders/activity-mapping";

/**
 * Records inventory-order lifecycle events as first-class
 * `inventory_order_activity` rows so the order timeline can be rendered without
 * stuffing arrays into `inventory_orders.metadata` (#778 H4). Mirrors
 * production-run-activity-recorder.
 *
 * Listens to the events that already exist today:
 *   - inventory_orders.inventory-order.status-changed (#776) — every transition
 *   - inventory_order_assigned_to_partner
 *   - inventory_order_partner_link_rolled_back
 *
 * Dedicated start/complete/partial/cancel/payment events arrive in #782 (H1)
 * and slot in via the same pure mapping.
 */
export default async function inventoryOrderActivityRecorder({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const eventData = (event.data || {}) as Record<string, any>;

  const activity = buildInventoryOrderActivity(event.name, eventData, new Date());
  if (!activity) {
    return;
  }

  try {
    const service: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    await service.createInventoryOrderActivities(activity as any);
  } catch (e: any) {
    logger.error(
      `[inventory-order-activity-recorder] failed to write activity for ${event.name} order=${activity.inventory_order_id}: ${e?.message}`
    );
  }
}

export const config: SubscriberConfig = {
  event: [...INVENTORY_ORDER_ACTIVITY_EVENTS],
};
