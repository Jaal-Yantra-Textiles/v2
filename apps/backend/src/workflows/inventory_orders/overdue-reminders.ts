/**
 * Pure selection logic for inventory-order overdue reminders (#778 H5).
 *
 * An order is "overdue" when it has an `expected_delivery_date` in the past and
 * is still open (not Delivered/Cancelled). To avoid re-nudging on every run, the
 * caller passes the set of order ids already reminded within the cooldown window
 * (derived from the inventory_order_activity log) — those are skipped.
 *
 * Kept free of any container/IO so it's unit-testable.
 */

export const INVENTORY_ORDER_REMINDER_OVERDUE_EVENT =
  "inventory_orders.inventory-order.reminder-overdue";

// Terminal statuses never get an overdue nudge.
const CLOSED_STATUSES = new Set(["Delivered", "Cancelled"]);

export type OverdueCandidate = {
  id: string;
  status?: string | null;
  expected_delivery_date?: string | Date | null;
  partner_id?: string | null;
};

export type OverdueReminder = {
  id: string;
  partner_id: string | null;
  expected_delivery_date: string;
  days_overdue: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function selectOverdueReminders(
  orders: OverdueCandidate[],
  recentlyRemindedIds: Set<string>,
  now: Date
): OverdueReminder[] {
  const out: OverdueReminder[] = [];
  for (const o of orders || []) {
    if (!o?.id) continue;
    if (o.status && CLOSED_STATUSES.has(o.status)) continue;
    if (!o.expected_delivery_date) continue;
    if (recentlyRemindedIds.has(o.id)) continue;

    const edd = new Date(o.expected_delivery_date);
    if (Number.isNaN(edd.getTime())) continue;
    if (edd.getTime() >= now.getTime()) continue; // not overdue yet

    const daysOverdue = Math.floor((now.getTime() - edd.getTime()) / MS_PER_DAY);
    out.push({
      id: o.id,
      partner_id: o.partner_id ?? null,
      expected_delivery_date: edd.toISOString(),
      days_overdue: daysOverdue,
    });
  }
  return out;
}
