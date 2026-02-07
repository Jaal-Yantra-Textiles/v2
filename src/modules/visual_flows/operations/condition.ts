import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { evaluateFilterRule, interpolateVariables } from "./utils"

export const conditionOperation: OperationDefinition = {
  type: "condition",
  name: "Condition",
  description: "Branch the flow based on filter rules",
  icon: "git-branch",
  category: "logic",
  
  hasMultipleOutputs: true,
  outputHandles: [
    { id: "success", label: "True", type: "success" },
    { id: "failure", label: "False", type: "failure" },
  ],
  
  optionsSchema: z.object({
    filter_rule: z.record(z.any()).describe("Filter rule to evaluate"),
  }),
  
  defaultOptions: {
    filter_rule: {},
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      // Interpolate variables in the filter rule
      const resolvedRule = interpolateVariables(options.filter_rule, context.dataChain)
      
      // Evaluate the filter rule against the data chain
      const result = evaluateFilterRule(resolvedRule, context.dataChain)
      
      return {
        success: true,
        data: {
          passed: result,
          // The execution engine will use this to determine which path to take
          _branch: result ? "success" : "failure",
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
