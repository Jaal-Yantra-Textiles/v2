import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"

export const sleepOperation: OperationDefinition = {
  type: "sleep",
  name: "Sleep",
  description: "Pause execution for a specified duration",
  icon: "clock",
  category: "utility",
  
  optionsSchema: z.object({
    duration_ms: z.number().min(0).max(300000).describe("Duration to sleep in milliseconds (max 5 minutes)"),
  }),
  
  defaultOptions: {
    duration_ms: 1000,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const duration = Math.min(options.duration_ms, 300000) // Cap at 5 minutes
      
      await new Promise(resolve => setTimeout(resolve, duration))
      
      return {
        success: true,
        data: {
          slept_ms: duration,
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
