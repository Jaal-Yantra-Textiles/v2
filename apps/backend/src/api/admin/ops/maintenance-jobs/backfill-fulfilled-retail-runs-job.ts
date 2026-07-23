import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { createProductionRunWorkflow } from "../../../../workflows/production-runs/create-production-run"
import { completeProvenanceRunWorkflow } from "../../../../workflows/production-runs/complete-provenance-run"
import { planLineItemRunAction } from "../../../../lib/plan-fulfillment-production-runs"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const MAX_FULFILLED_RUN_BACKFILL_SCAN = 5000

const paramsSchema = z.object({
  order_ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : String(v ?? "").split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_FULFILLED_RUN_BACKFILL_SCAN)
    .optional()
    .default(1000),
})

const ORDER_FIELDS = [
  "id",
  "items.id",
  "items.product_id",
  "items.variant_id",
  "fulfillments.id",
  "fulfillments.canceled_at",
  "fulfillments.items.line_item_id",
  "fulfillments.items.quantity",
]

/**
 * #1122 — historical backfill of the #1112 fulfillment-triggered provenance
 * runs. The live path only fires on NEW `order.fulfillment_created` events, so
 * every already-fulfilled order predating #1112 has an empty product "design
 * trail". This walks existing (non-canceled) fulfillments and, per fulfilled
 * line item, applies the exact same decision as the live subscriber via the
 * shared `planLineItemRunAction`:
 *   - no run yet            → mint a COMPLETED provenance run (design-backed or
 *                             product-only).
 *   - run still pre-prod    → complete it + stamp the shipped quantity (the
 *     (draft/pending_review)  #1126 stuck design-backed case).
 *   - run already producing → skip.
 *
 * Because it reuses the same guard + planner as the live path, it never
 * double-creates against it and is safe to re-run (idempotent). Provide
 * `order_ids` to target specific orders, or omit for a bounded scan.
 *
 * Out of scope (matches the #1126 decision): it does NOT retract the #342
 * unified-order projection that order.placed already wrote for historical
 * design-backed runs — completing the run makes the product trail trustworthy;
 * projection retraction is a separate concern.
 */
export const backfillFulfilledRetailRunsJob: MaintenanceJob = {
  id: "backfill-fulfilled-retail-production-runs",
  label: "Backfill production runs for fulfilled retail orders",
  description:
    `Mint the completed provenance production run for each fulfilled line item of orders that predate the #1112 fulfillment path (product-only or design-backed), and complete any design-backed run left in pending_review from order.placed (#1126). Reuses the live subscriber's guard + planner, so it never double-creates and is safe to re-run. Provide order_ids to target specific orders, or omit for a bounded scan (default 1000, max ${MAX_FULFILLED_RUN_BACKFILL_SCAN}). Canceled fulfillments are skipped. Dry-run previews; apply writes.`,
  params: [
    {
      name: "order_ids",
      type: "string",
      required: false,
      description: "Comma-separated order ids to target (default: scan fulfilled orders)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max runs to create/complete in one call (default 1000, max ${MAX_FULFILLED_RUN_BACKFILL_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { order_ids, limit } = paramsSchema.parse(params)

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let created = 0
    let completed = 0
    let scanned = 0

    const considerOrder = async (order: any) => {
      const fulfillments: any[] = order?.fulfillments || []
      if (!fulfillments.length) {
        return
      }
      scanned++

      const itemById = new Map<string, any>(
        (order?.items || []).map((it: any) => [it.id, it])
      )

      for (const f of fulfillments) {
        // Canceled fulfillments never shipped → no provenance to mint.
        if (f?.canceled_at) {
          continue
        }
        for (const fi of f?.items || []) {
          if (changes.length >= limit) {
            return
          }
          const lineItemId = fi?.line_item_id
          if (!lineItemId) {
            continue
          }
          const orderItem = itemById.get(lineItemId)
          const quantity = Number(fi?.quantity) || 1

          const plan = await planLineItemRunAction(query, {
            lineItemId,
            productId: orderItem?.product_id,
            variantId: orderItem?.variant_id,
            quantity,
          })
          if (!plan) {
            continue
          }

          if (plan.action === "complete") {
            completed++
            changes.push({
              entity: "production_run",
              id: plan.production_run_id,
              field: "status",
              before: plan.from_status,
              after: "completed",
            })
            if (!dry_run) {
              await completeProvenanceRunWorkflow(container).run({
                input: {
                  production_run_id: plan.production_run_id,
                  produced_quantity: quantity,
                },
              })
            }
          } else {
            created++
            changes.push({
              entity: "production_run",
              id: lineItemId,
              field: "create_run",
              before: null,
              after: {
                order_id: order.id,
                product_id: plan.product_id,
                design_id: plan.design_id,
                design_backed: Boolean(plan.design_id),
                status: "completed",
                produced_quantity: quantity,
              },
            })
            if (!dry_run) {
              await createProductionRunWorkflow(container).run({
                input: {
                  design_id: plan.design_id ?? undefined,
                  quantity,
                  produced_quantity: quantity,
                  product_id: plan.product_id,
                  variant_id: plan.variant_id,
                  order_id: order.id,
                  order_line_item_id: lineItemId,
                  status: "completed",
                  skip_unified_projection: true,
                  metadata: {
                    source: "backfill-fulfilled-retail-production-runs",
                    is_custom_design: plan.is_custom_design,
                    design_backed: Boolean(plan.design_id),
                  },
                },
              })
            }
          }
        }
      }
    }

    if (order_ids.length) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ORDER_FIELDS,
        filters: { id: order_ids },
      })
      for (const o of orders || []) {
        if (changes.length >= limit) break
        try {
          await considerOrder(o)
        } catch (e: any) {
          errors.push({ id: o?.id, message: e?.message ?? String(e) })
        }
      }
    } else {
      const page = 200
      for (let skip = 0; changes.length < limit; skip += page) {
        const { data: orders } = await query.graph({
          entity: "order",
          fields: ORDER_FIELDS,
          pagination: { skip, take: page },
        })
        if (!orders || orders.length === 0) break
        for (const o of orders) {
          if (changes.length >= limit) break
          try {
            await considerOrder(o)
          } catch (e: any) {
            errors.push({ id: o?.id, message: e?.message ?? String(e) })
          }
        }
        if (orders.length < page) break
      }
    }

    const verb = dry_run ? "Would create" : "Created"
    return {
      job_id: backfillFulfilledRetailRunsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: `${verb} ${created} provenance run(s) and ${dry_run ? "complete" : "completed"} ${completed} stuck run(s) across ${scanned} fulfilled order(s), ${errors.length} error(s)`,
      changes,
      errors,
    }
  },
}
