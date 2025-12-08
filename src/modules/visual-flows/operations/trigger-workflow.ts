import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

export const triggerWorkflowOperation: OperationDefinition = {
  type: "trigger_workflow",
  name: "Trigger Workflow",
  description: "Trigger an existing MedusaJS workflow",
  icon: "play",
  category: "integration",
  
  optionsSchema: z.object({
    workflow_id: z.string().describe("ID of the workflow to trigger"),
    input: z.record(z.any()).optional().describe("Input data for the workflow"),
    wait_for_completion: z.boolean().default(true).describe("Wait for workflow to complete"),
  }),
  
  defaultOptions: {
    workflow_id: "",
    input: {},
    wait_for_completion: true,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const workflowId = interpolateString(options.workflow_id, context.dataChain)
      const input = options.input 
        ? interpolateVariables(options.input, context.dataChain) 
        : {}
      
      // Get the workflow orchestrator service from container
      // This service manages workflow execution in MedusaJS
      const workflowEngine = context.container.resolve("workflowOrchestratorService") as any
      
      if (!workflowEngine) {
        return {
          success: false,
          error: "Workflow engine not available",
        }
      }
      
      // Run the workflow
      const result = await workflowEngine.run(workflowId, {
        input,
        context: {
          transactionId: `vflow-${context.executionId}-${context.operationKey}`,
        },
      })
      
      return {
        success: true,
        data: {
          workflow_id: workflowId,
          result: result?.result,
          transaction_id: result?.transaction?.transactionId,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
