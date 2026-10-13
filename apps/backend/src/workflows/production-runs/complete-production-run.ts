/**
 * Partner: Complete a production run.
 *
 * Marks run completed (with locking), logs consumptions, completes tasks,
 * updates design cost + status, stocks finished goods, signals lifecycle, and
 * commits the consumptions LAST (committing is what moves material stock).
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { CONSUMPTION_LOG_MODULE } from "../../modules/consumption_log"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { runUnitCost } from "./lib/run-payable"
import { resolveProducedOutput, runGoodQuantity, type OutputLine } from "./lib/run-output"
import { bankAfterSales, soldQuantityForRun } from "./lib/profit-share-stock"
import type ProductionRunService from "../../modules/production_runs/service"
import { awaitRunCompleteStepId } from "./run-production-run-lifecycle"
import { logConsumptionWorkflow } from "../consumption-logs/log-consumption"
import { commitConsumptionWorkflow } from "../consumption-logs/commit-consumption"
import {
  retrieveAndValidatePartnerRunStep,
  transitionDesignStatusStep,
  signalLifecycleStepStep,
  emitProductionRunEventStep,
  resolvePartnerLocationStep,
  completeLinkedTasksStep,
  stockFinishedGoodsStep,
  resolveRunStockTargetStep,
  recordStockedLocationStep,
  type PartnerRunInput,
} from "./partner-run-steps"
import { mirrorUnifiedRunOrderStatusStep } from "./dual-write-unified-run-order"
import {
  computeParentRollup,
  parentTotalsPatch,
} from "./lib/parent-run-rollup"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsumptionEntry = {
  inventory_item_id?: string
  quantity: number
  /**
   * What `quantity` measures: everything this run used ("total"), or one
   * piece's worth ("per_piece"). Unset, the log is never deducted from stock —
   * the apply job will not guess a basis.
   */
  quantity_basis?: "total" | "per_piece" | null
  unit_cost?: number
  unit_of_measure?: string
  consumption_type?: string
  location_id?: string
  notes?: string
}

export type CompleteProductionRunInput = PartnerRunInput & {
  produced_quantity?: number
  rejected_quantity?: number
  rejection_reason?: string
  rejection_notes?: string
  partner_cost_estimate?: number
  cost_type?: "per_unit" | "total"
  consumptions?: ConsumptionEntry[]
  notes?: string
  /**
   * Complete with LESS output than was ordered, deliberately.
   *
   * The gate below requires a completion to account for everything assigned.
   * Real shortfalls happen — cloth ran out, a batch was scrapped — so they are
   * allowed, but they have to be claimed rather than slipped through, and the
   * shortfall must carry an explanation.
   */
  allow_shortfall?: boolean
  /**
   * #2271 — what was actually made, per size/colour, in GOOD units. Omit to
   * take the run's `planned_output` (when it adds up to the good units) or its
   * only combination. An invalid split is refused, never replaced.
   */
  produced_output?: OutputLine[] | null
  /**
   * #2271 — refuse completion when the run states several sizes/colours and
   * neither `produced_output` nor the plan says which were made. Set by the
   * HTTP doors where a person is completing and can answer; the WhatsApp and
   * last-task paths leave it off and record no split rather than block.
   */
  require_output_split?: boolean
}

export type CompletionOutputCheck =
  | { ok: true; shortfall: number }
  | { ok: false; reason: string }

/**
 * PURE: may this completion be recorded? Exported for unit tests.
 *
 * A run could be completed with `produced_quantity` left blank — it is optional
 * on the model and nothing filled it in — so a partner could close work without
 * ever saying what they made. That is the untouched cause behind the whole
 * #1248 thread: the run reads `completed`, the output is null, and every
 * downstream reader (cost summary, payout, provenance, order fulfilment) falls
 * back to the ORDERED quantity and quietly assumes it was all made.
 *
 * So: output must be stated, and it must account for everything ordered.
 * "Account for" is deliberately not "produce" — rejects are output too, they
 * are simply output that failed. 9 good + 1 rejected against an order of 10 is
 * a complete, honest completion. 9 good and nothing said about the tenth is not.
 *
 * A genuine shortfall is allowed via `allowShortfall`, WITH a written reason.
 * Without that escape the gate would be unworkable and someone would route
 * around it by inflating the number, which is worse than a recorded shortfall.
 */
