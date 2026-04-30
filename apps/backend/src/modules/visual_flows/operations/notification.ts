import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString, interpolateVariables } from "./utils"
import { Modules } from "@medusajs/framework/utils"

export const notificationOperation: OperationDefinition = {
  type: "notification",
  name: "Send Notification",
  description:
    "Drop a notification into the admin feed, or — when partner_id is set — into a specific partner's bell.",
  icon: "bell",
  category: "communication",

  optionsSchema: z.object({
    title: z.string().describe("Notification title"),
    description: z.string().optional().describe("Notification description"),
    /**
     * When set, the notification is scoped to this partner via
     * `receiver_id`. The partner's bell (GET /partners/notifications)
     * filters on receiver_id, so the entry shows up there instead of
     * the admin feed. Templates can interpolate from the data chain
     * (e.g. "{{trigger.partner_id}}").
     */
    partner_id: z
      .string()
      .optional()
      .describe(
        "Partner UUID to target. Sets receiver_id so the notification lands in that partner's bell.",
      ),
    /**
     * Optional URL the bell entry links to (e.g. /production-runs/<id>).
     * Persisted under data.url so the bell renderer can pick it up.
     */
    url: z
      .string()
      .optional()
      .describe(
        "Optional URL the bell row links to when clicked.",
      ),
    to: z
      .string()
      .optional()
      .describe(
        "Channel-specific recipient. Defaults to partner_id when partner_id is set, else 'admin'.",
      ),
    channel: z.string().default("feed").describe("Notification channel"),
    /**
     * Useful for filtering in the partner UI (e.g. "product.updated",
     * "production_run.assigned"). Persisted on notification.trigger_type.
     */
    trigger_type: z
      .string()
      .optional()
      .describe("Event/workflow that produced this notification."),
    resource_type: z
      .string()
      .optional()
      .describe("What the notification is about (e.g. 'product')."),
    resource_id: z
      .string()
      .optional()
      .describe("ID of the resource the notification is about."),
    /**
     * Stable dedup key. Pass a value that uniquely identifies this
     * (event, recipient) pair so re-runs of the same flow don't
     * double-notify.
     */
    idempotency_key: z
      .string()
      .optional()
      .describe("Stable dedup key for re-runs."),
    data: z.record(z.string(), z.any()).optional().describe("Additional data"),
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
      const url = options.url
        ? interpolateString(options.url, context.dataChain)
        : undefined
      const partnerId = options.partner_id
        ? interpolateString(options.partner_id, context.dataChain)
        : undefined
      const explicitTo = options.to
        ? interpolateString(options.to, context.dataChain)
        : undefined
      const triggerType = options.trigger_type
        ? interpolateString(options.trigger_type, context.dataChain)
        : undefined
      const resourceType = options.resource_type
        ? interpolateString(options.resource_type, context.dataChain)
        : undefined
      const resourceId = options.resource_id
        ? interpolateString(options.resource_id, context.dataChain)
        : undefined
      const idempotencyKey = options.idempotency_key
        ? interpolateString(options.idempotency_key, context.dataChain)
        : undefined
      const extraData = options.data
        ? interpolateVariables(options.data, context.dataChain)
        : undefined

      const notificationService = context.container.resolve(Modules.NOTIFICATION)

      // When targeting a partner, set receiver_id so the partner bell
      // (which filters on receiver_id = partner.id) picks it up.
      // Default `to` to partner_id when not explicitly set — Medusa
      // requires `to` and the partner_id is the natural routing key.
      const to = explicitTo ?? partnerId ?? "admin"

      const notification = await notificationService.createNotifications({
        to,
        channel: options.channel || "feed",
        template: "visual-flow-notification",
        data: {
          title,
          description,
          url,
          flow_id: context.flowId,
          execution_id: context.executionId,
          ...extraData,
        },
        trigger_type: triggerType,
        resource_type: resourceType,
        resource_id: resourceId,
        receiver_id: partnerId,
        idempotency_key: idempotencyKey,
      } as any)

      return {
        success: true,
        data: {
          notification_id: notification.id,
          title,
          description,
          partner_id: partnerId,
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
