/**
 * Partner: Finish a production run.
 *
 * Sets finished_at, transitions design to Revision, signals lifecycle workflow.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { awaitRunFinishStepId } from "./run-production-run-lifecycle"
import {
  retrieveAndValidatePartnerRunStep,
  transitionDesignStatusStep,
  signalLifecycleStepStep,
  emitProductionRunEventStep,
  type PartnerRunInput,
} from "./partner-run-steps"

// ---------------------------------------------------------------------------
// Step: Mark run as finished
// ---------------------------------------------------------------------------

const updateRunFinishedStep = createStep(
  "update-run-finished",
  async (
    input: { production_run_id: string; notes?: string },
    { container }
  ) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = await service.retrieveProductionRun(input.production_run_id) as any
    const previousFinishedAt = run.finished_at
    const previousNotes = run.finish_notes

    await service.updateProductionRuns({
      id: input.production_run_id,
      finished_at: new Date(),
      ...(input.notes ? { finish_notes: input.notes } : {}),
    })

    return new StepResponse(
      { finished: true },
      {
        production_run_id: input.production_run_id,
        previous_finished_at: previousFinishedAt,
        previous_notes: previousNotes,
      }
    )
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) return
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    await service.updateProductionRuns({
      id: rollbackData.production_run_id,
      finished_at: rollbackData.previous_finished_at ?? null,
      finish_notes: rollbackData.previous_notes ?? null,
    })
  }
)

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export type FinishProductionRunInput = PartnerRunInput & {
  notes?: string
}

export const finishProductionRunWorkflow = createWorkflow(
  "finish-production-run",
  function (input: FinishProductionRunInput) {
    const run = retrieveAndValidatePartnerRunStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      opts: {
        allowedStatuses: ["in_progress"],
        requireStarted: true,
        action: "finish",
      },
    })

    updateRunFinishedStep({
      production_run_id: input.production_run_id,
      notes: input.notes,
    })

    // Transition design → Revision
    const designInput = transform({ run }, (data) => ({
      design_id: (data.run as any).design_id || null,
      target_status: "Revision",
      skip_statuses: ["Approved", "Commerce_Ready", "Rejected", "Superseded"],
    }))

    transitionDesignStatusStep(designInput)

    // Signal lifecycle workflow
    const lifecycleInput = transform({ run }, (data) => ({
      lifecycle_transaction_id: (data.run as any).lifecycle_transaction_id || null,
      step_id: awaitRunFinishStepId,
    }))

    signalLifecycleStepStep(lifecycleInput)

    // Emit event
    const eventInput = transform({ input }, (data) => ({
      event_name: "production_run.finished",
      data: {
        id: data.input.production_run_id,
        production_run_id: data.input.production_run_id,
        partner_id: data.input.partner_id,
        action: "finished",
        notes: data.input.notes,
      },
    }))

    emitProductionRunEventStep(eventInput)

    return new WorkflowResponse({ run })
  }
)
