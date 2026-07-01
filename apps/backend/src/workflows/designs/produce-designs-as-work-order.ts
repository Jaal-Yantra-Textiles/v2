import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { createProductionRunWorkflow } from "../production-runs/create-production-run"
import { collateRunsIntoWorkOrder } from "../production-runs/dual-write-unified-run-order"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

/**
 * #826 — "send to production" straight from the designs list, WITHOUT a
 * commissioning (sales) order.
 *
 * The commissioning path (createRunsForDesignOrder) fans runs out of an order's
 * design line items and keys collation on `order_id`. But an operator often just
 * wants to hand N designs to a partner to make — there is no customer, no sale,
 * no commissioning order. This function is that path: create one production run
 * per design (partner-assigned, born `sent_to_partner`) and collate them into
 * ONE kind=design work-order via the shared `collateRunsIntoWorkOrder` core.
 *
 * There is no group key to be idempotent against (no order), so every call
 * creates a fresh batch — the caller (a one-shot admin action) owns that.
 */
export async function produceDesignsAsWorkOrder(
  container: MedusaContainer,
  designIds: string[],
  partnerId: string
): Promise<{
  created: number
  run_ids: string[]
  design_ids: string[]
  work_order_id: string | null
}> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runService = container.resolve(
    PRODUCTION_RUNS_MODULE
  ) as ProductionRunService

  const runIds: string[] = []
  const producedDesignIds: string[] = []

  for (const designId of designIds) {
    if (!designId) {
      continue
    }
    try {
      const { result } = await createProductionRunWorkflow(container).run({
        input: {
          design_id: designId,
          quantity: 1,
          partner_id: partnerId,
          // Committed to a partner up front → born partner-facing so the
          // collated work-order gets its partner↔order link (else invisible).
          status: "sent_to_partner" as const,
          // Collated into ONE work-order below — don't mint a per-run order.
          skip_unified_projection: true,
          metadata: {
            source: "designs-produce-no-customer",
          },
        },
      })
      const run = (result as any)?.production_run ?? (result as any)?.run ?? result
      if (run?.id) {
        runIds.push(run.id)
        producedDesignIds.push(designId)
      }
    } catch (e: any) {
      logger.warn(
        `[produce-designs-as-work-order] run creation failed for design ${designId}: ${e?.message}`
      )
    }
  }

  if (!runIds.length) {
    return { created: 0, run_ids: [], design_ids: [], work_order_id: null }
  }

  // Re-read the created runs with their snapshot (design name, cost) so the
  // collated work-order lines are self-describing.
  const runs = await runService.listProductionRuns(
    { id: runIds } as any,
    { select: ["*"] }
  )

  const projection = await collateRunsIntoWorkOrder(container, runs as any[], {
    sourceOrderId: null,
  })

  return {
    created: runIds.length,
    run_ids: runIds,
    design_ids: producedDesignIds,
    work_order_id: projection.unified_order_id ?? null,
  }
}
