import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — link rows that outlived the order line they point at.
 *
 * ## What happened
 *
 * `update-inventory-orders.ts` soft-deletes a removed order line, and used to
 * dismiss its `inventory_order_line ↔ inventory_item` link only
 * `if (line.inventory_item_id)` — i.e. only when the CALLER supplied it. The
 * partner proposal route maps exactly `{ id, quantity, price, extra_cost,
 * remove }`, so a partner-originated removal never carried one: the field was
 * absent on 100% of them. The `↔ product_variant` link (#1873) had no dismissal
 * branch at all.
 *
 * #2158 and #2159 stopped the bleeding. Neither repaired history, and nobody
 * has ever counted it — which is the reason this job exists. A rule fixed
 * forward with an unexamined back-fill is the same shape as the duplicate-tax
 * finding, and "probably fine" is not a number.
 *
 * ## Why raw SQL
 *
 * The link tables have no module service and no `query.graph` entity of their
 * own, and the question is precisely about rows whose join target is
 * soft-deleted — which every ORM-level read filters out before you can see it.
 * A read that cannot express the defect reports health.
 *
 * Table names are discovered from `information_schema`, never hardcoded:
 * Medusa abbreviates and hashes a long link table name
 * (`inventory_orders_inventory_order_line_inventory_-169f20608`), so the
 * literal is both unguessable and free to change when the link is redefined.
 * If the lookup finds no table, this job says so rather than reporting zero —
 * a missing table and a clean table are the same number and opposite facts.
 *
 * ## Repair
 *
 * `dry_run` (the default) COUNTS and lists. Applying sets `deleted_at` on the
 * stray rows — the same soft dismissal the workflow performs, so a repaired
 * row is indistinguishable from one dismissed correctly at the time, and
 * nothing is destroyed.
 */

/** Bounds one call: a repair that cannot be read in one sitting is not a preview. */
export const MAX_DANGLING_LINK_SCAN = 5000

const paramsSchema = z.object({
  /** Restrict to one link. Omitted = both. */
  link: z.enum(["inventory_item", "product_variant"]).optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_DANGLING_LINK_SCAN)
    .optional()
    .default(500),
})

/**
 * The two links a removed order line can leave behind, by the prefix their
 * table name is built from. The suffix is a hash Medusa derives; matching on
 * the prefix is what survives it.
 */
export const DANGLING_LINK_TABLES = {
  inventory_item: {
    prefix: "inventory_orders_inventory_order_line_inventory_",
    other_column: "inventory_item_id",
  },
  product_variant: {
    prefix: "inventory_orders_inventory_order_line_product_va",
    other_column: "product_variant_id",
  },
} as const

export type DanglingLinkKind = keyof typeof DANGLING_LINK_TABLES

/**
 * Pure: the operator-facing sentence for a run.
 *
 * Exported so the wording is testable without a database — the number is the
 * whole point of this job, and a summary that says "0" when a table was never
 * found would be the exact failure it is meant to prevent.
 */
export const summarizeDangling = (
  dryRun: boolean,
  found: number,
  missingTables: string[]
): string => {
  const missing = missingTables.length
    ? ` ⚠️ Could not find a table for: ${missingTables.join(", ")} — that is NOT a clean result, it is an unasked question.`
    : ""
  if (found === 0) {
    return `No link rows point at a deleted order line.${missing}`
  }
  const verb = dryRun ? "Would dismiss" : "Dismissed"
  return `${verb} ${found} link row${found === 1 ? "" : "s"} pointing at a soft-deleted order line.${missing}`
}

export const auditDanglingOrderLineLinksJob: MaintenanceJob = {
  id: "audit-dangling-order-line-links",
  label: "Find link rows that outlived their order line",
  description:
    "Count (and optionally dismiss) inventory_order_line ↔ inventory_item and ↔ product_variant link rows whose order line is soft-deleted. Removing an order line used to leave these behind — the item link on every partner-originated removal (#2157), the variant link on all of them (#2159). Both are fixed going forward and neither repaired history, which has never been counted. Preview (default) reports the number and lists the rows; apply soft-dismisses them, the same reversible operation the workflow performs.",
  params: [
    {
      name: "link",
      type: "string",
      required: false,
      description:
        "'inventory_item' or 'product_variant'. Omit for both.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max rows to report/dismiss in one call (default 500, max ${MAX_DANGLING_LINK_SCAN})`,
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
    const { link, limit } = parsed.data

    const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const kinds: DanglingLinkKind[] = link
      ? [link]
      : ["inventory_item", "product_variant"]

    const changes: MaintenanceChange[] = []
    const missingTables: string[] = []
    let found = 0

    for (const kind of kinds) {
      const { prefix, other_column } = DANGLING_LINK_TABLES[kind]

      const { rows: tables } = await knex.raw(
        `select table_name from information_schema.tables
          where table_schema = current_schema() and table_name like ?`,
        [`${prefix}%`]
      )
      if (!tables?.length) {
        // Say so loudly. Silence here would read as "no dangling rows".
        missingTables.push(kind)
        continue
      }
      const table = tables[0].table_name

      /**
       * Live link rows whose order line is soft-deleted. `l.deleted_at is null`
       * on the LINK and `not null` on the LINE is the entire definition of the
       * defect — a link that was correctly dismissed has its own deleted_at set
       * and must not be counted or touched again.
       */
      const { rows: strays } = await knex.raw(
        `select l.id, l.inventory_order_line_id, l.?? as other_id, ol.deleted_at as line_deleted_at
           from ?? l
           join inventory_order_line ol on ol.id = l.inventory_order_line_id
          where l.deleted_at is null
            and ol.deleted_at is not null
          order by ol.deleted_at desc
          limit ?`,
        [other_column, table, limit]
      )

      for (const row of strays ?? []) {
        found += 1
        changes.push({
          entity: table,
          id: String(row.id),
          field: "deleted_at",
          before: null,
          after: dry_run ? "would dismiss" : "dismissed",
          note:
            `points at order line ${row.inventory_order_line_id}, deleted ` +
            `${row.line_deleted_at} — ${other_column}=${row.other_id}`,
        })
      }

      if (!dry_run && strays?.length) {
        await knex.raw(
          `update ?? set deleted_at = now()
            where id = any(?) and deleted_at is null`,
          [table, strays.map((r: any) => String(r.id))]
        )
      }
    }

    return {
      job_id: auditDanglingOrderLineLinksJob.id,
      dry_run,
      applied: !dry_run && found > 0,
      summary: summarizeDangling(dry_run, found, missingTables),
      changes,
    }
  },
}
