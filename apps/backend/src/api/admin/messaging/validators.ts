import { z } from "@medusajs/framework/zod"

export const ListConversationsQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  partner_id: z.string().optional(),
  status: z.enum(["active", "archived"]).optional(),
})

export const ListMessagesQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
})

export const SendMessageSchema = z.object({
  content: z.string().min(1),
  context_type: z.enum(["production_run", "inventory_item", "design"]).optional(),
  context_id: z.string().optional(),
  media_url: z.string().optional(),
  media_mime_type: z.string().optional(),
  media_filename: z.string().optional(),
  reply_to_id: z.string().optional(),
})

export const CreateConversationSchema = z.object({
  partner_id: z.string(),
  phone_number: z.string(),
  title: z.string().optional(),
})

export type SendMessageInput = z.infer<typeof SendMessageSchema>
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>

/**
 * #2138 — asking a partner for photos AND recording what they will be for.
 *
 * 🔴 The kinds are an ENUM, not a string. `product_submission` is the exact
 * value the product-create flow's eligibility gates on, so a typo would not
 * fail — it would route photos nowhere, silently and forever. `document` is
 * absent on purpose: it has no typed destination, and the route refuses it
 * with the reason rather than filing a document into a catchall.
 */
export const RequestPartnerPhotosSchema = z.object({
  kind: z.enum(["inventory_offer", "product_submission", "run_progress"]),
  note: z.string().max(500).optional(),
  message: z.string().max(1500).optional(),
  // Bounded here as well as in resolveContextExpiry — a validator that accepts
  // 10_000 hours and relies on the handler to clamp it is one refactor away
  // from a context that never expires.
  ttl_hours: z.number().int().positive().max(24 * 7).optional(),
})
