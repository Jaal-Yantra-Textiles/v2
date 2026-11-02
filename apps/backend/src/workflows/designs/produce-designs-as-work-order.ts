import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService, MedusaContainer } from "@medusajs/framework/types"

import { createProductionRunWorkflow } from "../production-runs/create-production-run"
import { sendProductionRunToProductionWorkflow } from "../production-runs/send-production-run-to-production"
import {
  collateRunsIntoWorkOrder,
  findOpenPartnerWorkOrder,
  joinRunsIntoWorkOrder,
} from "../production-runs/dual-write-unified-run-order"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import type { OutputLine } from "../production-runs/lib/run-output"
import {
  planDesignSizeSplit,
  type DesignSizeFacts,
  type PlannedSizeSplit,
  type SizeSplitLine,
} from "./lib/bundle-size-split"

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
  /**
   * #2500 — the sender's own split per size (and colour). Wins over the
   * default split; the quantity is its total. See `planDesignSizeSplit`.
   */
  planned_output?: OutputLine[] | null
}

export type ProduceDesignReport = {
  design_id: string
  run_id: string | null
  template_ids: string[]
  dispatched: boolean
  /**
   * #1803 — the quantity this design's run carries (defaults to 1). Reported
   * so a dry run can show what would be created, not just which templates
   * resolved: quantity is the one planned value the operator cannot infer.
   */
  quantity?: number
  /** Why this design was not dispatched, when it was not. */
  reason?: string
  /** #2500 — pieces per size this design's run makes (null = not sized). */
  size_split?: SizeSplitLine[] | null
  /** #2500 — the split stored on the run as its plan, when one is. */
  planned_output?: OutputLine[] | null
  /** #2500 — why the size split is shown but not stored on the run. */
  size_note?: string
  /** #2500 — sizes a garment design must state before it can go. */
  missing_sizes?: string[]
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
     * - `"new"` (**default**, since 2026-10-14) — mint a fresh order for this
     *   batch. A new job is a new order: Sharlho's customer jacket for Dovra
     *   landed as a third line on a 9-day-old stock order (#128), under that
     *   order's old number and date, so it read as part of the old batch.
     * - `"partner-open"` — opt in to appending to the partner's most recent
     *   open work-order (#1597) when there is one; falls back to minting.
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
  /**
   * Why no work-order exists although runs were created — null when one does.
   *
   * 🔴 `work_order_id: null` alone means three different things here: a dry
   * run, no runs created, or a refusal/failure AFTER the runs were created and
   * dispatched. Only the last is a problem, and it read as success — the drawer
   * showed a green "Sent" toast over dispatched work that sat on no order.
   */
  work_order_problem?: string | null
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
        planned_output: selection?.planned_output ?? null,
        split: null as PlannedSizeSplit | null,
      }
    })

  // #2500 — pieces per size, per design, decided before anything is created
  // so the preview shows exactly what the real send does.
  const facts = await loadDesignSizeFacts(
    container,
    plan.map((r) => r.design_id)
  )
  for (const row of plan) {
    const f = facts.get(row.design_id)
    // An unknown design gets no split here; run creation reports it missing.
    if (!f) continue
    row.split = planDesignSizeSplit(f, {
      quantity: row.planned_output ? (selectionsById.get(row.design_id)?.quantity ?? null) : row.quantity,
      planned_output: row.planned_output,
    })
    if (row.split.ok) row.quantity = row.split.quantity
  }
  const sizeFields = (row: (typeof plan)[number]) =>
    row.split?.ok
      ? {
          size_split: row.split.size_split,
          planned_output: row.split.planned_output,
          ...(row.split.note ? { size_note: row.split.note } : {}),
        }
      : row.split && !row.split.ok && row.split.missing_sizes
        ? { missing_sizes: row.split.missing_sizes }
        : {}

  // A dry run answers "which design gets which templates" — the question the
  // operator actually needs answered before messaging a partner.
  if (options?.dryRun) {
    const preview = plan.map((row) => ({
      design_id: row.design_id,
      run_id: null,
      template_ids: row.template_ids,
      dispatched: false,
      quantity: row.quantity,
      ...sizeFields(row),
      reason:
        row.split && !row.split.ok
          ? row.split.reason
          : row.template_ids.length
            ? "dry run — nothing was created"
            : "no templates selected for this design",
    }))

    /**
     * #1803 — resolve WHICH work-order the lines would land on.
     *
     * `findOpenPartnerWorkOrder` is a read-only lookup, so a dry run can
     * answer the question the operator actually asks before messaging a
     * partner — "does this join their open batch, or start another order?"
     * Previously a dry run always reported `work_order_id: null`, which reads
     * as "a new order" and is wrong exactly when collation is doing its job.
     */
    let plannedWorkOrderId: string | null = null
    if ((options?.collate ?? "new") === "partner-open") {
      const open = await findOpenPartnerWorkOrder(container, partnerId, {
        withinDays: options?.collateWithinDays,
      })
      plannedWorkOrderId = open?.order_id ?? null
    }

    return {
      created: 0,
      run_ids: [],
      design_ids: [],
      work_order_id: plannedWorkOrderId,
      dry_run: true,
      designs: preview,
      dispatched: [],
      not_dispatched: preview,
      work_order_joined: Boolean(plannedWorkOrderId),
    }
  }

  for (const row of plan) {
    const designId = row.design_id
    // #2500 — a garment with no sizes, or a split that does not add up, is
    // refused here; the rest of the batch still goes.
    if (row.split && !row.split.ok) {
      reports.push({
        design_id: designId,
        run_id: null,
        template_ids: row.template_ids,
        quantity: row.quantity,
        dispatched: false,
        reason: row.split.reason,
        ...sizeFields(row),
      })
      continue
    }
    try {
      const { result } = await createProductionRunWorkflow(container).run({
        input: {
          design_id: designId,
          quantity: row.quantity,
          ...(row.split?.ok && row.split.planned_output
            ? { planned_output: row.split.planned_output }
            : {}),
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
          quantity: row.quantity,
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
            // The batch is collated below, once every run is dispatched —
            // dispatch must not mint each run an order of its own first.
            defer_work_order: true,
            // #2500 — the partner hears about the batch ONCE, below.
            in_bundle: true,
          },
        })
        reports.push({
          design_id: designId,
          run_id: run.id,
          template_ids: row.template_ids,
          quantity: row.quantity,
          dispatched: true,
          ...sizeFields(row),
        })
      } catch (e: any) {
        logger.warn(
          `[produce-designs-as-work-order] dispatch failed for design ${designId}: ${e?.message}`
        )
        reports.push({
          design_id: designId,
          run_id: run.id,
          template_ids: row.template_ids,
          quantity: row.quantity,
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
        quantity: row.quantity,
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
   * #1597 — collate into the partner's open work-order, when ASKED to.
   * (It was the default until 2026-10-14; see the `collate` option.)
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
  const collate = options?.collate ?? "new"
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

  const workOrderId = projection.unified_order_id ?? null
  const workOrderProblem = workOrderId ? null : describeMissingWorkOrder(projection)
  if (workOrderProblem) {
    logger.error(
      `[produce-designs-as-work-order] ${runIds.length} run(s) created for partner ${partnerId} but NO work-order: ${workOrderProblem}`
    )
  }

  await announceBundle(container, {
    partnerId,
    workOrderId,
    dispatched: reports.filter((r) => r.dispatched && r.run_id),
  })

  return {
    created: runIds.length,
    run_ids: runIds,
    design_ids: producedDesignIds,
    work_order_id: workOrderId,
    designs: reports,
    dispatched: reports.filter((r) => r.dispatched).map((r) => r.design_id),
    not_dispatched: notDispatched,
    work_order_joined: joined,
    work_order_problem: workOrderProblem,
  }
}

/** #2500 — the size and colour facts each design's split is planned from. */
const loadDesignSizeFacts = async (
  container: MedusaContainer,
  designIds: string[]
): Promise<Map<string, DesignSizeFacts>> => {
  const out = new Map<string, DesignSizeFacts>()
  const ids = [...new Set(designIds.filter(Boolean))]
  if (!ids.length) return out
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "designs",
    fields: ["id", "product_type", "size_sets.size_label", "colors.name"],
    filters: { id: ids },
  })
  const labels = (rows: any[] | null | undefined, key: string) => {
    const seen = new Set<string>()
    for (const r of rows ?? []) {
      const v = String(r?.[key] ?? "").trim()
      if (v) seen.add(v)
    }
    return [...seen]
  }
  for (const d of (data ?? []) as any[]) {
    out.set(String(d.id), {
      size_labels: labels(d.size_sets, "size_label"),
      colors: labels(d.colors, "name"),
      product_type: d.product_type ?? null,
    })
  }
  return out
}

/**
 * #2500 — one event for the whole batch. Its WhatsApp subscriber sends ONE
 * message listing every design, and falls back to the per-design template for
 * each run when that cannot go out, including when no work order was made.
 *
 * Only DISPATCHED runs are announced: an undispatched one has no tasks, so
 * there is nothing for the partner to accept (it was never announced before
 * either).
 */
const announceBundle = async (
  container: MedusaContainer,
  input: {
    partnerId: string
    workOrderId: string | null
    dispatched: ProduceDesignReport[]
  }
) => {
  if (!input.dispatched.length) {
    return
  }
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventBus.emit({
      name: "work_order.sent_to_partner",
      data: {
        work_order_id: input.workOrderId,
        partner_id: input.partnerId,
        production_run_ids: input.dispatched.map((r) => r.run_id as string),
        design_ids_by_run: Object.fromEntries(
          input.dispatched.map((r) => [r.run_id as string, r.design_id])
        ),
      },
    })
  } catch (e: any) {
    // The work WAS sent; only the courtesy message is lost. Say so loudly.
    logger.error(
      `[produce-designs-as-work-order] could not announce ${input.dispatched.length} dispatched run(s) to partner ${input.partnerId}: ${e?.message}`
    )
  }
}

/**
 * The projection says WHY it produced no order (`skipped` / `error`); this is
 * where that reason used to be dropped. Worded for the operator reading a toast.
 */
export const describeMissingWorkOrder = (projection: {
  skipped?: string
  error?: string
}): string => {
  if (projection.skipped === "no_region") {
    return "No region matches the house store's currency, so the work-order was refused. Set the store's default region."
  }
  if (projection.error) {
    return `The work-order could not be created: ${projection.error}`
  }
  return projection.skipped
    ? `The work-order was skipped (${projection.skipped}).`
    : "The work-order was not created, and no reason was given."
}
