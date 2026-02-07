import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"
import { VISUAL_FLOWS_MODULE } from "../index"
import { executeVisualFlowWorkflow } from "../../../workflows/visual-flows"

/**
 * Trigger Flow Operation
 * 
 * Triggers another visual flow from within a flow.
 * This enables flow composition and reusability.
 * 
 * The triggered flow must have trigger_type: "another_flow" to be eligible.
 */
export const triggerFlowOperation: OperationDefinition = {
  type: "trigger_flow",
  name: "Trigger Flow",
  description: "Trigger another visual flow",
  icon: "arrow-path",
  category: "integration",
  
  optionsSchema: z.object({
    flow_id: z.string().describe("ID of the flow to trigger"),
    flow_name: z.string().optional().describe("Name of the flow (for display)"),
    input: z.record(z.any()).optional().describe("Input data to pass to the flow"),
    wait_for_completion: z.boolean().default(true).describe("Wait for the triggered flow to complete"),
  }),
  
  defaultOptions: {
    flow_id: "",
    flow_name: "",
    input: {},
    wait_for_completion: true,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const flowId = interpolateString(options.flow_id, context.dataChain)
      
      if (!flowId) {
        return {
          success: false,
          error: "Flow ID is required. Please select a flow to trigger.",
        }
      }
      
      // Interpolate input data
      const input = options.input 
        ? interpolateVariables(options.input, context.dataChain) 
        : {}
      
      console.log(`[trigger_flow] Triggering flow: ${flowId}`, { input })
      
      // Get the visual flows service to verify the flow exists
      const visualFlowsService = context.container.resolve(VISUAL_FLOWS_MODULE) as any
      
      if (!visualFlowsService) {
        return {
          success: false,
          error: "Visual Flows service not available",
        }
      }
      
      // Verify the flow exists and is eligible to be triggered
      let targetFlow: any
      try {
        targetFlow = await visualFlowsService.retrieveVisualFlow(flowId)
      } catch (e: any) {
        return {
          success: false,
          error: `Flow '${flowId}' not found`,
        }
      }
      
      // Check if the flow can be triggered by another flow
      if (targetFlow.trigger_type !== "another_flow" && targetFlow.trigger_type !== "manual") {
        return {
          success: false,
          error: `Flow '${targetFlow.name}' cannot be triggered by another flow. Its trigger type is '${targetFlow.trigger_type}'. Only flows with trigger type 'another_flow' or 'manual' can be triggered this way.`,
        }
      }
      
      // Check if the flow is active
      if (targetFlow.status !== "active") {
        return {
          success: false,
          error: `Flow '${targetFlow.name}' is not active (status: ${targetFlow.status})`,
        }
      }
      
      // Execute the flow
      const { result, errors } = await executeVisualFlowWorkflow(context.container).run({
        input: {
          flowId: flowId,
          triggerData: {
            ...input,
            $parent: {
              flowId: context.flowId,
              executionId: context.executionId,
              operationKey: context.operationKey,
            },
          },
          triggeredBy: `flow:${context.flowId}`,
          metadata: {
            parent_flow_id: context.flowId,
            parent_execution_id: context.executionId,
            triggered_at: new Date().toISOString(),
          },
        },
      })
      
      if (errors && errors.length > 0) {
        const errorMessages = errors.map((e: any) => e.error?.message || e.message || String(e)).join("; ")
        return {
          success: false,
          error: `Flow execution failed: ${errorMessages}`,
        }
      }
      
      console.log(`[trigger_flow] Flow completed:`, { 
        flowId, 
        flowName: targetFlow.name,
        executionId: result?.executionId,
        status: result?.status,
      })
      
      return {
        success: true,
        data: {
          flow_id: flowId,
          flow_name: targetFlow.name,
          execution_id: result?.executionId,
          status: result?.status,
          result: result?.dataChain?.$last,
        },
      }
      
    } catch (error: any) {
      console.error(`[trigger_flow] Error:`, error)
      return {
        success: false,
        error: error.message || "Failed to trigger flow",
        errorStack: error.stack,
      }
    }
  },
}
