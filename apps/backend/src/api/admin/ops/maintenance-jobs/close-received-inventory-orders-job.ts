import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import { mirrorInventoryOrderStatusToUnified } from "../../../../workflows/inventory_orders/dual-write-unified-order"
import { planCloseAsReceived } from "../../../../workflows/inventory_orders/lib/plan-close-as-received"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

export const MAX_CLOSE_AS_RECEIVED = 50

const idList = z
  .string()
  .optional()
  .transform((v) =>
    Array.from(
      new Set(
        (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  )

const paramsSchema = z.object({
  order_ids: idList.refine(
    (ids) => ids.length > 0 && ids.length <= MAX_CLOSE_AS_RECEIVED,
    `order_ids must name 1–${MAX_CLOSE_AS_RECEIVED} inventory orders`
  ),
  confirmed_on_books: idList,
  note: z.string().trim().min(5, "note is required: say how the stock was verified"),
})

/**
 * Close inventory orders whose goods are already on the books: status →
 * `Delivered`, and nothing else. The decision lives in `planCloseAsReceived`.
 *
 * 🔴 What it deliberately does NOT do, and why:
 *
 *  - **Post stock.** The goods are already counted; posting is exactly the
 *    double-count this job exists to avoid.
 *  - **Emit `inventory-order.status-changed`** (or the service's generic
 *    `updated`). The partner WhatsApp status flow sends "Delivered" on that
 *    event, and these are orders the partner finished months ago. The status
 *    is written with one SQL UPDATE (compare-and-set on the status read), and
 *    the timeline row the recorder would have written is written here instead.
 *  - **Release dependent runs.** That rides the same event; closing an order
 *    that a run still waits on must go through the real receipt instead.
 *
 * It DOES mirror the status to the work order (core status + partner_status),
 * stamp `metadata.closed_as_received`, and — by leaving the open statuses —
 * stop the overdue reminders.
 */
export const closeReceivedInventoryOrdersJob: MaintenanceJob = {
  id: "close-received-inventory-orders",
  label: "Close inventory orders already on the books as Delivered (no stock, no message)",
  description:
    "Move Shipped/Partial inventory orders whose goods are ALREADY on the books to Delivered — WITHOUT posting stock (admin Deliver would post them a second time) and WITHOUT the status-changed event (which WhatsApps the partner). An order closes when its typed receipts cover every line (±0.5 for pre-2026-06-12 integer rounding), or when you name it in confirmed_on_books after verifying its stock by other means. Always refuses an order with metadata.reversal_note. Mirrors the work-order status, stamps metadata.closed_as_received, writes a timeline row, and stops the overdue reminders. Refuses an order that a production run still waits on (depends_on_inventory_order_ids) — that needs a real receipt. Dry-run shows the decision per order.",
  params: [
    {
      name: "order_ids",
      type: "string",
      required: true,
      description: `Comma-separated inventory order ids (max ${MAX_CLOSE_AS_RECEIVED})`,
    },
    {
      name: "confirmed_on_books",
      type: "string",
      required: false,
      description:
        "Comma-separated subset of order_ids whose stock you verified on the books although typed receipts fall short",
    },
    {
      name: "note",
      type: "string",
      required: true,
      description: "How the stock was verified — recorded on every order closed",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_ids, confirmed_on_books, note } = parsed.data
    const confirmed = new Set(confirmed_on_books)
    const stray = confirmed_on_books.filter((id) => !order_ids.includes(id))
    if (stray.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `confirmed_on_books names orders not in order_ids: ${stray.join(", ")}`
      )
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const inventoryOrders: any = container.resolve(ORDER_INVENTORY_MODULE)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "status",
        "metadata",
        "orderlines.id",
        "orderlines.quantity",
        "orderlines.line_fulfillments.quantity_delta",
      ],
      filters: { id: order_ids },
    })
    const byId = new Map<string, any>((orders ?? []).map((o: any) => [o.id, o]))

    // A run gated on one of these orders is released by the status-changed
    // event this job does not emit — so such an order is refused, not closed.
    const { data: gatedRuns } = await query.graph({
      entity: "production_runs",
      fields: ["id", "status", "depends_on_inventory_order_ids"],
      filters: { status: ["approved", "sent_to_partner", "in_progress"] },
    })
    const waitingRun = new Map<string, string>()
    for (const r of (gatedRuns ?? []) as any[]) {
      for (const oid of (r.depends_on_inventory_order_ids ?? []) as string[]) {
        if (!waitingRun.has(oid)) waitingRun.set(oid, r.id)
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let closed = 0

    for (const id of order_ids) {
      const order = byId.get(id)
      if (!order) {
        errors.push({ id, message: "inventory order not found" })
        continue
      }
      if (waitingRun.has(id)) {
        errors.push({
          id,
          message: `production run ${waitingRun.get(id)} waits on this order — receive it for real so the run is released`,
        })
        continue
      }

      const plan = planCloseAsReceived({
        order_id: id,
        status: order.status,
        metadata: order.metadata,
        confirmed_on_books: confirmed.has(id),
        lines: ((order.orderlines ?? []) as any[]).filter(Boolean).map((ol) => ({
          id: String(ol.id),
          quantity: ol.quantity,
          received: ((ol.line_fulfillments ?? []) as any[]).reduce(
            (sum, f) => sum + (Number(f?.quantity_delta) || 0),
            0
          ),
        })),
      })

      if (!plan.ok) {
        errors.push({ id, message: plan.reason })
        continue
      }

      const shortNote = plan.short_lines.length
        ? ` · typed receipts short on ${plan.short_lines
            .map((l) => `${l.line_id} (${l.received}/${l.ordered})`)
            .join(", ")} — operator confirmed on the books`
        : ""
      const change: MaintenanceChange = {
        entity: "inventory_order",
        id,
        field: "status",
        before: order.status,
        after: "Delivered",
        note: `${plan.mode}${shortNote} · no stock posted, no partner message`,
      }

      if (dry_run) {
        changes.push(change)
        continue
      }

      const closedAt = new Date().toISOString()
      const metadata = {
        ...(order.metadata ?? {}),
        closed_as_received: {
          at: closedAt,
          previous_status: order.status,
          mode: plan.mode,
          short_lines: plan.short_lines,
          note,
          job: "close-received-inventory-orders",
        },
      }

      // Compare-and-set on the status we planned from: a concurrent receipt or
      // cancel wins, and this order is reported rather than overwritten.
      const result = await pg.raw(
        `update inventory_orders
            set status = 'Delivered', metadata = ?::jsonb, updated_at = now()
          where id = ? and status = ? and deleted_at is null
         returning id`,
        [JSON.stringify(metadata), id, order.status]
      )
      const rows = result?.rows ?? result ?? []
      if (!rows.length) {
        errors.push({ id, message: `status moved from '${order.status}' while running — not closed` })
        continue
      }

      const mirror = await mirrorInventoryOrderStatusToUnified(container, id)

      await inventoryOrders.createInventoryOrderActivities({
        inventory_order_id: id,
        activity_type: "lifecycle_event",
        kind: "status_changed",
        actor_type: "admin",
        actor_id: null,
        partner_id: null,
        channel: null,
        message_id: null,
        template_name: null,
        recipient: null,
        summary: `Closed as received: ${order.status} → Delivered. No stock posted, no partner message. ${note}`,
        payload: {
          previous_status: order.status,
          status: "Delivered",
          closed_as_received: true,
          mode: plan.mode,
        },
        occurred_at: new Date(closedAt),
      })

      closed++
      changes.push({
        ...change,
        note: `${change.note}${mirror.linked ? "" : ` · ⚠️ work-order mirror: ${mirror.skipped ?? mirror.error}`}`,
      })
    }

    const verb = dry_run ? "Would close" : "Closed"
    return {
      job_id: "close-received-inventory-orders",
      dry_run,
      applied: !dry_run && closed > 0,
      summary: `${verb} ${dry_run ? changes.length : closed} of ${order_ids.length} order(s) as Delivered with no stock posted; ${errors.length} refused.`,
      changes,
      errors,
    }
  },
}
