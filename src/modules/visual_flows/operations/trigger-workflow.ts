import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"
import { Modules } from "@medusajs/framework/utils"
import { IWorkflowEngineService, WorkflowOrchestratorRunDTO } from "@medusajs/framework/types"

export const triggerWorkflowOperation: OperationDefinition = {
  type: "trigger_workflow",
  name: "Trigger Workflow",
  description: "Trigger an existing MedusaJS workflow",
  icon: "play",
  category: "integration",
  
  optionsSchema: z.object({
    workflow_name: z.string().describe("Name/ID of the workflow to trigger"),
    input: z.record(z.any()).optional().describe("Input data for the workflow"),
    wait_for_completion: z.boolean().default(true).describe("Wait for workflow to complete"),
  }),
  
  defaultOptions: {
    workflow_name: "",
    input: {},
    wait_for_completion: true,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const workflowName = interpolateString(options.workflow_name || options.workflow_id, context.dataChain)
      
      if (!workflowName) {
        return {
          success: false,
          error: "Workflow name is required. Please select a workflow from the dropdown.",
        }
      }
      
      const input = options.input 
        ? interpolateVariables(options.input, context.dataChain) 
        : {}
      
      console.log(`[trigger_workflow] Triggering workflow: ${workflowName}`, { input })
      
      // Use the workflow engine service to run the workflow
      // This is the same approach used by /admin/workflows-executions/{workflow_id}/run
      const workflowEngineService: IWorkflowEngineService = context.container.resolve(
        Modules.WORKFLOW_ENGINE
      )
      
      const runOptions: WorkflowOrchestratorRunDTO = {
        input,
        transactionId: `vflow-${context.executionId}-${Date.now()}`,
        context: {
          requestId: context.executionId,
        },
      }
      
      const { acknowledgement, result, errors } = await workflowEngineService.run(
        workflowName,
        runOptions
      )
      
      console.log(`[trigger_workflow] Workflow response:`, { 
        workflowName, 
        acknowledgement,
        hasResult: !!result,
        errors 
      })
      
      // Check for errors
      if (errors && errors.length > 0) {
        const errorMessages = errors.map((e: any) => e.error?.message || e.message || String(e)).join("; ")
        return {
          success: false,
          error: `Workflow execution failed: ${errorMessages}`,
        }
      }
      
      return {
        success: true,
        data: {
          workflow_name: workflowName,
          acknowledgement,
          result: result,
          transaction_id: runOptions.transactionId,
        },
      }
      
    } catch (error: any) {
      console.error(`[trigger_workflow] Error:`, error)
      return {
        success: false,
        error: error.message || "Failed to execute workflow",
        errorStack: error.stack,
      }
    }
  },
}