export function checkCompletionOutput(input: {
  assigned?: number | null
  produced?: number | null
  rejected?: number | null
  allowShortfall?: boolean
  notes?: string | null
  rejectionReason?: string | null
  rejectionNotes?: string | null
}): CompletionOutputCheck {
  const assigned = Number(input.assigned ?? 0)

  // No ordered quantity to measure against — nothing to enforce. Runs created
  // without one predate the field being meaningful; inventing a requirement
  // for them would block completions over data that was never captured.
  if (!Number.isFinite(assigned) || assigned <= 0) {
    return { ok: true, shortfall: 0 }
  }

  const produced = input.produced

  if (produced == null || !Number.isFinite(Number(produced))) {
    return {
      ok: false,
      reason: `produced_quantity is required to complete this run: ${assigned} were ordered and nothing says how many were made. Report the good output (rejects go in rejected_quantity).`,
    }
  }

  const good = Number(produced)
  if (good < 0) {
    return { ok: false, reason: `produced_quantity cannot be negative.` }
  }

  const rejected = Number(input.rejected ?? 0)
  const accounted = good + (Number.isFinite(rejected) ? rejected : 0)
  const shortfall = assigned - accounted

  if (shortfall <= 0) {
    return { ok: true, shortfall: 0 }
  }

  if (!input.allowShortfall) {
    return {
      ok: false,
      reason: `This completion accounts for ${accounted} of ${assigned} ordered (${shortfall} unaccounted for). Report the missing units as rejected_quantity if they failed, or re-send with allow_shortfall:true and a note explaining what happened to them.`,
    }
  }

  // Claimed shortfalls still need a reason. `allow_shortfall` alone would just
  // be a checkbox that turns the gate off.
  const explanation = [
    input.notes,
    input.rejectionReason,
    input.rejectionNotes,
  ].find((v) => typeof v === "string" && v.trim().length > 0)

  if (!explanation) {
    return {
      ok: false,
      reason: `allow_shortfall:true needs an explanation: ${shortfall} of ${assigned} ordered are unaccounted for. Put what happened in notes.`,
    }
  }

  return { ok: true, shortfall }
}

// ---------------------------------------------------------------------------
// Step: Log consumptions (batch)
// ---------------------------------------------------------------------------

/**
 * Write the partner's consumption logs — UNCOMMITTED. Committing them is what
 * moves stock (`consumption-committed-apply-to-inventory`), so that waits for
 * `commitRunConsumptionsStep` at the very end of the workflow.
 *
 * 🔴 prod 2026-10-13: this step used to run FIRST and commit each log as it
 * went, with no compensation. A completion that then failed (a duplicate sku,
 * a 400 to the partner) kept its logs; the partner's retry wrote them again —
 * 4 committed logs for 2 materials. Now it runs only after the run is actually
 * marked completed by this call, and a later failure deletes what it wrote.
 */
