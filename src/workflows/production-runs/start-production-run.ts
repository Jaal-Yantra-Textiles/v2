/**
 * Partner: Start a production run.
 *
 * Sets started_at, transitions design status, signals lifecycle workflow.
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
import { awaitRunStartStepId } from "./run-production-run-lifecycle"
import {
  retrieveAndValidatePartnerRunStep,
  transitionDesignStatusStep,
  signalLifecycleStepStep,
  emitProductionRunEventStep,
  type PartnerRunInput,
} from "./partner-run-steps"

// ---------------------------------------------------------------------------
// Step: Mark run as started
// ---------------------------------------------------------------------------

const updateRunStartedStep = createStep(
  "update-run-started",
  async (input: { production_run_id: string }, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = await service.retrieveProductionRun(input.production_run_id) as any
    const previousStartedAt = run.started_at

    await service.updateProductionRuns({
      id: input.production_run_id,
      started_at: new Date(),
    })

    return new StepResponse(
      { started: true },
      { production_run_id: input.production_run_id, previous_started_at: previousStartedAt }
    )
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) return
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    await service.updateProductionRuns({
      id: rollbackData.production_run_id,
      started_at: rollbackData.previous_started_at ?? null,
    })
  }
)

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export type StartProductionRunInput = PartnerRunInput

export const startProductionRunWorkflow = createWorkflow(
  "start-production-run",
  function (input: StartProductionRunInput) {
    const run = retrieveAndValidatePartnerRunStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      opts: {
        allowedStatuses: ["in_progress"],
        action: "start",
      },
    })

    updateRunStartedStep({ production_run_id: input.production_run_id })

    // Transition design status: Sample_Production for sample, In_Development for production
    // The transitionDesignStatusStep fetches the design and checks skip_statuses internally
    const designTransitionInput = transform({ run }, (data) => {
      const r = data.run as any
      return {
        design_id: r.design_id || null,
        target_status: r.run_type === "sample" ? "Sample_Production" : "In_Development",
        skip_statuses: ["Sample_Production", "In_Development", "Commerce_Ready", "Rejected", "Superseded"],
      }
    })

    transitionDesignStatusStep(designTransitionInput)

    // Signal lifecycle workflow
    const lifecycleInput = transform({ run }, (data) => ({
      lifecycle_transaction_id: (data.run as any).lifecycle_transaction_id || null,
      step_id: awaitRunStartStepId,
    }))

    signalLifecycleStepStep(lifecycleInput)

    // Emit event
    const eventInput = transform({ input }, (data) => ({
      event_name: "production_run.started",
      data: {
        id: data.input.production_run_id,
        production_run_id: data.input.production_run_id,
        partner_id: data.input.partner_id,
        action: "started",
      },
    }))

    emitProductionRunEventStep(eventInput)

    return new WorkflowResponse({ run })
  }
)
