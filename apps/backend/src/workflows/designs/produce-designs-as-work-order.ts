import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { createProductionRunWorkflow } from "../production-runs/create-production-run"
import { sendProductionRunToProductionWorkflow } from "../production-runs/send-production-run-to-production"
import {
  collateRunsIntoWorkOrder,
  findOpenPartnerWorkOrder,
  joinRunsIntoWorkOrder,
} from "../production-runs/dual-write-unified-run-order"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

/**
 * #1263 — the template selection for ONE design.
 *
 * Per design, never pooled across the batch: the parked-run recovery (#1261)
 * proved on prod that 7 runs used 4 different template sets, so a batch-wide
 * selection would have been wrong for most of them. `template_ids` only —
 * a name may match two templates and dispatch refuses an ambiguous one
 * (#1262), so a bulk tool built on names fails on any design whose process
 * includes `Stitching`.
 */
export type ProduceDesignSelection = {
  design_id: string
  template_ids?: string[]
  quantity?: number
}

export type ProduceDesignReport = {
  design_id: string
  run_id: string | null
  template_ids: string[]
  dispatched: boolean
  /** Why this design was not dispatched, when it was not. */
  reason?: string
}

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
 *
 * #1263 — this used to stop at creation: runs were born `sent_to_partner` and
 * no task template was ever instantiated, so the partner was handed work with
 * nothing to accept while the record claimed it had been sent. Each design is
 * now dispatched with ITS OWN templates right after its run is created, and a
 * design that cannot be dispatched is reported rather than left looking sent.
 * Selections are per design; a design with no selection is created and
 * reported as undispatched, which is the old behaviour made visible.
 */
