import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import {
  buildMaterialLookupByInventoryId,
  planMaterialBackfill,
  type MaterialInfo,
} from "../../../../modules/inventory_orders/lib/create-helpers"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

export const MAX_MATERIAL_BACKFILL_SCAN = 1000

const paramsSchema = z.object({
  order_id: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_MATERIAL_BACKFILL_SCAN, `limit cannot exceed ${MAX_MATERIAL_BACKFILL_SCAN}`)
    .optional(),
})

/**
 * Populate `color` / `material_name` / `raw_material_id` on order lines written
 * before #817 S2 (#1613, scope item 4).
 *
 * ## What is missing and why
 *
 * Those three columns are denormalized onto a line at CREATE time from the
 * linked inventory item's raw material, so an order is self-describing without
 * re-traversing line → inventory_item → raw_material. Lines written before that
 * shipped have all three NULL — all ten on
 * `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` do, which is why that order cannot say
 * what material any of its lines is for. The 20 Jul 2026 order has them
 * populated, so #817 works; this is a historical population only.
 *
 * ## Why this one is writable, when most of #1613 is not
 *
 * Nothing is inferred. The values come from `buildMaterialLookupByInventoryId`
 * — the SAME function the create path uses — reading the module link that has
 * been the source of truth throughout. A backfilled line ends up holding
 * exactly what a line created today would hold, not a second opinion about it.
 *
 * Contrast the receipt drift in the same issue: there, two records of one
 * delivery disagree in both directions and no rule can say which is right. Here
 * there is one record and the line simply never copied it.
 *
 * ## What it will not do
 *
 *  - It never overwrites a value that is already present, per FIELD — a
 *    populated column is someone's answer, and the link is the source for a
 *    line that never got one, not a licence to correct one that did.
 *  - It never writes a null over a null: an item with no linked raw material is
 *    left alone, because absence there is not repairable.
 *  - It never guesses which item a line belongs to. ⚠️ `query.graph` returns one
 *    ALL-NULL row for an empty relation, so a line with no link at all comes
 *    back with `inventory_items.length === 1`; the planner filters on a real
 *    `id` rather than on length.
 *
 * ## Writes
 *
 * `dry_run: true` (the default) reports. `dry_run: false` writes and READS BACK
 * every line before counting it — the update form on a module service can
 * silently no-op, and a backfill that reports success while changing nothing is
 * worse than one that fails loudly.
 */
export const backfillOrderLineMaterialJob: MaintenanceJob = {
  id: "backfill-order-line-material",
  label: "Populate material identity on order lines written before #817",
  description:
    `color / material_name / raw_material_id are denormalized onto an inventory order line at creation time from the linked inventory item's raw material (#817 S2). Lines created before that have all three NULL, so the order cannot say what material any line is for — all ten lines on inv_order_01K36TE2WB5BQR1MS6KESXP7Q3 are in that state. This copies the values from the module link that has been the source of truth all along, using the SAME lookup the create path uses, so a backfilled line holds exactly what a new one would. It never overwrites a value that is already there (checked per field, and an empty string counts as missing), never writes a null over a null, and never guesses which inventory item a line belongs to. dry_run=true reports; dry_run=false writes and READS BACK every line. Scans up to 'limit' orders (default 200, max ${MAX_MATERIAL_BACKFILL_SCAN}).`,
  params: [
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Restrict to one inventory order — the safe way to apply a single backfill",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max orders to scan in one call (default 200, max ${MAX_MATERIAL_BACKFILL_SCAN})`,
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
    const inventoryOrderService: any = container.resolve(ORDER_INVENTORY_MODULE)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "orderlines.id",
        "orderlines.color",
        "orderlines.material_name",
        "orderlines.raw_material_id",
        // The link that has been the source of truth the whole time.
        "orderlines.inventory_items.id",
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

    /**
     * Every inventory item any scanned line points at, resolved in ONE query.
     * Per-line lookups would be a query per line for no better an answer.
     */
    const itemIds = Array.from(
      new Set(
        ((orders || []) as any[])
          .flatMap((o) => o.orderlines || [])
          .filter(Boolean)
          .flatMap((l: any) => (l.inventory_items || []) as any[])
          .map((i: any) => i?.id)
          .filter(Boolean)
          .map(String)
      )
    )

    let lookup: Record<string, MaterialInfo> = {}
    if (itemIds.length) {
      const { data: items } = await query.graph({
        entity: "inventory_item",
        fields: ["id", "raw_materials.id", "raw_materials.color", "raw_materials.name"],
        filters: { id: itemIds },
      })
      lookup = buildMaterialLookupByInventoryId(items as any)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let linesWritten = 0

    for (const order of (orders || []) as any[]) {
      const planned = planMaterialBackfill(order.orderlines, lookup)
      if (!planned.length) continue

      // One update per LINE, not per field: three columns on one row is one
      // write, and reporting three changes but issuing three updates would
      // race itself.
      const byLine = new Map<string, typeof planned>()
      for (const change of planned) {
        const existing = byLine.get(change.line_id) || []
        existing.push(change)
        byLine.set(change.line_id, existing)
      }

      for (const [lineId, lineChanges] of byLine) {
        const line = (order.orderlines || []).find(
          (l: any) => String(l?.id) === lineId
        )

        for (const change of lineChanges) {
          changes.push({
            entity: "inventory_order_line",
            id: lineId,
            field: change.field,
            before: line?.[change.field] ?? null,
            after: change.after,
            note:
              `order ${order.id}` +
              ` · from inventory item ${change.inventory_item_id}'s linked raw material`,
          })
        }

        if (dry_run) continue

        const update = Object.fromEntries(
          lineChanges.map((c) => [c.field, c.after])
        )

        try {
          await inventoryOrderService.updateOrderLines({ id: lineId, ...update })

          /**
           * 🔴 Read back. A module service's update form can silently no-op,
           * and the entire value of this job is that the row afterwards says
           * what the link says.
           */
          const [after] = await inventoryOrderService.listInventoryOrderLines(
            { id: lineId },
            { select: ["id", "color", "material_name", "raw_material_id"] }
          )
          const stuck = lineChanges.every(
            (c) => String((after as any)?.[c.field] ?? "") === c.after
          )
          if (!after || !stuck) {
            errors.push({
              id: lineId,
              message: `write did not stick: ${JSON.stringify(
                lineChanges.map((c) => ({
                  field: c.field,
                  wanted: c.after,
                  got: (after as any)?.[c.field] ?? null,
                }))
              )}`,
            })
            continue
          }

          linesWritten++
        } catch (e: any) {
          errors.push({ id: lineId, message: e?.message ?? String(e) })
        }
      }
    }

    const scanned = (orders || []).length
    const lines = new Set(changes.map((c) => c.id)).size
    const summary = dry_run
      ? `Scanned ${scanned} order(s); ${lines} line(s) are missing material identity the module link can supply (${changes.length} field(s)). Nothing was changed.`
      : `Scanned ${scanned} order(s); ${lines} line(s) needed material identity, ${linesWritten} written and read back (${changes.length} field(s)).` +
        (errors.length ? ` ${errors.length} failed — see errors.` : "")

    if (!dry_run && lines) {
      logger?.info?.(
        `[backfill-order-line-material] wrote ${linesWritten}/${lines} line(s)`
      )
    }

    return {
      job_id: "backfill-order-line-material",
      dry_run,
      applied: !dry_run && linesWritten > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
