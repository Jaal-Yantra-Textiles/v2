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

    // Choose the most recent transaction ID from linked tasks (prefer latest by created_at)
    let workflowTransactionId: string | null = null
    const txCandidates: any[] = []
    for (const design of taskLinks) {
      if (design.tasks && Array.isArray(design.tasks)) {
        for (const task of design.tasks) {
          if (task?.transaction_id) {
            txCandidates.push(task)
          }
        }
      }
    }
    if (txCandidates.length) {
      txCandidates.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      logger.info(
        `[DesignWF] txCandidates(${txCandidates.length}): ${txCandidates
          .map((t) => `${t?.title}@${t?.created_at || "-"}`)
          .join(", ")}`
      )
      workflowTransactionId = txCandidates[0].transaction_id
      logger.info(`[DesignWF] setStepSuccess using tx from task '${txCandidates[0]?.title}' created_at=${txCandidates[0]?.created_at}`)
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
      if (e?.stack) logger.warn(e.stack)
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
    const txCandidates: any[] = []
    for (const design of taskLinks) {
      if (design.tasks && Array.isArray(design.tasks)) {
        for (const task of design.tasks) {
          if (task?.transaction_id) {
            txCandidates.push(task)
          }
        }
      }
    }
    if (txCandidates.length) {
      txCandidates.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      logger.info(
        `[DesignWF] txCandidates(${txCandidates.length}): ${txCandidates
          .map((t) => `${t?.title}@${t?.created_at || "-"}`)
          .join(", ")}`
      )
      workflowTransactionId = txCandidates[0].transaction_id
      logger.info(`[DesignWF] setStepFailure using tx from task '${txCandidates[0]?.title}' created_at=${txCandidates[0]?.created_at}`)
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
      if (e?.stack) logger.warn(e.stack)
      throw e
    }
  }
)

export const cancelWorkflowTransactionStep = createStep(
  "cancel-workflow-transaction",
  async (input: { transactionId: string, updatedDesign: any }, { container }) => {
    const engineService = container.resolve(Modules.WORKFLOW_ENGINE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info(`Cancelling workflow transaction ${input.transactionId}`)
    try {
      await engineService.cancel(sendDesignToPartnerWorkflow.getName(), 
        {
          transactionId: input.transactionId,
    
        }
      )
      logger.info(`Workflow transaction ${input.transactionId} cancelled successfully`)
    } catch (e: any) {
      logger.error(`Failed to cancel workflow transaction ${input.transactionId}: ${e?.message}`)
      throw e
    }
  }
)

export const cancelWorkflowTransactionWorkflow = createWorkflow(
  {
    name: "cancel-workflow-transaction-workflow",
    store: true,
  },
  (input: { transactionId: string, updatedDesign: any }) => {
    const result = cancelWorkflowTransactionStep(input)
    return new WorkflowResponse(result)
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
