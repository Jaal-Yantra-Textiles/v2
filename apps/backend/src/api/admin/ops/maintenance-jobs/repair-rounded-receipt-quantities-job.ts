import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { FULLFILLED_ORDERS_MODULE } from "../../../../modules/fullfilled_orders"
import {
  detectRoundedReceipts,
  QUANTITY_DELTA_WAS_INTEGER_UNTIL,
} from "../../../../workflows/inventory_orders/lib/receipt-reconciliation"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

export const MAX_ROUNDING_REPAIR_SCAN = 1000

const paramsSchema = z.object({
  order_id: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_ROUNDING_REPAIR_SCAN, `limit cannot exceed ${MAX_ROUNDING_REPAIR_SCAN}`)
    .optional(),
})

/**
 * Restore the fractional receipt quantities that an INTEGER column rounded away.
 *
 * ## What happened
 *
 * `line_fulfillment.quantity_delta` was `integer` until
 * Migration20260612202252 (#342 — "silently rounding decimal partial
 * deliveries (1.5 kg → 2)"). A partner who delivered 11.8 units had 12 written
 * to the typed row, one second after the same figure reached
 * `metadata.partner_delivery_history` — which is jsonb, and kept 11.8.
 *
 * Seen on `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3`, line `01K36TE56Y…` (Kala
 * cotton white, ₹250/unit): receipt row 12, history 11.8, **and physical stock
 * 11.8**. The stock ledger and the metadata agree; the receipt row is the only
 * thing that is wrong — which is what makes this repairable rather than a
 * judgement call.
 *
 * It is not cosmetic: `valueInventoryOrderByReceipts` prices a payout from these
 * rows, so the partner is credited 12 units for 11.8 delivered.
 *
 * ## Why this is the ONE decidable part of #1613
 *
 * The rest of that issue is not repairable by a job — the two records disagree
 * in both directions, and one order carries a reversal note that makes its rows
 * undecidable. This slice is different because the correct value is *known*:
 * the metadata kept the unrounded figure, and the stock ledger corroborates it.
 *
 * The detector therefore fires only when ALL of these hold:
 *
 *  - the row predates the column change;
 *  - the line has exactly ONE receipt and ONE history entry, so no pairing is
 *    guessed;
 *  - the history figure is fractional and rounds to exactly what is stored.
 *
 * A gap of a whole unit or more is a MISSING RECEIPT, not a rounding, and is
 * left alone — repairing it as one would invent a delivery.
 *
 * ## Writes
 *
 * `dry_run: true` (the default) reports. `dry_run: false` writes, and every
 * write is READ BACK before it is counted: the update form on a module service
 * can silently no-op, and a repair that reports success while changing nothing
 * is worse than one that fails loudly.
 */
export const repairRoundedReceiptQuantitiesJob: MaintenanceJob = {
  id: "repair-rounded-receipt-quantities",
  label: "Restore fractional delivery quantities rounded by the old integer column",
  description:
    `line_fulfillment.quantity_delta was an INTEGER column until 2026-06-12 (#342), so a partner who delivered 11.8 units had 12 stored — while metadata.partner_delivery_history, being jsonb, kept 11.8. Payouts are priced from the typed receipts, so those partners are credited more than they delivered. This restores the unrounded figure. Fires ONLY where the correct value is knowable: the row predates the column change, the line has exactly one receipt and one history entry (so nothing is paired by guessing), and the history figure is fractional and rounds to exactly what is stored. A gap of a whole unit or more is a missing receipt, not a rounding, and is never touched. dry_run=true reports; dry_run=false writes and READS BACK every row before counting it. Scans up to 'limit' orders (default 200, max ${MAX_ROUNDING_REPAIR_SCAN}).`,
  params: [
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Restrict to one inventory order — the safe way to apply a single repair",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max orders to scan in one call (default 200, max ${MAX_ROUNDING_REPAIR_SCAN})`,
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
    const fulfillmentsService: any = container.resolve(FULLFILLED_ORDERS_MODULE)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "metadata",
        "orderlines.id",
        "orderlines.quantity",
        "orderlines.price",
        "orderlines.line_fulfillments.id",
        "orderlines.line_fulfillments.quantity_delta",
        "orderlines.line_fulfillments.created_at",
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
    const errors: Array<{ id: string; message: string }> = []
    let repaired = 0
    let unitsRestored = 0

    for (const order of (orders || []) as any[]) {
      const rounded = detectRoundedReceipts({
        orderlines: order.orderlines,
        metadata: order.metadata,
      })

      for (const row of rounded) {
        const line = (order.orderlines || []).find(
          (l: any) => String(l.id) === row.line_id
        )
        const unitPrice = Number(line?.price ?? 0) || 0
        const delta = row.stored - row.actual

        changes.push({
          entity: "line_fulfillment",
          id: row.fulfillment_id,
          field: "quantity_delta",
          before: row.stored,
          after: row.actual,
          note:
            `order ${order.id} line ${row.line_id}` +
            ` · received ${row.created_at}, before the column became real` +
            ` · stored ${row.stored} for a delivery of ${row.actual}` +
            (unitPrice
              ? ` · over-credits ${(delta * unitPrice).toFixed(2)} at ₹${unitPrice}/unit`
              : ""),
        })

        if (dry_run) continue

        try {
          await fulfillmentsService.updateLine_fulfillments({
            id: row.fulfillment_id,
            quantity_delta: row.actual,
          })

          /**
           * 🔴 Read back. The update form on a module service can silently
           * no-op, and this job's whole value is that the number afterwards is
           * right — a repair that reports success while changing nothing is
           * worse than one that fails loudly.
           */
          const [after] = await fulfillmentsService.listLineFulfillments(
            { id: row.fulfillment_id },
            { select: ["id", "quantity_delta"] }
          )
          const wrote = Number(after?.quantity_delta)
          if (!after || Math.abs(wrote - row.actual) > 0.0001) {
            errors.push({
              id: row.fulfillment_id,
              message: `write did not stick: still ${after?.quantity_delta ?? "missing"}, wanted ${row.actual}`,
            })
            continue
          }

          repaired++
          unitsRestored += delta
        } catch (e: any) {
          errors.push({
            id: row.fulfillment_id,
            message: e?.message ?? String(e),
          })
        }
      }
    }

    const found = changes.length
    const summary = dry_run
      ? `Scanned ${(orders || []).length} order(s); ${found} receipt(s) were rounded by the pre-${QUANTITY_DELTA_WAS_INTEGER_UNTIL.toISOString().slice(0, 10)} integer column. Nothing was changed.`
      : `Scanned ${(orders || []).length} order(s); ${found} rounded receipt(s) found, ${repaired} repaired and read back, restoring ${unitsRestored.toFixed(2)} over-credited unit(s).` +
        (errors.length ? ` ${errors.length} failed — see errors.` : "")

    if (!dry_run && found) {
      logger?.info?.(
        `[repair-rounded-receipt-quantities] repaired ${repaired}/${found}`
      )
    }

    return {
      job_id: "repair-rounded-receipt-quantities",
      dry_run,
      applied: !dry_run && repaired > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
