import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { TASKS_MODULE } from "../../modules/tasks"
import { mirrorUnifiedRunOrderStatusStep } from "./dual-write-unified-run-order"

export type DeclineProductionRunInput = {
  production_run_id: string
  partner_id: string
  /** Pre-composed, attribution-prefixed cancellation reason. */
  composed_reason: string
  /** Raw reason code + notes for the emitted events. */
  reason: string
  notes?: string
}

/** Mark the run cancelled (partner decline). Compensation restores prior state. */
type DeclineComp = {
  id: string
  prev_status: string
  prev_cancelled_at: Date | null
  prev_cancelled_reason: string | null
}
const markRunDeclinedStep = createStep(
  "decline-mark-run-cancelled",
  async (input: { production_run_id: string; composed_reason: string }, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = (await service.retrieveProductionRun(input.production_run_id)) as any
    await service.updateProductionRuns({
      id: input.production_run_id,
      status: "cancelled",
      cancelled_at: new Date(),
      cancelled_reason: input.composed_reason,
    })
    return new StepResponse<{ ok: boolean }, DeclineComp>(
      { ok: true },
      {
        id: input.production_run_id,
        prev_status: run.status,
        prev_cancelled_at: run.cancelled_at ?? null,
        prev_cancelled_reason: run.cancelled_reason ?? null,
      }
    )
  },
  async (comp: DeclineComp | undefined, { container }) => {
    if (!comp) return
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    await service.updateProductionRuns({
      id: comp.id,
      status: comp.prev_status as any,
      cancelled_at: comp.prev_cancelled_at,
      cancelled_reason: comp.prev_cancelled_reason,
    })
  }
)

/** Cancel the run's non-terminal tasks (forward-only — mirrors admin cancel). */
const cancelRunTasksStep = createStep(
  "decline-cancel-run-tasks",
  async (input: { production_run_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const taskService: any = container.resolve(TASKS_MODULE)
    const { data } = await query.graph({
      entity: "production_runs",
      fields: ["tasks.id", "tasks.status"],
      filters: { id: input.production_run_id },
    })
    let cancelled = 0
    for (const t of data?.[0]?.tasks || []) {
      if (t.status !== "completed" && t.status !== "cancelled") {
        await taskService.updateTasks({ id: t.id, status: "cancelled" })
        cancelled++
      }
    }
    return new StepResponse({ cancelled })
  }
)

/** Emit declined + cancelled events (non-fatal, fire-and-forget). */
const emitDeclineEventsStep = createStep(
  "decline-emit-events",
  async (
    input: { production_run_id: string; partner_id: string; reason: string; notes?: string; composed_reason: string },
    { container }
  ) => {
    try {
      const eventService: any = container.resolve(Modules.EVENT_BUS)
      await eventService.emit([
        {
          name: "production_run.declined",
          data: {
            id: input.production_run_id,
            production_run_id: input.production_run_id,
            partner_id: input.partner_id,
            action: "declined",
            reason: input.reason,
            notes: input.notes,
          },
        },
        {
          name: "production_run.cancelled",
          data: {
            id: input.production_run_id,
            production_run_id: input.production_run_id,
            partner_id: input.partner_id,
            action: "cancelled",
            notes: input.composed_reason,
          },
        },
      ])
    } catch {
      /* non-fatal */
    }
    return new StepResponse({ ok: true })
  }
)

export const declineProductionRunWorkflow = createWorkflow(
  "decline-production-run",
  (input: DeclineProductionRunInput) => {
    markRunDeclinedStep({
      production_run_id: input.production_run_id,
      composed_reason: input.composed_reason,
    })
    cancelRunTasksStep({ production_run_id: input.production_run_id })
    emitDeclineEventsStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      reason: input.reason,
      notes: input.notes,
      composed_reason: input.composed_reason,
    })

    // #342 — partner decline mirrors as canceled + partner_status "declined"
    // (§5: the only cancel that carries a partner_status)
    mirrorUnifiedRunOrderStatusStep({
      production_run_id: input.production_run_id,
      declined: true,
    })

    return new WorkflowResponse({ ok: true })
  }
)
