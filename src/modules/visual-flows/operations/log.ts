import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"

export const logOperation: OperationDefinition = {
  type: "log",
  name: "Log to Console",
  description: "Log a message to the console for debugging",
  icon: "document-text",
  category: "utility",
  
  optionsSchema: z.object({
    message: z.any().describe("Message or data to log"),
  }),
  
  defaultOptions: {
    message: "{{ $last }}",
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const message = interpolateVariables(options.message, context.dataChain)
      
      console.log(`[Flow ${context.flowId}][${context.operationKey}]`, message)
      
      return {
        success: true,
        data: {
          logged: message,
          timestamp: new Date().toISOString(),
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
