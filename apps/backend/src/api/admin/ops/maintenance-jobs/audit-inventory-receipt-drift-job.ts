import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  reconcileOrderReceipts,
  type OrderReconciliation,
} from "../../../../workflows/inventory_orders/lib/receipt-reconciliation"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

export const MAX_RECEIPT_AUDIT_SCAN = 1000

const paramsSchema = z.object({
  order_id: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_RECEIPT_AUDIT_SCAN, `limit cannot exceed ${MAX_RECEIPT_AUDIT_SCAN}`)
    .optional(),
})

const money = (value: number): string =>
  `₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

/**
 * Where the two records of a delivery disagree, and what that is worth.
 *
 * ## The dual write
 *
 * `partner-complete-inventory-order` writes every delivery twice: as typed
 * `line_fulfillments` rows, and into `metadata.partner_delivered_lines` /
 * `metadata.partner_delivery_history`. The typed rows GOVERN — the workflow's
 * own over-delivery guard computes `remaining` from them.
 *
 * On `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` they disagree by ₹4,050: 69.5 typed
 * units against 59.3 in the blob, including a whole 10-unit receipt (₹4,000)
 * the blob never recorded.
 *
 * ## 🔴 Why this is more than a reporting problem
 *
 * `partner_delivered_lines` is OVERWRITTEN by the partner path and APPENDED to
 * by the admin path — one key, two writers, two meanings — and two live readers
 * move stock based on it:
 *
 *  - `computeAdminDeliveryPosting` posts `ordered − already`. Where the blob
 *    understates, an admin pressing Deliver posts stock for goods already
 *    received. `admin_would_overpost` measures exactly that, per line.
 *  - `cancel-inventory-order` reverses stock from the same key.
 *
 * ## 🔴 Why it writes nothing, ever
 *
 * Two reasons, both from the data rather than from caution:
 *
 *  1. The sources disagree in BOTH directions. Where the TYPED side is the one
 *     missing an entry, switching a reader to it makes `already` smaller and the
 *     over-posting worse. A blind union or a blind switch is not a repair.
 *  2. `metadata.reversal_note` on the order above reads "Reversed 9 incorrect
 *     fulfillments on 2026-02-28 — lines were auto-filled by UI bug", and rows
 *     sit on BOTH sides of that reversal. Which are corrected re-entries is not
 *     decidable from the record. Those orders need a human, and they are
 *     reported separately rather than folded into a total.
 *
 * So `dry_run: false` changes nothing here either. `applied` is always false.
 */
export const auditInventoryReceiptDriftJob: MaintenanceJob = {
  id: "audit-inventory-receipt-drift",
  label: "Find inventory orders whose typed receipts disagree with the metadata blob",
  description:
    `Compare the typed line_fulfillments receipts on every inventory order against metadata.partner_delivered_lines and metadata.partner_delivery_history, and report where they disagree, what the gap is worth at the line's per-unit price, and how much stock an admin "Deliver" would post today for goods already received. The typed rows govern — the partner workflow's own over-delivery guard reads them — but partner_delivered_lines is OVERWRITTEN on each partner submission while the admin path APPENDS to it, so the blob routinely understates (₹4,050 on inv_order_01K36TE2WB5BQR1MS6KESXP7Q3). 🔴 REPORTS ONLY, ALWAYS: dry_run=false changes nothing. The two sources disagree in BOTH directions, so a blind switch or union is not a repair; and orders carrying a metadata.reversal_note are reported separately because which of their rows are corrected re-entries is not decidable from the record. Scans up to 'limit' orders per call (default 200, max ${MAX_RECEIPT_AUDIT_SCAN}).`,
  params: [
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Restrict to one inventory order (default: all)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max orders to scan in one call (default 200, max ${MAX_RECEIPT_AUDIT_SCAN})`,
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
    const { order_id, limit } = parsed.data
    const take = limit ?? 200

    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "status",
        "total_price",
        "metadata",
        "orderlines.id",
        "orderlines.quantity",
        "orderlines.price",
        "orderlines.material_name",
        "orderlines.line_fulfillments.quantity_delta",
      ],
      ...(order_id ? { filters: { id: [order_id] } } : {}),
      pagination: { take, skip: 0 },
    })

    if (order_id && !(orders || []).length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order ${order_id} not found`
      )
    }

    const changes: MaintenanceChange[] = []
    let disagreeing = 0
    let undecidable = 0
    let driftValue = 0
    let overpost = 0

    for (const order of (orders || []) as any[]) {
      let result: OrderReconciliation
      try {
        result = reconcileOrderReceipts({
          orderlines: order.orderlines,
          metadata: order.metadata,
        })
      } catch (e: any) {
        logger?.warn?.(
          `[audit-inventory-receipt-drift] ${order.id}: ${e?.message ?? e}`
        )
        continue
      }

      if (!result.disagrees) continue

      disagreeing++
      driftValue += result.drift_value
      overpost += result.admin_would_overpost
      if (result.undecidable) undecidable++

      /**
       * Every disagreeing LINE is listed, not just the order total. A report
       * that says "this order is out by ₹4,050" cannot be checked without
       * re-deriving it; one that names the line, both figures and the rate can
       * be argued with before anybody acts on it.
       */
      for (const line of result.lines.filter((l) => l.drift !== 0)) {
        changes.push({
          entity: "inventory_order_line",
          id: line.line_id,
          field: "line_fulfillments vs metadata.partner_delivered_lines",
          before: { metadata_blob: line.blob, history: line.history },
          after: { typed_receipts: line.typed },
          note:
            `order ${order.id} (${order.status})` +
            ` · ordered ${line.ordered} @ ${money(line.unit_price)}/unit` +
            ` · typed ${line.typed} vs blob ${line.blob}` +
            ` · blob ${line.drift > 0 ? "understates" : "overstates"} by ${Math.abs(line.drift)} units` +
            ` (${money(line.drift_value)})` +
            (line.admin_would_overpost > 0
              ? ` · 🔴 an admin Deliver would post ${line.admin_would_overpost} units already received`
              : "") +
            (result.undecidable
              ? ` · ⚠️ UNDECIDABLE: ${result.reversal_note}`
              : ""),
        })
      }
    }

    const summary =
      `Scanned ${(orders || []).length} inventory order(s); ` +
      `${disagreeing} disagree between the typed receipts and the metadata blob. ` +
      `Net ${driftValue >= 0 ? "understated" : "overstated"} by ${money(driftValue)}. ` +
      `An admin Deliver would post ${overpost} unit(s) of already-received stock across them. ` +
      (undecidable
        ? `⚠️ ${undecidable} carry a reversal_note and are NOT decidable from the record — they need a human. `
        : "") +
      `Reports only; nothing was changed.`

    return {
      job_id: "audit-inventory-receipt-drift",
      dry_run,
      // Never true: this job has no write path at all.
      applied: false,
      summary,
      changes,
    }
  },
}
