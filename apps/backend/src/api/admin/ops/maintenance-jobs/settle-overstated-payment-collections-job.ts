import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { findOverstatedCollections } from "./lib/overstated-payment-collection"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — close payment collections that ask for more than the order
 * still owes (#2583).
 *
 * An order edit grew an open collection after the buyer's payment page was
 * already showing the old amount; the buyer paid that, the rest was raised as
 * a second collection and paid too. The order is paid in full, yet the first
 * collection sits `partially_captured` and so does the order (#101: A$441.79
 * captured against A$441.79 owed, shown as part paid).
 *
 * Only ever touches an order whose net captures across every collection cover
 * its total — see `findOverstatedCollections`. Moves no money, captures
 * nothing, emails nobody. Safe to re-run: a settled collection is skipped.
 */
const DEFAULT_LIMIT = 500

const ORDER_FIELDS = [
  "id",
  "display_id",
  "total",
  "currency_code",
  "payment_collections.id",
  "payment_collections.status",
  "payment_collections.amount",
  "payment_collections.currency_code",
  "payment_collections.payments.id",
  "payment_collections.payments.captures.amount",
  "payment_collections.payments.refunds.amount",
]

export const settleOverstatedPaymentCollectionsJob: MaintenanceJob = {
  id: "settle-overstated-payment-collections",
  label: "Settle overstated payment collections",
  description:
    "Find orders that are paid in full but still show as part paid because one payment collection asks for more than it captured — an order edit grew that collection after the buyer's payment page already showed the old amount, and the difference was collected through a second collection (#2583, order #101). For each such order, sets the overstated collection's amount to what it actually captured (net of refunds) and marks it completed. ONLY when the order's captures across ALL its collections already cover the order total — a part-captured collection on an order that still owes money is a real debt and is never touched. Moves no money, captures nothing, emails nobody. Safe to re-run.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Check one order only. Omit to sweep every part-captured collection.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Maximum collections to examine in a sweep (default ${DEFAULT_LIMIT}).`,
    },
  ],

  async run(container: any, opts): Promise<MaintenanceJobResult> {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const payment: any = container.resolve(Modules.PAYMENT)
    const limit = Math.min(Number(opts.params?.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 2000)
    const only = opts.params?.order_id ? String(opts.params.order_id) : null

    let orderIds: string[] = []
    if (only) {
      orderIds = [only]
    } else {
      const collections = (await payment.listPaymentCollections(
        { status: ["partially_captured"] },
        { select: ["id"], take: limit }
      )) as any[]
      const ids = (collections || []).map((c) => String(c.id))
      if (ids.length) {
        const { data: links } = await query.graph({
          entity: "order_payment_collection",
          fields: ["order_id", "payment_collection_id"],
          filters: { payment_collection_id: ids },
        })
        orderIds = Array.from(
          new Set(((links || []) as any[]).map((l) => String(l.order_id)).filter(Boolean))
        )
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let examined = 0
    let settled = 0
    let stillOwing = 0

    for (const orderId of orderIds) {
      let order: any
      try {
        const { data } = await query.graph({
          entity: "order",
          fields: ORDER_FIELDS,
          filters: { id: orderId },
        })
        order = data?.[0]
      } catch (e: any) {
        errors.push({ id: orderId, message: `order could not be read: ${e?.message ?? e}` })
        continue
      }
      if (!order) {
        errors.push({ id: orderId, message: "order not found" })
        continue
      }
      examined++

      const { verdicts, skipped_reason } = findOverstatedCollections({
        order_total: order.total,
        collections: order.payment_collections || [],
      })
      if (skipped_reason) {
        stillOwing++
        if (only) {
          changes.push({
            entity: "order",
            id: order.id,
            field: "skipped",
            note: `#${order.display_id}: ${skipped_reason}`,
          })
        }
        continue
      }

      for (const v of verdicts) {
        changes.push({
          entity: "payment_collection",
          id: v.collection_id,
          field: "amount",
          before: v.amount,
          after: v.captured,
          note: `order #${order.display_id} (${order.id}): ${v.reason}. Status → completed.`,
        })
        if (opts.dry_run) {
          settled++
          continue
        }
        try {
          await payment.updatePaymentCollections(v.collection_id, {
            amount: v.captured,
            status: "completed",
          })
          settled++
        } catch (e: any) {
          errors.push({ id: v.collection_id, message: `update failed: ${e?.message ?? e}` })
        }
      }
    }

    const verb = opts.dry_run ? "would settle" : "settled"
    return {
      job_id: "settle-overstated-payment-collections",
      dry_run: opts.dry_run,
      applied: !opts.dry_run && settled > 0,
      summary: `Examined ${examined} order(s); ${verb} ${settled} overstated collection(s); left ${stillOwing} order(s) that still owe money untouched.`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
