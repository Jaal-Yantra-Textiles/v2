import {
    Modules,
    TransactionHandlerType,
  } from "@medusajs/framework/utils"
  import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { runTaskAssignmentWorkflow } from "../run-task-assignment";

  
  type SetStepSuccessStepInput = {
    stepId: string;
    updatedTask: any;
  };
  
  export const setStepSuccessStep = createStep(
    "set-step-success-step",
    async function (
      { stepId, updatedTask }: SetStepSuccessStepInput,
      { container }
    ) {
      const engineService = container.resolve(
        Modules.WORKFLOW_ENGINE
      )
      console.log("updateTask", updatedTask, runTaskAssignmentWorkflow.getName())
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: updatedTask.transaction_id,
          stepId,
          workflowId: runTaskAssignmentWorkflow.getName(),
        },
        stepResponse: new StepResponse(updatedTask, updatedTask.id),
        options: {
          container,
        },
      })
    }
  )


  type SetStepFailedtepInput = {
    stepId: string;
    updateTask: any;
  };
  
  export const setStepFailedStep = createStep(
    "set-step-failed-step",
    async function (
      { stepId, updateTask }: SetStepFailedtepInput,
      { container }
    ) {
      const engineService = container.resolve(
        Modules.WORKFLOW_ENGINE
      )

      console.log("updateTask", updateTask, runTaskAssignmentWorkflow.getName())
  
      await engineService.setStepFailure({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: updateTask.transaction_id,
          stepId,
          workflowId: 'run-task-assignment',
        },
        stepResponse: new StepResponse(updateTask, updateTask.id),
        options: {
          container,
        },
      })
    }
  )

export const setStepSuccessWorkflow = createWorkflow(
    {
      name: "set-step-success-workflow",
      store: true
    },
    (input: SetStepSuccessStepInput) => {
      const result = setStepSuccessStep(input);
      return new WorkflowResponse(result);
    },
  )


  export const setStepFailedWorkflow = createWorkflow(
    {
      name: "set-step-failed-workflow",
      store: true
    },
    (input: SetStepFailedtepInput) => {
      const result = setStepFailedStep(input);
      return new WorkflowResponse(result);
    },
  )