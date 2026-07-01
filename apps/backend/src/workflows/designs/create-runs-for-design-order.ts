import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { IOrderModuleService } from "@medusajs/types"

import { createProductionRunWorkflow } from "../production-runs/create-production-run"
import { projectDesignOrderToUnifiedOrder } from "../production-runs/dual-write-unified-run-order"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

/**
 * #826 S3 (step 1) — fan out one production_run per design line item on a
 * commissioning order.
 *
 * A design commissioning order (created by createDraftOrderFromDesignsWorkflow +
 * convert-design-order) carries one TITLE-ONLY line item per design, each with
 * `metadata.design_id`. Auto-run-creation is DELIBERATELY off for these (the
 * line items have no product_id precisely so order-placed skips them — see
 * convert-design-order header). Producing a design order is therefore an
 * explicit admin step: this function.
 *
 * Each run is stamped with `order_id` = the commissioning order and
 * `order_line_item_id` = its design line. `order_id` is the group key the
 * collated projection (#826 S3a) uses to fold N runs into ONE partner
 * work-order — the design analog of inventory's one-order-many-lines shape.
 *
 * Idempotent: a line item that already has a run (matched on
 * `order_line_item_id`, mirroring order-placed) is skipped. Shared as a plain
 * function (like linkDesignsToOrder) so a route, subscriber or backfill can all
 * reuse the exact traversal.
 */
export async function createRunsForDesignOrder(
  container: MedusaContainer,
  orderId: string,
  opts?: { partner_id?: string | null }
): Promise<{
  created: number
  run_ids: string[]
  design_ids: string[]
  work_order_id: string | null
}> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
  const runService = container.resolve(
    PRODUCTION_RUNS_MODULE
  ) as ProductionRunService

  const order: any = await orderService.retrieveOrder(orderId, {
    relations: ["items"],
  })
  const items: any[] = order?.items || []

  // Idempotency: which line items already spawned a run. One authoritative
  // (synchronous) read of the order's existing runs — filtering by
  // `order_line_item_id` directly proved unreliable, but `order_id` is exact.
  const existingRuns = await runService.listProductionRuns(
    { order_id: [orderId] } as any,
    { select: ["id", "order_line_item_id"] }
  )
  const alreadyProduced = new Set(
    (existingRuns || [])
      .map((r: any) => r.order_line_item_id)
      .filter(Boolean) as string[]
  )

  const runIds: string[] = []
  const designIds: string[] = []

  for (const item of items) {
    const lineItemId = item?.id
    // Design lines are the title-only items carrying design_id in metadata.
    const designId = item?.metadata?.design_id as string | undefined
    if (!lineItemId || !designId || alreadyProduced.has(lineItemId)) {
      continue
    }

    try {
      const { result } = await createProductionRunWorkflow(container).run({
        input: {
          design_id: designId,
          quantity: Number(item?.quantity) || 1,
          order_id: orderId,
          order_line_item_id: lineItemId,
          partner_id: opts?.partner_id ?? undefined,
          // Collated into ONE work-order by projectDesignOrderToUnifiedOrder
          // below — do NOT let each run mint its own per-run work-order.
          skip_unified_projection: true,
          metadata: {
            source: "design-order-produce",
            source_order_id: orderId,
          },
        },
      })
      const run = (result as any)?.production_run ?? (result as any)?.run ?? result
      if (run?.id) {
        runIds.push(run.id)
        designIds.push(designId)
      }
    } catch (e: any) {
      logger.warn(
        `[create-runs-for-design-order] run creation failed for line ${lineItemId} (design ${designId}) on order ${orderId}: ${e?.message}`
      )
    }
  }

  // Collate the order's runs (the just-created ones + any pre-existing) into ONE
  // kind=design work-order with a line per design (#826 S3a). Idempotent, so a
  // re-produce that created nothing new still resolves the existing work-order.
  const projection = await projectDesignOrderToUnifiedOrder(container, orderId)

  return {
    created: runIds.length,
    run_ids: runIds,
    design_ids: designIds,
    work_order_id: projection.unified_order_id,
  }
}
