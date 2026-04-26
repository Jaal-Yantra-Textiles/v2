import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString, interpolateVariables } from "./utils"
import { Modules } from "@medusajs/framework/utils"

export const notificationOperation: OperationDefinition = {
  type: "notification",
  name: "Send Notification",
  description: "Send a notification to the admin feed",
  icon: "bell",
  category: "communication",
  
  optionsSchema: z.object({
    title: z.string().describe("Notification title"),
    description: z.string().optional().describe("Notification description"),
    to: z.string().optional().describe("User ID to send to (optional)"),
    channel: z.string().default("feed").describe("Notification channel"),
    data: z.record(z.any()).optional().describe("Additional data"),
  }),
  
  defaultOptions: {
    title: "",
    description: "",
    channel: "feed",
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const title = interpolateString(options.title, context.dataChain)
      const description = options.description 
        ? interpolateString(options.description, context.dataChain) 
        : undefined
      const to = options.to 
        ? interpolateString(options.to, context.dataChain) 
        : undefined
      const data = options.data 
        ? interpolateVariables(options.data, context.dataChain) 
        : undefined
      
      const notificationService = context.container.resolve(Modules.NOTIFICATION)
      
      const notification = await notificationService.createNotifications({
        to: to || "admin",
        channel: options.channel || "feed",
        template: "visual-flow-notification",
        data: {
          title,
          description,
          flow_id: context.flowId,
          execution_id: context.executionId,
          ...data,
        },
      })
      
      return {
        success: true,
        data: {
          notification_id: notification.id,
          title,
          description,
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
