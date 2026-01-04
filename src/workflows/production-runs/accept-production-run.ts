import { MedusaError } from "@medusajs/framework/utils"
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"

export type AcceptProductionRunInput = {
  production_run_id: string
  partner_id: string
}

const retrieveProductionRunForAcceptStep = createStep(
  "retrieve-production-run-for-accept",
  async (input: AcceptProductionRunInput, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService.retrieveProductionRun(input.production_run_id)

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found`
      )
    }

    const persistedPartnerId = (run as any)?.partner_id ?? (run as any)?.partnerId ?? null
    if (!persistedPartnerId || persistedPartnerId !== input.partner_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found for this partner ${input.partner_id}`
      )
    }

    return new StepResponse(run)
  }
)

const acceptProductionRunStep = createStep(
  "accept-production-run",
  async (input: { run: any; partner_id: string }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const productionPolicyService: ProductionPolicyService = container.resolve(
      PRODUCTION_POLICY_MODULE
    )

    const latest = await productionRunService.retrieveProductionRun(input.run.id)

    if (!latest) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.run.id} not found`
      )
    }

    const persistedPartnerId =
      (latest as any)?.partner_id ?? (latest as any)?.partnerId ?? null
    if (!persistedPartnerId || persistedPartnerId !== input.partner_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${latest.id} not found for this partner ${input.partner_id}`
      )
    }

    await productionPolicyService.assertCanAccept(latest as any)

    const childOriginal = {
      id: latest.id,
      status: (latest as any).status,
      metadata: (latest as any).metadata ?? null,
    }

    const existingMetadata = ((latest as any)?.metadata || {}) as Record<string, any>
    const existingAcceptance = (existingMetadata.acceptance || {}) as Record<string, any>

    const updatedChild = await productionRunService.updateProductionRuns({
      id: latest.id,
      status: "in_progress" as any,
      metadata: {
        ...existingMetadata,
        acceptance: {
          ...existingAcceptance,
          accepted_at: new Date().toISOString(),
        },
      },
    })

    const parentRunId = (latest as any)?.parent_run_id ?? null

    let parentOriginal: { id: string; status: any; metadata: any } | null = null
    let updatedParent: any = null

    if (parentRunId) {
      const parent = await productionRunService.retrieveProductionRun(parentRunId)

      if (parent) {
        parentOriginal = {
          id: parent.id,
          status: (parent as any).status,
          metadata: (parent as any).metadata ?? null,
        }

        const parentStatus = String((parent as any).status)
        if (!["completed", "cancelled"].includes(parentStatus)) {
          updatedParent = await productionRunService.updateProductionRuns({
            id: parent.id,
            status: "in_progress" as any,
          })
        }
      }
    }

    return new StepResponse(
      { child: updatedChild, parent: updatedParent },
      { childOriginal, parentOriginal }
    )
  },
  async (
    rollbackData:
      | {
          childOriginal: { id: string; status: any; metadata: any }
          parentOriginal: { id: string; status: any; metadata: any } | null
        }
      | undefined,
    { container }
  ) => {
    if (!rollbackData) {
      return
    }

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    await productionRunService.updateProductionRuns({
      id: rollbackData.childOriginal.id,
      status: rollbackData.childOriginal.status,
      metadata: rollbackData.childOriginal.metadata,
    })

    if (rollbackData.parentOriginal?.id) {
      await productionRunService.updateProductionRuns({
        id: rollbackData.parentOriginal.id,
        status: rollbackData.parentOriginal.status,
        metadata: rollbackData.parentOriginal.metadata,
      })
    }
  }
)

export const acceptProductionRunWorkflow = createWorkflow(
  "accept-production-run",
  (input: AcceptProductionRunInput) => {
    const run = retrieveProductionRunForAcceptStep(input)

    const accepted = acceptProductionRunStep({
      run,
      partner_id: input.partner_id,
    })

    return new WorkflowResponse(accepted)
  }
)
