import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { ORDER_INVENTORY_MODULE } from "../modules/inventory_orders";
import type InventoryOrderService from "../modules/inventory_orders/service";
import {
  selectOverdueReminders,
  INVENTORY_ORDER_REMINDER_OVERDUE_EVENT,
} from "../workflows/inventory_orders/overdue-reminders";

/**
 * #778 H5 — overdue inventory-order reminders.
 *
 * Finds open inventory orders whose `expected_delivery_date` is in the past and
 * nudges once per cooldown window. Idempotency uses the #778-H4 activity log: an
 * `overdue` reminder activity is written per order (so the next run sees it and
 * skips), and a `reminder-overdue` event is emitted for downstream notifications
 * / visual flows. Best-effort — one bad order never aborts the batch.
 */
const COOLDOWN_DAYS = Number(process.env.INVENTORY_OVERDUE_REMINDER_COOLDOWN_DAYS || 3);
const MAX_BATCH = Number(process.env.INVENTORY_OVERDUE_REMINDER_MAX_BATCH || 200);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default async function sendInventoryOrderOverdueReminders(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY);
  const service: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
  const eventBus: any = container.resolve(Modules.EVENT_BUS);
  const now = new Date();

  try {
    // 1) Candidate open orders with a past expected delivery date. The pure
    //    selector re-applies the open/overdue checks so this stays testable.
    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "status", "expected_delivery_date", "partner.id"],
      filters: {
        status: { $nin: ["Delivered", "Cancelled"] },
        expected_delivery_date: { $lt: now },
      },
      pagination: { take: MAX_BATCH },
    });

    const candidates = (orders || []).map((o: any) => ({
      id: o.id,
      status: o.status,
      expected_delivery_date: o.expected_delivery_date,
      partner_id: Array.isArray(o.partner) ? o.partner[0]?.id ?? null : o.partner?.id ?? null,
    }));
    if (!candidates.length) {
      return;
    }

    // 2) Orders already reminded within the cooldown window (from the activity
    //    log) — skip them.
    const cutoff = new Date(now.getTime() - COOLDOWN_DAYS * MS_PER_DAY);
    const recent = await service.listInventoryOrderActivities(
      { kind: "overdue", occurred_at: { $gte: cutoff } } as any,
      { take: 5000 } as any
    );
    const recentIds = new Set((recent || []).map((a: any) => a.inventory_order_id));

    // 3) Pure selection.
    const due = selectOverdueReminders(candidates, recentIds, now);
    if (!due.length) {
      return;
    }

    // 4) Record an activity row (idempotency marker) + emit an event per order.
    let reminded = 0;
    for (const d of due) {
      try {
        await service.createInventoryOrderActivities({
          inventory_order_id: d.id,
          activity_type: "reminder_sent",
          kind: "overdue",
          actor_type: "scheduled_flow",
          actor_id: null,
          partner_id: d.partner_id,
          channel: null,
          message_id: null,
          template_name: null,
          recipient: null,
          summary: `Overdue: ${d.days_overdue} day(s) past expected delivery`,
          payload: {
            days_overdue: d.days_overdue,
            expected_delivery_date: d.expected_delivery_date,
          },
          occurred_at: now,
        } as any);

        await eventBus.emit({
          name: INVENTORY_ORDER_REMINDER_OVERDUE_EVENT,
          data: {
            inventory_order_id: d.id,
            partner_id: d.partner_id,
            days_overdue: d.days_overdue,
            expected_delivery_date: d.expected_delivery_date,
          },
        });
        reminded++;
      } catch (e: any) {
        logger.error(
          `[inventory-overdue-reminders] failed for ${d.id}: ${e?.message}`
        );
      }
    }

    logger.info(
      `[inventory-overdue-reminders] reminded ${reminded}/${due.length} overdue order(s)`
    );
  } catch (e: any) {
    logger.error(`[inventory-overdue-reminders] batch failed: ${e?.message}`);
  }
}

export const config = {
  name: "inventory-order-overdue-reminders",
  // Daily at 09:00.
  schedule: "0 9 * * *",
};