const logConsumptionsStep = createStep(
  "log-consumptions-batch",
  async (
    input: {
      /** False when the lock step found the run already completed: log nothing. */
      completed: boolean
      consumptions: ConsumptionEntry[]
      design_id: string
      production_run_id: string
      run_type: string
      default_location_id: string | undefined
    },
    { container }
  ) => {
    if (!input.completed || !input.consumptions?.length) {
      return new StepResponse({ logged_ids: [] as string[] }, [] as string[])
    }

    const loggedIds: string[] = []

    try {
      for (const c of input.consumptions) {
        const { result } = await logConsumptionWorkflow(container).run({
          input: {
            design_id: input.design_id,
            production_run_id: input.production_run_id,
            inventory_item_id: c.inventory_item_id,
            quantity: c.quantity,
            quantity_basis: c.quantity_basis ?? null,
            unit_cost: c.unit_cost,
            unit_of_measure: c.unit_of_measure as any,
            consumption_type: (c.consumption_type || (input.run_type === "sample" ? "sample" : "production")) as any,
            consumed_by: "partner" as const,
            location_id: c.location_id || input.default_location_id,
            notes: c.notes,
          },
        })
        if (result?.id) loggedIds.push(result.id)
      }
    } catch (e) {
      // A step that throws is not compensated: undo the logs this one wrote.
      await removeRunConsumptionLogs(container, loggedIds)
      throw e
    }

    return new StepResponse({ logged_ids: loggedIds }, loggedIds)
  },
  async (loggedIds, { container }) => {
    await removeRunConsumptionLogs(container, loggedIds ?? [])
  }
)

/**
 * Delete logs a failed completion wrote. Unlink first, then delete, exactly as
 * the admin DELETE does, so no link row is ever left pointing at nothing
 * (#1857).
 *
 * 🔴 A log whose stock already moved (`inventory_applied_at`) is NOT deleted.
 * The apply job stamps WHEN and WHERE, but not how much it took off: the amount
 * is `quantity` or `quantity × pieces` by basis, floored at the level, and
 * carried forward across logs on one item, so it cannot be reversed exactly
 * from the row. Deleting it would hide a real decrement. It stays, with a
 * warning naming it, for a deliberate reversing entry. With the commit at the
 * end of the workflow this needs another actor to commit the log mid-flight.
 */
async function removeRunConsumptionLogs(container: any, logIds: string[]) {
  if (!logIds.length) return
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(CONSUMPTION_LOG_MODULE)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)

  for (const id of logIds) {
    try {
      const log = await service.retrieveConsumptionLog(id).catch(() => null)
      if (!log) continue
      const applied = log.inventory_applied_at ?? log.metadata?.inventory_applied_at
      if (applied) {
        logger?.warn?.(
          `[complete-production-run] rollback kept consumption log ${id} (run ` +
            `${log.production_run_id}): its stock movement was applied at ${applied} ` +
            `at ${log.inventory_applied_location_id ?? log.metadata?.inventory_applied_location_id}. ` +
            `Reverse ${log.quantity} ${log.unit_of_measure} of ${log.inventory_item_id} by hand.`
        )
        continue
      }
      await link.delete({ [CONSUMPTION_LOG_MODULE]: { consumption_log_id: id } })
      await service.deleteConsumptionLogs(id)
    } catch (e: any) {
      logger?.error?.(
        `[complete-production-run] rollback could not delete consumption log ${id}: ${e?.message ?? e}`
      )
    }
  }
}

/**
 * Commit the logs — the movement that takes material off our stock. LAST, so
 * nothing after it can fail and leave stock moved for a completion that did not
 * happen. Best-effort as before: an uncommitted log can be committed later.
 */
const commitRunConsumptionsStep = createStep(
  "commit-run-consumptions",
  async (input: { production_run_id: string; log_ids: string[] }, { container }) => {
    if (!input.log_ids?.length) return new StepResponse({ committed: false })
    try {
      await commitConsumptionWorkflow(container).run({
        input: { production_run_id: input.production_run_id, log_ids: input.log_ids },
      })
      return new StepResponse({ committed: true })
    } catch (e: any) {
      const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
      logger?.warn?.(
        `[complete-production-run] run ${input.production_run_id}: logs ${input.log_ids.join(", ")} ` +
          `were written but not committed: ${e?.message ?? e}`
      )
      return new StepResponse({ committed: false })
    }
  }
)

// ---------------------------------------------------------------------------
// Step: Mark run completed (with locking)
// ---------------------------------------------------------------------------