export async function produceDesignsAsWorkOrder(
  container: MedusaContainer,
  designIds: string[],
  partnerId: string,
  options?: {
    /** Per-design template selections. Wins over `templateIds` for a design. */
    selections?: ProduceDesignSelection[]
    /** Fallback selection for designs without one of their own. */
    templateIds?: string[]
    /** Plan only: resolve what would happen and create nothing. */
    dryRun?: boolean
    /**
     * Where these runs' lines land (#1597).
     *
     * - `"partner-open"` (**default**) — append to the partner's most recent
     *   open collated work-order when there is one, so a partner sent four
     *   designs across a week gets ONE order rather than four. Falls back to
     *   minting a fresh order when there is nothing open to join.
     * - `"new"` — always mint a fresh order. The behaviour before this option
     *   existed; keep it for a batch that must be billed on its own.
     */
    collate?: "partner-open" | "new"
    /** Override the collation window. See WORK_ORDER_COLLATION_WINDOW_DAYS. */
    collateWithinDays?: number
  }
): Promise<{
  created: number
  run_ids: string[]
  design_ids: string[]
  work_order_id: string | null
  dry_run?: boolean
  designs: ProduceDesignReport[]
  dispatched: string[]
  not_dispatched: ProduceDesignReport[]
  /** Whether the lines joined an existing work-order or minted a new one. */
  work_order_joined?: boolean
}> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runService = container.resolve(
    PRODUCTION_RUNS_MODULE
  ) as ProductionRunService

  const runIds: string[] = []
  const producedDesignIds: string[] = []
  const reports: ProduceDesignReport[] = []

  // One plan row per design, in the order given, with its own templates.
  const selectionsById = new Map<string, ProduceDesignSelection>(
    (options?.selections || [])
      .filter((s) => s?.design_id)
      .map((s) => [String(s.design_id), s])
  )
  const fallbackTemplateIds = (options?.templateIds || []).filter(Boolean)

  const orderedDesignIds = designIds?.length
    ? designIds
    : [...selectionsById.keys()]

  const plan = orderedDesignIds
    .filter(Boolean)
    .map((designId) => {
      const selection = selectionsById.get(String(designId))
      const templateIds = (
        selection?.template_ids?.length
          ? selection.template_ids
          : fallbackTemplateIds
      ).filter(Boolean)
      return {
        design_id: String(designId),
        template_ids: [...new Set(templateIds)],
        quantity: selection?.quantity ?? 1,
      }
    })

  // A dry run answers "which design gets which templates" — the question the
  // operator actually needs answered before messaging a partner.
  if (options?.dryRun) {
    const preview = plan.map((row) => ({
      design_id: row.design_id,
      run_id: null,
      template_ids: row.template_ids,
      dispatched: false,
      reason: row.template_ids.length
        ? "dry run — nothing was created"
        : "no templates selected for this design",
    }))
    return {
      created: 0,
      run_ids: [],
      design_ids: [],
      work_order_id: null,
      dry_run: true,
      designs: preview,
      dispatched: [],
      not_dispatched: preview,
    }
  }

  for (const row of plan) {
    const designId = row.design_id
    try {
      const { result } = await createProductionRunWorkflow(container).run({
        input: {
          design_id: designId,
          quantity: row.quantity,
          partner_id: partnerId,
          // #1263 — a run being dispatched is born `approved`, because
          // dispatch REFUSES anything else ("must be approved before
          // sending"), and it is dispatch that moves it to `sent_to_partner`,
          // creates the tasks and writes the partner↔order link. Being born
          // partner-facing was precisely what made the old path unable to
          // dispatch, and so what left partners holding taskless runs.
          //
          // With no templates there is nothing to dispatch, so the run keeps
          // the original born-`sent_to_partner` shape — same behaviour as
          // before for callers that pass no selection.
          status: row.template_ids.length
            ? ("approved" as const)
            : ("sent_to_partner" as const),
          // Collated into ONE work-order below — don't mint a per-run order.
          skip_unified_projection: true,
          metadata: {
            source: "designs-produce-no-customer",
          },
        },
      })
      const run = (result as any)?.production_run ?? (result as any)?.run ?? result
      if (!run?.id) {
        reports.push({
          design_id: designId,
          run_id: null,
          template_ids: row.template_ids,
          dispatched: false,
          reason: "run creation returned no run",
        })
        continue
      }

      runIds.push(run.id)
      producedDesignIds.push(designId)

      // No selection → create the run but say plainly that nothing was
      // dispatched, instead of leaving it looking sent with no tasks.
      if (!row.template_ids.length) {
        reports.push({
          design_id: designId,
          run_id: run.id,
          template_ids: [],
          dispatched: false,
          reason:
            "no templates selected for this design — the run has no tasks and the partner has nothing to accept",
        })
        continue
      }

      // Per design, so one design's dispatch failure never strands the batch.
      try {
        await sendProductionRunToProductionWorkflow(container).run({
          input: {
            production_run_id: run.id,
            template_ids: row.template_ids,
          } as any,
        })
        reports.push({
          design_id: designId,
          run_id: run.id,
          template_ids: row.template_ids,
          dispatched: true,
        })
      } catch (e: any) {
        logger.warn(
          `[produce-designs-as-work-order] dispatch failed for design ${designId}: ${e?.message}`
        )
        reports.push({
          design_id: designId,
          run_id: run.id,
          template_ids: row.template_ids,
          dispatched: false,
          reason: e?.message || "dispatch failed",
        })
      }
    } catch (e: any) {
      logger.warn(
        `[produce-designs-as-work-order] run creation failed for design ${designId}: ${e?.message}`
      )
      reports.push({
        design_id: designId,
        run_id: null,
        template_ids: row.template_ids,
        dispatched: false,
        reason: e?.message || "run creation failed",
      })
    }
  }

  const notDispatched = reports.filter((r) => !r.dispatched)

  if (!runIds.length) {
    return {
      created: 0,
      run_ids: [],
      design_ids: [],
      work_order_id: null,
      designs: reports,
      dispatched: [],
      not_dispatched: notDispatched,
    }
  }

  // Re-read the created runs with their snapshot (design name, cost) so the
  // collated work-order lines are self-describing.
  const runs = await runService.listProductionRuns(
    { id: runIds } as any,
    { select: ["*"] }
  )

  /**
   * #1597 — collate into the partner's open work-order by DEFAULT.
   *
   * The habitual path is one design at a time, so a partner sent four designs
   * across a week ended up with four orders for what is operationally one batch
   * of work. The collation machinery already existed (this very function) and
   * only ever collated designs dispatched in the SAME call — the moment the
   * choice was cheap was the one moment nothing offered it.
   *
   * ⚠️ The join is attempted, never assumed. If appending fails for any reason
   * the runs are already created and dispatched, so falling back to a fresh
   * order is the only outcome that leaves them visible — an exception here
   * would strand dispatched work with no line on any order.
   */
  const collate = options?.collate ?? "partner-open"
  let projection: Awaited<ReturnType<typeof collateRunsIntoWorkOrder>> | null =
    null
  let joined = false

  if (collate === "partner-open") {
    const open = await findOpenPartnerWorkOrder(container, partnerId, {
      withinDays: options?.collateWithinDays,
    })
    if (open) {
      try {
        projection = await joinRunsIntoWorkOrder(
          container,
          open.order_id,
          runs as any[]
        )
        joined = true
      } catch (e: any) {
        logger.warn(
          `[produce-designs-as-work-order] could not join work-order ${open.order_id} (${e?.message}) — minting a new one`
        )
      }
    }
  }

  if (!projection) {
    projection = await collateRunsIntoWorkOrder(container, runs as any[], {
      sourceOrderId: null,
    })
  }

  return {
    created: runIds.length,
    run_ids: runIds,
    design_ids: producedDesignIds,
    work_order_id: projection.unified_order_id ?? null,
    designs: reports,
    dispatched: reports.filter((r) => r.dispatched).map((r) => r.design_id),
    not_dispatched: notDispatched,
    work_order_joined: joined,
  }
}
