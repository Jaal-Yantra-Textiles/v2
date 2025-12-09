import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

export const sendEmailOperation: OperationDefinition = {
  type: "send_email",
  name: "Send Email",
  description: "Send an email using the notification system",
  icon: "envelope",
  category: "communication",
  
  optionsSchema: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject"),
    template: z.string().optional().describe("Email template key"),
    body: z.string().optional().describe("Email body (HTML or plain text)"),
    data: z.record(z.any()).optional().describe("Template data"),
  }),
  
  defaultOptions: {
    to: "",
    subject: "",
    template: "",
    body: "",
    data: {},
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const to = interpolateString(options.to, context.dataChain)
      const subject = interpolateString(options.subject, context.dataChain)
      const template = options.template 
        ? interpolateString(options.template, context.dataChain) 
        : undefined
      const body = options.body 
        ? interpolateString(options.body, context.dataChain) 
        : undefined
      const data = options.data 
        ? interpolateVariables(options.data, context.dataChain) 
        : {}
      
      // Try to use the existing email workflow or notification service
      // This integrates with the project's existing email infrastructure
      try {
        // First try the sendNotificationEmailWorkflow if available
        const { sendNotificationEmailWorkflow } = await import("../../../workflows/email/send-notification-email.js")
        
        const result = await sendNotificationEmailWorkflow.run({
          input: {
            to,
            template: template || "visual-flow-email",
            data: {
              subject,
              body,
              ...data,
            },
          },
        })
        
        return {
          success: true,
          data: {
            to,
            subject,
            sent_via: "workflow",
            result,
          },
        }
      } catch (workflowError) {
        // Fallback: try direct notification service
        const { Modules } = await import("@medusajs/framework/utils")
        const notificationService = context.container.resolve(Modules.NOTIFICATION) as any
        
        if (notificationService) {
          const notification = await notificationService.createNotifications({
            to,
            channel: "email",
            template: template || "visual-flow-email",
            data: {
              subject,
              body,
              ...data,
            },
          })
          
          return {
            success: true,
            data: {
              to,
              subject,
              sent_via: "notification_service",
              notification_id: notification?.id,
            },
          }
        }
        
        throw new Error("No email sending mechanism available")
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
