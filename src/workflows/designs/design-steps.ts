import {
  ContainerRegistrationKeys,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { sendDesignToPartnerWorkflow } from "./send-to-partner"

const TASKS_MODULE = "tasksModuleService"

type SetDesignStepSuccessInput = {
  stepId: string
  updatedDesign: any
}

export const setDesignStepSuccessStep = createStep(
  "set-design-step-success",
  async function ({ stepId, updatedDesign }: SetDesignStepSuccessInput, { container }) {
    const engineService = container.resolve(Modules.WORKFLOW_ENGINE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    // Get the workflow transaction ID from associated tasks instead of design metadata
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Find tasks linked to this design that have a transaction ID
    const taskLinksResult = await query.graph({
      entity: "designs",
      fields: ["id", "tasks.*"],
      filters: {
        id: updatedDesign.id,
      },
    })

    const taskLinks = taskLinksResult.data || []

    logger.info(
      `[DesignWF] setStepSuccess requested: stepId=${stepId} designId=${updatedDesign?.id} taskLinksCount=${taskLinks.length}`
    )

    // Find a task with a transaction ID (should be one of the partner workflow tasks)
    let workflowTransactionId: string | null = null
    for (const design of taskLinks) {
      if (design.tasks && Array.isArray(design.tasks)) {
        for (const task of design.tasks) {
          if (task && task.transaction_id) {
            workflowTransactionId = task.transaction_id
            break
          }
        }
        if (workflowTransactionId) break
      }
    }

    if (!workflowTransactionId) {
      logger.error(
        `[DesignWF] No workflow transaction ID found in tasks for design ${updatedDesign.id} while signaling ${stepId}`
      )
      throw new Error(`No workflow transaction ID found in tasks for design ${updatedDesign.id}`)
    }

    logger.info(
      `[DesignWF] setStepSuccess: transactionId=${workflowTransactionId} workflowId=${sendDesignToPartnerWorkflow.getName()} stepId=${stepId}`
    )
    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: workflowTransactionId,
          stepId,
          workflowId: sendDesignToPartnerWorkflow.getName(),
        },
        stepResponse: new StepResponse(updatedDesign, updatedDesign.id),
        options: { container },
      })
      logger.info(`[DesignWF] setStepSuccess OK for stepId=${stepId}`)
    } catch (e: any) {
      logger.error(
        `[DesignWF] setStepSuccess FAILED for stepId=${stepId} tx=${workflowTransactionId}: ${e?.message}`
      )
      throw e
    }
  }
)

type SetDesignStepFailedInput = {
  stepId: string
  updatedDesign: any
  error?: string
}

export const setDesignStepFailedStep = createStep(
  "set-design-step-failed",
  async function ({ stepId, updatedDesign, error }: SetDesignStepFailedInput, { container }) {
    const engineService = container.resolve(Modules.WORKFLOW_ENGINE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    // Get the workflow transaction ID from associated tasks instead of metadata
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const taskLinksResult = await query.graph({
      entity: "designs",
      fields: ["id", "tasks.*"],
      filters: {
        id: updatedDesign.id,
      },
    })

    const taskLinks = taskLinksResult.data || []

    let workflowTransactionId: string | null = null
    for (const design of taskLinks) {
      if (design.tasks && Array.isArray(design.tasks)) {
        for (const task of design.tasks) {
          if (task && task.transaction_id) {
            workflowTransactionId = task.transaction_id
            break
          }
        }
        if (workflowTransactionId) break
      }
    }

    if (!workflowTransactionId) {
      logger.error(
        `[DesignWF] No workflow transaction ID found in tasks for design ${updatedDesign.id} while signaling FAILURE for ${stepId}`
      )
      throw new Error(`No workflow transaction ID found in tasks for design ${updatedDesign.id}`)
    }

    logger.warn(
      `[DesignWF] setStepFailure: transactionId=${workflowTransactionId} workflowId=${sendDesignToPartnerWorkflow.getName()} stepId=${stepId} error=${error}`
    )
    try {
      await engineService.setStepFailure({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: workflowTransactionId,
          stepId,
          workflowId: sendDesignToPartnerWorkflow.getName(),
        },
        stepResponse: new StepResponse(updatedDesign, updatedDesign.id),
        options: { container },
      })
      logger.info(`[DesignWF] setStepFailure OK for stepId=${stepId}`)
    } catch (e: any) {
      logger.error(
        `[DesignWF] setStepFailure FAILED for stepId=${stepId} tx=${workflowTransactionId}: ${e?.message}`
      )
      throw e
    }
  }
)

export const setDesignStepSuccessWorkflow = createWorkflow(
  {
    name: "set-design-step-success-workflow",
    store: true,
  },
  (input: SetDesignStepSuccessInput) => {
    const result = setDesignStepSuccessStep(input)
    return new WorkflowResponse(result)
  }
)

export const setDesignStepFailedWorkflow = createWorkflow(
  {
    name: "set-design-step-failed-workflow",
    store: true,
  },
  (input: SetDesignStepFailedInput) => {
    const result = setDesignStepFailedStep(input)
    return new WorkflowResponse(result)
  }
)
