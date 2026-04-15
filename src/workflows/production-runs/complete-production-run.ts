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
import { Modules } from "@medusajs/framework/utils"

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
  normalized_cost_estimate?: number
  cost_type?: "per_unit" | "total"
  notes?: string
}

const completeRunWithLockStep = createStep(
  "complete-run-with-lock",
  async (input: CompleteRunData, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const lockingService = container.resolve(Modules.LOCKING) as any
    const lockKey = `production-run-complete:${input.production_run_id}`

    let previousStatus: string | null = null
    let alreadyCompleted = false

    await lockingService.execute(lockKey, async () => {
      const freshRun = await service.retrieveProductionRun(input.production_run_id) as any
      if (freshRun.status === "completed") {
        alreadyCompleted = true
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
        ...(input.normalized_cost_estimate ? { partner_cost_estimate: input.normalized_cost_estimate } : {}),
        ...(input.cost_type ? { cost_type: input.cost_type } : {}),
        ...(input.notes ? { completion_notes: input.notes } : {}),
      })
    })

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

export const completeProductionRunWorkflow = createWorkflow(
  "complete-production-run",
  function (input: CompleteProductionRunInput) {
    const run = retrieveAndValidatePartnerRunStep({
      production_run_id: input.production_run_id,
      partner_id: input.partner_id,
      opts: {
        allowedStatuses: ["in_progress"],
        requireFinished: true,
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

    // Normalize cost
    const completeData = transform({ run, input }, (data) => {
      const r = data.run as any
      const runQuantity = r.quantity || 1
      const effectiveProduced = data.input.produced_quantity ?? runQuantity
      let normalizedCost = data.input.partner_cost_estimate
      if (normalizedCost && data.input.cost_type === "per_unit") {
        normalizedCost = Math.round(normalizedCost * effectiveProduced * 100) / 100
      }
      return {
        production_run_id: data.input.production_run_id,
        produced_quantity: data.input.produced_quantity,
        rejected_quantity: data.input.rejected_quantity,
        rejection_reason: data.input.rejection_reason,
        rejection_notes: data.input.rejection_notes,
        normalized_cost_estimate: normalizedCost,
        cost_type: data.input.cost_type,
        notes: data.input.notes,
      }
    })

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

    return new WorkflowResponse({ run, consumptions: consumptionResult })
  }
)
