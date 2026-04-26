import { z } from "@medusajs/framework/zod"
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

      // Truncate long strings so HTML email bodies don't flood the console
      const truncate = (v: unknown, max = 300): unknown => {
        if (typeof v === "string" && v.length > max) return v.slice(0, max) + `… [${v.length} chars]`
        if (v && typeof v === "object") {
          return Array.isArray(v)
            ? (v as any[]).map((i) => truncate(i, max))
            : Object.fromEntries(Object.entries(v as object).map(([k, val]) => [k, truncate(val, max)]))
        }
        return v
      }

      console.log(`[Flow ${context.flowId}][${context.operationKey}]`, truncate(message))
      
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