type CompleteRunData = {
  production_run_id: string
  produced_quantity?: number
  rejected_quantity?: number
  rejection_reason?: string
  rejection_notes?: string
  cost_estimate?: number
  cost_type?: "per_unit" | "total"
  notes?: string
  allow_shortfall?: boolean
  produced_output?: OutputLine[] | null
  require_output_split?: boolean
}

const completeRunWithLockStep = createStep(
  "complete-run-with-lock",
  async (input: CompleteRunData, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const lockingService = container.resolve(Modules.LOCKING) as any
    const lockKey = `production-run-complete:${input.production_run_id}`

    let previousStatus: string | null = null
    let alreadyCompleted = false
    let outputError: string | null = null

    await lockingService.execute(lockKey, async () => {
      const freshRun = await service.retrieveProductionRun(input.production_run_id) as any
      if (freshRun.status === "completed") {
        alreadyCompleted = true
        return
      }

      /**
       * The output gate. Checked against the FRESH run inside the lock, so it
       * measures against the quantity as it stands at completion rather than
       * one read earlier in the workflow and possibly corrected since.
       *
       * Thrown outside the lock — releasing it first, so a rejected completion
       * cannot hold the run locked behind a validation failure.
       */
      const check = checkCompletionOutput({
        assigned: freshRun.quantity,
        produced: input.produced_quantity,
        rejected: input.rejected_quantity,
        allowShortfall: input.allow_shortfall,
        notes: input.notes,
        rejectionReason: input.rejection_reason,
        rejectionNotes: input.rejection_notes,
      })

      if (!check.ok) {
        outputError = check.reason
        return
      }

      /**
       * #2271 — which sizes/colours those good units are. Resolved against the
       * FRESH run for the same reason as the gate above: its plan and snapshot
       * as they stand now.
       */
      const goodQuantity = runGoodQuantity({
        produced_quantity: input.produced_quantity,
        rejected_quantity: input.rejected_quantity,
        quantity: freshRun.quantity,
      })
      const output = resolveProducedOutput({
        confirmed: input.produced_output,
        planned_output: freshRun.planned_output,
        snapshot: freshRun.snapshot,
        good_quantity: goodQuantity,
      })
      if (
        !output.ok &&
        (output.code === "invalid_confirmed" || input.require_output_split)
      ) {
        outputError = `produced_output: ${output.reason}`
        return
      }
      const producedOutput = output.ok && output.lines.length ? output.lines : null

      previousStatus = freshRun.status

      await service.updateProductionRuns({
        id: input.production_run_id,
        status: "completed" as any,
        completed_at: new Date(),
        ...(input.produced_quantity != null ? { produced_quantity: input.produced_quantity } : {}),
        ...(input.rejected_quantity != null ? { rejected_quantity: input.rejected_quantity } : {}),
        ...(input.rejection_reason ? { rejection_reason: input.rejection_reason } : {}),
        ...(input.rejection_notes ? { rejection_notes: input.rejection_notes } : {}),
        ...(input.cost_estimate ? { partner_cost_estimate: input.cost_estimate } : {}),
        ...(input.cost_type ? { cost_type: input.cost_type } : {}),
        ...(input.notes ? { completion_notes: input.notes } : {}),
        // A json column is typed as a record; the list is what it holds.
        produced_output: producedOutput as any,
      })
    })

    if (outputError) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, outputError)
    }

    return new StepResponse(
      { completed: !alreadyCompleted },
      alreadyCompleted ? null : { production_run_id: input.production_run_id, previous_status: previousStatus }
    )
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) return
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    await service.updateProductionRuns({
      id: rollbackData.production_run_id,
      status: (rollbackData.previous_status || "in_progress") as any,
      completed_at: null,
      produced_output: null,
    })
  }
)

// ---------------------------------------------------------------------------
// Step: Update design cost + status on completion
// ---------------------------------------------------------------------------

