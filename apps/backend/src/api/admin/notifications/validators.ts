import { z } from "@medusajs/framework/zod"

export const AdminNotificationsQueryParams = z.object({
  limit: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(1).max(200).default(20)
  ),
  offset: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(0).default(0)
  ),
  q: z.string().optional(),
  channel: z.union([z.string(), z.array(z.string())]).optional(),
  status: z.preprocess(
    (val) => (Array.isArray(val) ? val[0] : val),
    z.enum(["pending", "success", "failure"]).optional()
  ),
  id: z.union([z.string(), z.array(z.string())]).optional(),
  /** Only this recipient's rows (a partner id), e.g. to see what a partner was told. */
  receiver_id: z.string().optional(),
  /** With channel=feed, include partner-scoped rows (hidden by default). */
  include_partner: z.preprocess((v) => (v === "true" || v === true ? "true" : undefined), z.string().optional()),
  // IMPORTANT: keep as string. Medusa's internal query config builder expects a string and calls fields.split(",").
  fields: z.string().optional(),
})

export type AdminNotificationsQueryParams = z.infer<typeof AdminNotificationsQueryParams>
