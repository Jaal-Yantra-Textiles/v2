/**
 * Partner: Complete a production run.
 *
 * Logs consumptions, marks run completed (with locking), completes tasks,
 * updates design cost + status, stocks finished goods, signals lifecycle.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
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
  type PartnerRunInput,
} from "./partner-run-steps"
import { mirrorUnifiedRunOrderStatusStep } from "./dual-write-unified-run-order"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsumptionEntry = {
  inventory_item_id?: string
  quantity: number
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

const logConsumptionsStep = createStep(
  "log-consumptions-batch",
  async (
    input: {
      consumptions: ConsumptionEntry[]
      design_id: string
      production_run_id: string
      run_type: string
      default_location_id: string | undefined
    },
    { container }
  ) => {
    if (!input.consumptions?.length) {
      return new StepResponse({ logged_ids: [] })
    }

    const loggedIds: string[] = []

    for (const c of input.consumptions) {
      const { result } = await logConsumptionWorkflow(container).run({
        input: {
          design_id: input.design_id,
          production_run_id: input.production_run_id,
          inventory_item_id: c.inventory_item_id,
          quantity: c.quantity,
          unit_cost: c.unit_cost,
          unit_of_measure: c.unit_of_measure as any,
          consumption_type: (c.consumption_type || (input.run_type === "sample" ? "sample" : "production")) as any,
          consumed_by: "partner" as const,
          location_id: c.location_id || input.default_location_id,
          notes: c.notes,
        },
      })

      if (result?.id) {
        loggedIds.push(result.id)

        await commitConsumptionWorkflow(container).run({
          input: {
            design_id: input.design_id,
            log_ids: [result.id],
          },
        }).catch(() => {
          // Commit can happen later — log was created
        })
      }
    }

    return new StepResponse({ logged_ids: loggedIds })
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

      const allCompleted = children.every(
        (c) => String(c?.status || "") === "completed"
      )
      if (!allCompleted) return

      const parent = (await service
        .retrieveProductionRun(parentRunId)
        .catch(() => null)) as any
      if (!parent) return
      if (["completed", "cancelled"].includes(String(parent.status))) return

      // Reconcile parent totals from the children so the rollup matches
      // what was actually produced (fixes the parent/child qty mismatch).
      const sum = (key: string, fallback?: string) =>
        children.reduce((acc, c) => {
          const v = c?.[key] ?? (fallback ? c?.[fallback] : undefined)
          return acc + (Number.isFinite(Number(v)) ? Number(v) : 0)
        }, 0)
      const producedTotal = sum("produced_quantity", "quantity")
      const quantityTotal = sum("quantity")
      const latestCompletedAt = children
        .map((c) => c?.completed_at)
        .filter(Boolean)
        .map((d) => new Date(d).getTime())
        .reduce((a, b) => Math.max(a, b), 0)

      await service.updateProductionRuns({
        id: parentRunId,
        status: "completed" as any,
        completed_at: latestCompletedAt ? new Date(latestCompletedAt) : new Date(),
        ...(quantityTotal > 0 ? { quantity: quantityTotal } : {}),
        ...(producedTotal > 0 ? { produced_quantity: producedTotal } : {}),
      })
    })

    return new StepResponse(null)
  }
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

    // Log consumptions
    const consumptionInput = transform(
      { run, input, partnerLocation },
      (data) => ({
        consumptions: data.input.consumptions || [],
        design_id: (data.run as any).design_id,
        production_run_id: data.input.production_run_id,
        run_type: (data.run as any).run_type || "production",
        default_location_id: data.partnerLocation.location_id,
      })
    )

    const consumptionResult = logConsumptionsStep(consumptionInput)

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
    }))

    completeRunWithLockStep(completeData)

    // Complete linked tasks
    completeLinkedTasksStep({ production_run_id: input.production_run_id })

    // Update design cost + status
    const designUpdateInput = transform({ run, input }, (data) => ({
      design_id: (data.run as any).design_id || null,
      cost_value: data.input.partner_cost_estimate || 0,
    }))

    updateDesignOnCompleteStep(designUpdateInput)

    // Stock finished goods
    const stockInput = transform(
      { run, input, partnerLocation },
      (data) => {
        const r = data.run as any
        const goodQty =
          (data.input.produced_quantity ?? r.quantity ?? 0) -
          (data.input.rejected_quantity ?? 0)
        return {
          production_run_id: data.input.production_run_id,
          design_id: r.design_id,
          partner_id: data.input.partner_id,
          good_quantity: goodQty,
          location_id: data.partnerLocation.location_id,
          order_id: r.order_id || null,
          order_line_item_id: r.order_line_item_id || null,
          run_quantity: r.quantity || 0,
        }
      }
    )

    stockFinishedGoodsStep(stockInput)

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

    return new WorkflowResponse({ run, consumptions: consumptionResult })
  }
)