const updateDesignOnCompleteStep = createStep(
  "update-design-on-complete",
  async (
    input: { design_id: string | null; cost_value: number; },
    { container }
  ) => {
    if (!input.design_id) {
      return new StepResponse({ updated: false })
    }

    const designService = container.resolve("design") as any
    const design = await designService.retrieveDesign(input.design_id)

    const updatePayload: Record<string, any> = { id: input.design_id }
    const previousValues: Record<string, any> = {
      design_id: input.design_id,
      production_cost: design.production_cost,
      estimated_cost: design.estimated_cost,
      status: design.status,
    }

    if (input.cost_value > 0) {
      updatePayload.production_cost = input.cost_value
      if (design.estimated_cost == null) {
        updatePayload.estimated_cost = input.cost_value
      }
    }

    // Transition to Technical_Review
    const skipStatuses = ["Approved", "Commerce_Ready", "Rejected", "Superseded"]
    if (!skipStatuses.includes(design.status)) {
      updatePayload.status = "Technical_Review"
    }

    await designService.updateDesigns(updatePayload)

    return new StepResponse({ updated: true }, previousValues)
  },
  async (rollbackData, { container }) => {
    if (!rollbackData?.design_id) return
    const designService = container.resolve("design") as any
    await designService.updateDesigns({
      id: rollbackData.design_id,
      production_cost: rollbackData.production_cost,
      estimated_cost: rollbackData.estimated_cost,
      status: rollbackData.status,
    })
  }
)

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step: Cascade parent completion (inline, lifecycle-independent)
// ---------------------------------------------------------------------------
//
// The lifecycle workflow's `cascadeCompletionStep` only fires if the
// child run was dispatched and carries a `lifecycle_transaction_id` —
// `signalLifecycleStepStep` silently no-ops on a null id. Child runs
// completed by the partner without ever being dispatched (null
// transaction id) therefore left the PARENT stuck in `in_progress`
// forever. This step does the same cascade INLINE so it always runs
// when a child completes, regardless of lifecycle transaction state.
// Idempotent + locked; a parent already completed/cancelled is left
// untouched (the repair script handles intentionally-cancelled parents
// separately).
const cascadeParentCompletionStep = createStep(
  "cascade-parent-completion-inline",
  async (input: { production_run_id: string }, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const lockingService = container.resolve(Modules.LOCKING) as any

    const run = (await service
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)) as any
    const parentRunId = run?.parent_run_id
    if (!parentRunId) {
      return new StepResponse(null)
    }

    const lockKey = `production-run-complete:${String(parentRunId)}`
    await lockingService.execute(lockKey, async () => {
      const children = (await service.listProductionRuns({
        parent_run_id: parentRunId,
      } as any)) as any[]
      if (!children?.length) return

      const rollup = computeParentRollup(children)
      if (!rollup.all_completed) return

      const parent = (await service
        .retrieveProductionRun(parentRunId)
        .catch(() => null)) as any
      if (!parent) return
      if (["completed", "cancelled"].includes(String(parent.status))) return

      // Reconcile parent totals from the children so the rollup matches
      // what was actually produced (fixes the parent/child qty mismatch).
      // Shared with the lifecycle cascade and the repair script so the three
      // cannot disagree about what a parent's totals are.
      await service.updateProductionRuns({
        id: parentRunId,
        status: "completed" as any,
        completed_at: rollup.completed_at ?? new Date(),
        ...parentTotalsPatch(rollup, { allowFallback: true }),
      })
    })

    return new StepResponse(null)
  }
)

/**
 * #2401 — pieces the partner already reported sold (offline, before closing)
 * are not in their warehouse; the stock step banks made − sold.
 */
const loadRunSoldQuantityStep = createStep(
  "load-run-sold-quantity",
  async (input: { production_run_id: string }, { container }) =>
    new StepResponse(await soldQuantityForRun(container, input.production_run_id))
)

