import { z } from "@medusajs/framework/zod"

/**
 * Body schema for POST /admin/partners/notifications/broadcast.
 *
 * `title` is the only required field. When `partner_ids` is omitted the
 * notification fans out to ALL partners (optionally narrowed by `status`).
 */
export const AdminBroadcastNotificationSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  /** Defaults to the in-app "feed" channel inside the route. */
  channel: z.string().optional(),
  /** When present, only these partners are notified (unknown ids dropped). */
  partner_ids: z.array(z.string()).optional(),
  /** Narrows the all-partners fan-out when no explicit ids are given. */
  status: z.enum(["active", "inactive", "pending"]).optional(),
  trigger_type: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

export type AdminBroadcastNotificationSchema = z.infer<
  typeof AdminBroadcastNotificationSchema
>
