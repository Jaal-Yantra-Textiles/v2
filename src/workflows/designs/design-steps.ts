import {
  ContainerRegistrationKeys,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../modules/designs"
import DesignService from "../../modules/designs/service"
import { TASKS_MODULE as TASKS_MODULE_KEY } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
import { sendDesignToPartnerWorkflow } from "./send-to-partner"

const TASKS_MODULE = "tasksModuleService"

type SetDesignStepSuccessInput = {
  stepId: string
  updatedDesign: any
  workflowId?: string
}

export const setDesignStepSuccessStep = createStep(
  "set-design-step-success",
  async function ({ stepId, updatedDesign, workflowId }: SetDesignStepSuccessInput, { container }) {
    const engineService = container.resolve(Modules.WORKFLOW_ENGINE)
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
      workflowTransactionId = txCandidates[0].transaction_id
      
    }

    if (!workflowTransactionId) {
      throw new Error(`No workflow transaction ID found in tasks for design ${updatedDesign.id}`)
    }

    const targetWorkflowId = workflowId || sendDesignToPartnerWorkflow.getName()
    
    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: workflowTransactionId,
          stepId,
          workflowId: targetWorkflowId,
        },
        stepResponse: new StepResponse(updatedDesign, updatedDesign.id),
      })
    } catch (e: any) {
      const msg = String(e?.message || "")
      // Benign: already OK/idle
      if (msg.includes("status is ok")) {
        return
      }
      // If a custom workflowId was provided and failed, retry with parent workflow
      if (workflowId && targetWorkflowId !== sendDesignToPartnerWorkflow.getName()) {
        try {
          await engineService.setStepSuccess({
            idempotencyKey: {
              action: TransactionHandlerType.INVOKE,
              transactionId: workflowTransactionId,
              stepId,
              workflowId: sendDesignToPartnerWorkflow.getName(),
            },
            stepResponse: new StepResponse(updatedDesign, updatedDesign.id),
          })
          return
        } catch (e2: any) {
          throw e2
        }
      }
      throw e
    }
  }
)

type SetDesignStepFailedInput = {
  stepId: string
  updatedDesign: any
  error?: string
  workflowId?: string
}

export const setDesignStepFailedStep = createStep(
  "set-design-step-failed",
  async function ({ stepId, updatedDesign, error, workflowId }: SetDesignStepFailedInput, { container }) {
    const engineService = container.resolve(Modules.WORKFLOW_ENGINE)

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
      workflowTransactionId = txCandidates[0].transaction_id
      
    }

    if (!workflowTransactionId) {
      throw new Error(`No workflow transaction ID found in tasks for design ${updatedDesign.id}`)
    }

    const targetWorkflowId = workflowId || sendDesignToPartnerWorkflow.getName()
    
    try {
      await engineService.setStepFailure({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: workflowTransactionId,
          stepId,
          workflowId: targetWorkflowId,
        },
        stepResponse: new StepResponse(updatedDesign, updatedDesign.id),
      })
    } catch (e: any) {
      throw e
    }
  }
)

export const cancelWorkflowTransactionStep = createStep(
  "cancel-workflow-transaction",
  async (input: { transactionId: string, updatedDesign: any }, { container }) => {
    const engineService = container.resolve(Modules.WORKFLOW_ENGINE)
    try {
      await engineService.cancel(sendDesignToPartnerWorkflow.getName(), 
        {
          transactionId: input.transactionId,
    
        }
      )
    } catch (e: any) {
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
    // Failure notification if this workflow itself errors
    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Workflow Signal",
            description: `Failed to mark step ${data.input.stepId} as success for design ${data.input.updatedDesign?.id}.`,
          },
        },
      ]
    })
    notifyOnFailureStep(failureNotification)

    const result = setDesignStepSuccessStep(input)

    // Success notification
    const successNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Workflow Signal",
            description: `Marked step ${data.input.stepId} as success for design ${data.input.updatedDesign?.id}.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)
    return new WorkflowResponse(result)
  }
)

export const setDesignStepFailedWorkflow = createWorkflow(
  {
    name: "set-design-step-failed-workflow",
    store: true,
  },
  (input: SetDesignStepFailedInput) => {
    // Failure notification if this workflow itself errors
    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Workflow Signal",
            description: `Failed to mark step ${data.input.stepId} as failed for design ${data.input.updatedDesign?.id}.`,
          },
        },
      ]
    })
    notifyOnFailureStep(failureNotification)

    const result = setDesignStepFailedStep(input)

    // Success notification
    const successNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Workflow Signal",
            description: `Marked step ${data.input.stepId} as failed for design ${data.input.updatedDesign?.id}.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)
    return new WorkflowResponse(result)
  }
)

// Redo sub-workflow moved to send-to-partner.ts to avoid circular imports