export const completeProductionRunWorkflow = createWorkflow(
  "complete-production-run",
  function (input: CompleteProductionRunInput) {
    const run = retrieveAndValidatePartnerRunStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      opts: {
        action: "complete",
      },
    })

    // Resolve partner location (once, reused for consumptions + stocking)
    const partnerLocation = resolvePartnerLocationStep({
      partner_id: input.partner_id,
    })

    // Cost is stored verbatim as the partner entered it, paired with
    // cost_type. Every reader — the cost-summary route, the partner
    // production-run-card, and the unified-order dual-write — treats
    // partner_cost_estimate as a raw figure matching cost_type (a "per_unit"
    // value is per-unit; a "total" value is a total) and multiplies by
    // quantity itself when needed. Previously this step normalized per_unit
    // → total while leaving cost_type="per_unit", so every reader re-
    // multiplied by quantity (e.g. 850/unit → stored 7650 → shown 7650×9 =
    // 68850 instead of 850×9 = 7650). #456
    const completeData = transform({ run, input }, (data) => ({
      production_run_id: data.input.production_run_id,
      produced_quantity: data.input.produced_quantity,
      rejected_quantity: data.input.rejected_quantity,
      rejection_reason: data.input.rejection_reason,
      rejection_notes: data.input.rejection_notes,
      cost_estimate: data.input.partner_cost_estimate,
      cost_type: data.input.cost_type,
      notes: data.input.notes,
      allow_shortfall: data.input.allow_shortfall,
      produced_output: data.input.produced_output,
      require_output_split: data.input.require_output_split,
    }))

    const lockResult = completeRunWithLockStep(completeData)

    /**
     * Log consumptions — AFTER the run is marked completed, and only when THIS
     * call completed it: a retry that finds the run already completed must not
     * log the materials a second time. Before the stock-target step, whose
     * draft price reads the run's costed consumption. Uncommitted until the
     * last step; compensated (deleted) if anything in between fails.
     */
    const consumptionInput = transform(
      { run, input, partnerLocation, lockResult },
      (data) => ({
        completed: !!(data.lockResult as any)?.completed,
        consumptions: data.input.consumptions || [],
        design_id: (data.run as any).design_id,
        production_run_id: data.input.production_run_id,
        run_type: (data.run as any).run_type || "production",
        default_location_id: data.partnerLocation.location_id,
      })
    )

    const consumptionResult = logConsumptionsStep(consumptionInput)

    // Complete linked tasks
    completeLinkedTasksStep({ production_run_id: input.production_run_id })

    /**
     * Update design cost + status.
     *
     * 🔴 `design.production_cost` / `estimated_cost` are PER FINISHED UNIT —
     * `workflows/designs/estimate-design-cost.ts` divides a run total back to
     * per-unit for exactly that reason, and its own input docs say "per
     * finished unit". This step used to write `partner_cost_estimate` RAW,
     * ignoring `cost_type` entirely, so a run of 9 completed at 7650 TOTAL
     * stamped 7650 into a per-unit column. Per-unit runs happened to land
     * correctly; total runs did not. Neither was systematically right. (#1554)
     *
     * ⚠️ Normalise DOWN to per-unit here — never up to a total. Writing a total
     * into these columns is the #456 defect: every reader multiplies by
     * quantity for itself, so a stored total gets multiplied a second time.
     */
    const designUpdateInput = transform({ run, input }, (data) => ({
      design_id: (data.run as any).design_id || null,
      cost_value: runUnitCost({
        partner_cost_estimate: data.input.partner_cost_estimate,
        cost_type: data.input.cost_type,
        quantity: (data.run as any).quantity,
      }),
    }))

    updateDesignOnCompleteStep(designUpdateInput)

    /**
     * #2271 — where the good units go: the path they always took, one variant
     * per size/colour made (minting a draft product when the design has none),
     * or nowhere, with a reason, when that would take a guess.
     */
    const stockTargetInput = transform({ run, input, partnerLocation }, (data) => ({
      production_run_id: data.input.production_run_id,
      location_id: (data.partnerLocation as any)?.location_id ?? null,
      good_quantity: runGoodQuantity({
        produced_quantity: data.input.produced_quantity,
        rejected_quantity: data.input.rejected_quantity,
        quantity: (data.run as any).quantity,
      }),
    }))
    const stockTarget = resolveRunStockTargetStep(stockTargetInput)

    const soldQuantity = loadRunSoldQuantityStep(
      transform({ input }, (data) => ({ production_run_id: data.input.production_run_id }))
    )

    // Stock finished goods
    const stockInput = transform(
      { run, input, partnerLocation, stockTarget, soldQuantity },
      (data) => {
        const r = data.run as any
        const banking = bankAfterSales({
          good_quantity: runGoodQuantity({
            produced_quantity: data.input.produced_quantity,
            rejected_quantity: data.input.rejected_quantity,
            quantity: r.quantity,
          }),
          sold_quantity: data.soldQuantity as number,
          target: data.stockTarget as any,
        })
        const goodQty = banking.good_quantity
        return {
          production_run_id: data.input.production_run_id,
          design_id: r.design_id,
          partner_id: data.input.partner_id,
          // #1872 — the run's own variant, when it has one. Falls back to the
          // design lookup inside the step.
          variant_id: r.variant_id ?? null,
          approved_variant_id: r.approved_variant_id ?? null,
          good_quantity: goodQty,
          location_id: data.partnerLocation.location_id,
          // Carries WHICH hop failed, so the refusal names it. #2053
          location_failure_reason: (data.partnerLocation as any).reason ?? null,
          order_id: r.order_id || null,
          order_line_item_id: r.order_line_item_id || null,
          run_quantity: r.quantity || 0,
          target: banking.target,
          sold_not_deducted: banking.sold_not_deducted,
          sold_not_deducted_reason: banking.reason,
        }
      }
    )

    const stockResult = stockFinishedGoodsStep(stockInput)

    /**
     * #891 S1 — record WHERE the output was banked.
     *
     * Reads the step's own result rather than `partnerLocation.location_id`:
     * the step returns early without stocking for a rejected-only run, an
     * aggregate parent, or a design with no resolvable variant, and all three
     * have a partner location on the input. Recording the input location would
     * claim goods at a place that never received any.
     */
    recordStockedLocationStep(
      transform({ input, stockResult }, (data) => ({
        production_run_id: data.input.production_run_id,
        stock_result: data.stockResult as any,
      }))
    )

    // Signal lifecycle workflow
    const lifecycleInput = transform({ run }, (data) => ({
      lifecycle_transaction_id: (data.run as any).lifecycle_transaction_id || null,
      step_id: awaitRunCompleteStepId,
    }))

    signalLifecycleStepStep(lifecycleInput)

    // Inline parent cascade — guarantees the parent completes even when
    // the child had no lifecycle transaction to signal (root cause of
    // stuck-parent runs). Idempotent with the lifecycle/subscriber paths.
    cascadeParentCompletionStep({ production_run_id: input.production_run_id })

    // Emit event
    const eventInput = transform({ run, input }, (data) => {
      const r = data.run as any
      return {
        event_name: "production_run.completed",
        data: {
          id: data.input.production_run_id,
          production_run_id: data.input.production_run_id,
          partner_id: data.input.partner_id,
          action: "completed",
          notes: data.input.notes,
          produced_quantity: data.input.produced_quantity ?? r.quantity ?? 0,
          rejected_quantity: data.input.rejected_quantity ?? 0,
        },
      }
    })

    emitProductionRunEventStep(eventInput)

    // #342 — mirror completed onto the unified order (§5)
    mirrorUnifiedRunOrderStatusStep({
      production_run_id: input.production_run_id,
    })

    // Last: committing takes the material off our stock. Nothing after it can
    // fail, so stock never moves for a completion that was rolled back.
    commitRunConsumptionsStep(
      transform({ input, consumptionResult }, (data) => ({
        production_run_id: data.input.production_run_id,
        log_ids: ((data.consumptionResult as any)?.logged_ids ?? []) as string[],
      }))
    )

    return new WorkflowResponse({ run, consumptions: consumptionResult })
  }
)
