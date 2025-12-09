import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"

export const transformOperation: OperationDefinition = {
  type: "transform",
  name: "Transform Payload",
  description: "Transform and restructure data",
  icon: "arrows-right-left",
  category: "utility",
  
  optionsSchema: z.object({
    json: z.record(z.any()).describe("JSON structure with variable interpolation"),
  }),
  
  defaultOptions: {
    json: {},
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      // Interpolate all variables in the JSON structure
      const result = interpolateVariables(options.json, context.dataChain)
      
      return {
        success: true,
        data: result,
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
