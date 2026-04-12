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
})

export const CreateConversationSchema = z.object({
  partner_id: z.string(),
  phone_number: z.string(),
  title: z.string().optional(),
})

export type SendMessageInput = z.infer<typeof SendMessageSchema>
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>
