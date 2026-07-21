import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

// #1126 — lightweight completion for a RETAIL provenance run. When a
// design-backed retail order is fulfilled from stock, the run minted at
// order.placed (status `pending_review`) never went through production, so we
// simply stamp it `completed` + record the produced/shipped yield. This is NOT
// the partner completion flow (complete-production-run) — no consumptions, no
// finished-goods stocking, no lifecycle signalling; the goods already exist.

export type CompleteProvenanceRunInput = {
  production_run_id: string
  produced_quantity?: number
}

const completeProvenanceRunStep = createStep(
  "complete-provenance-run",
  async (input: CompleteProvenanceRunInput, { container }) => {
    const service: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const previous = await service.retrieveProductionRun(input.production_run_id)

    await service.updateProductionRuns({
      id: input.production_run_id,
      status: "completed",
      ...(input.produced_quantity !== undefined
        ? { produced_quantity: input.produced_quantity }
        : {}),
    } as any)

    return new StepResponse(
      { production_run_id: input.production_run_id },
      {
        production_run_id: input.production_run_id,
        previous_status: previous.status,
        previous_produced_quantity: (previous as any).produced_quantity ?? null,
      }
    )
  },
  async (rollback, { container }) => {
    if (!rollback) return
    const service: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )
    await service.updateProductionRuns({
      id: rollback.production_run_id,
      status: rollback.previous_status as any,
      produced_quantity: rollback.previous_produced_quantity,
    } as any)
  }
)

export const completeProvenanceRunWorkflow = createWorkflow(
  "complete-provenance-run",
  (input: CompleteProvenanceRunInput) => {
    const result = completeProvenanceRunStep(input)
    return new WorkflowResponse(result)
  }
)
