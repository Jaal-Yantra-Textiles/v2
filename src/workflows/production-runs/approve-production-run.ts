import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

export type ProductionRunAssignment = {
  partner_id: string
  role?: string | null
  quantity?: number
}

export type ApproveProductionRunInput = {
  production_run_id: string
  assignments?: ProductionRunAssignment[]
}

const retrieveProductionRunStep = createStep(
  "retrieve-production-run",
  async (input: { production_run_id: string }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService.retrieveProductionRun(input.production_run_id)

    return new StepResponse(run)
  }
)

const approveProductionRunStep = createStep(
  "approve-production-run",
  async (
    input: { production_run_id: string; assignments: ProductionRunAssignment[] },
    { container }
  ) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const original = await productionRunService.retrieveProductionRun(input.production_run_id)

    if (!original) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found`
      )
    }

    if (!["draft", "pending_review"].includes(String((original as any).status))) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${input.production_run_id} cannot be approved from status ${(original as any).status}`
      )
    }

    const updatedParent = await productionRunService.updateProductionRuns({
      id: original.id,
      status: "approved" as any,
    })

    const assignments = input.assignments || []
    if (!assignments.length) {
      return new StepResponse(
        { parent: updatedParent, children: [] },
        { parentOriginal: original, childIds: [] as string[] }
      )
    }

    const childPayloads = assignments.map((a) => {
      const quantity = a.quantity ?? (original as any).quantity ?? 1

      const originalSnapshot = (original as any).snapshot
      const snapshot = originalSnapshot
        ? {
            ...originalSnapshot,
            provenance: {
              ...(originalSnapshot as any).provenance,
              partner_id: a.partner_id,
              quantity,
            },
          }
        : originalSnapshot

      return {
        parent_run_id: original.id,
        role: a.role ?? null,
        design_id: (original as any).design_id,
        partner_id: a.partner_id,
        quantity,
        product_id: (original as any).product_id ?? null,
        variant_id: (original as any).variant_id ?? null,
        order_id: (original as any).order_id ?? null,
        order_line_item_id: (original as any).order_line_item_id ?? null,
        snapshot,
        captured_at: (original as any).captured_at,
        status: "approved" as any,
        metadata: (original as any).metadata ?? null,
      }
    })

    const createdChildren = await productionRunService.createProductionRuns(childPayloads as any)
    const children = Array.isArray(createdChildren) ? createdChildren : [createdChildren]

    const childIds = children.map((c: any) => c.id).filter(Boolean)

    return new StepResponse(
      { parent: updatedParent, children },
      { parentOriginal: original, childIds }
    )
  },
  async (
    rollbackData: { parentOriginal: any; childIds: string[] } | undefined,
    { container }
  ) => {
    if (!rollbackData) {
      return
    }

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    if (rollbackData.childIds?.length) {
      await productionRunService.softDeleteProductionRuns(rollbackData.childIds as any)
    }

    if (rollbackData.parentOriginal?.id) {
      await productionRunService.updateProductionRuns({
        id: rollbackData.parentOriginal.id,
        status: rollbackData.parentOriginal.status,
      })
    }
  }
)

export const approveProductionRunWorkflow = createWorkflow(
  "approve-production-run",
  (input: ApproveProductionRunInput) => {
    const run = retrieveProductionRunStep({ production_run_id: input.production_run_id })

    const assignments = transform({ input, run }, (data) => {
      const provided = data.input.assignments || []

      if (provided.length) {
        return provided
      }

      const partnerId = (data.run as any)?.partner_id
      if (partnerId) {
        return [{ partner_id: partnerId, quantity: (data.run as any)?.quantity ?? 1 }]
      }

      return []
    })

    const approved = approveProductionRunStep({
      production_run_id: input.production_run_id,
      assignments,
    })

    return new WorkflowResponse(approved)
  }
)
