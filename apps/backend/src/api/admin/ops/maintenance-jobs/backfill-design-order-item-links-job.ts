import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { linkDesignsToOrderItems } from "../../../../workflows/designs/link-designs-to-order-items"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const MAX_SCAN = 5000

const paramsSchema = z.object({
  order_ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : String(v ?? "").split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  limit: z.coerce.number().int().positive().max(MAX_SCAN).optional().default(500),
})

/**
 * #1919 — turn the historical `metadata.design_id` strings on order items into
 * real `design ↔ order_line_item` links.
 *
 * The live path writes them at `order.placed`; this reaches everything placed
 * before the link existed. Idempotent: `linkDesignsToOrderItems` reads existing
 * pairs first and skips them, so re-running adds nothing.
 *
 * ⚠️ Verify the count against `metadata.design_id` occurrences before and
 * after — a link row is not a record, and a job reporting "linked 47" tells you
 * how many writes it made, not how many items now resolve. The `unresolved`
 * list is the interesting output: those are items naming a design that no
 * longer exists, which the string allowed and a link must not.
 */
export const backfillDesignOrderItemLinksJob: MaintenanceJob = {
  id: "backfill-design-order-item-links",
  label: "Backfill design ↔ order-item links from metadata.design_id",
  description:
    `Create the per-item design link for order items that carry a metadata.design_id but no link yet (#1919). metadata.design_id is KEPT as provenance — nothing is removed. Items naming a design that no longer exists are reported, not linked, since a dangling link row reads as a real binding. Idempotent: existing pairs are read first and skipped. Provide order_ids to target specific orders, or omit for a bounded scan (default 500, max ${MAX_SCAN}). Preview shows exactly which item→design pairs would be written.`,
  params: [
    {
      name: "order_ids",
      type: "string",
      required: false,
      description: "Comma-separated order ids to target (default: scan orders)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max orders to scan in one call (default 500, max ${MAX_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { order_ids, limit } = paramsSchema.parse(params)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let scanned = 0
    let skippedExisting = 0
    let unresolvedCount = 0

    let targets: string[] = order_ids
    if (!targets.length) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
        pagination: { skip: 0, take: limit },
      })
      targets = (orders || []).map((o: any) => String(o.id))
    }

    for (const orderId of targets) {
      scanned++
      try {
        const res = await linkDesignsToOrderItems(container, orderId, {
          dryRun: dry_run,
        })
        skippedExisting += res.skipped_existing
        for (const p of res.pairs) {
          changes.push({
            entity: "order_line_item",
            id: p.line_item_id,
            field: "design_link",
            before: null,
            after: p.design_id,
            note: `order ${orderId} — from metadata.design_id`,
          })
        }
        for (const u of res.unresolved) {
          unresolvedCount++
          errors.push({
            id: u.line_item_id,
            message: `names design ${u.design_id} but ${u.reason} — left unlinked`,
          })
        }
      } catch (e: any) {
        errors.push({ id: orderId, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would link" : "Linked"
    return {
      job_id: backfillDesignOrderItemLinksJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary:
        `${verb} ${changes.length} order item(s) to their design across ${scanned} order(s) — ` +
        `${skippedExisting} already linked, ${unresolvedCount} naming a design that no longer exists (reported, not linked)`,
      changes,
      errors,
    }
  },
}
