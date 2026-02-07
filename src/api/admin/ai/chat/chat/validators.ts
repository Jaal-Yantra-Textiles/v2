import { z as z } from "zod"

/**
 * Clarification option schema (for response)
 */
export const ClarificationOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  module: z.string(),
  apiPath: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

export type ClarificationOptionType = z.infer<typeof ClarificationOptionSchema>

/**
 * Clarification context schema (for request - user selection)
 */
export const ClarificationContextSchema = z.object({
  selectedOptionId: z.string(),
  selectedModule: z.string(),
  originalQuery: z.string(),
})

export type ClarificationContextType = z.infer<typeof ClarificationContextSchema>

/**
 * Validator for POST /admin/ai/chat
 */
export const AdminAiChatReq = z.object({
  message: z.string().min(1, "Message is required"),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  // Human-in-the-loop: clarification from previous interaction
  clarification: ClarificationContextSchema.optional(),
})

export type AdminAiChatReqType = z.infer<typeof AdminAiChatReq>

/**
 * Validator for GET /admin/ai/chat/stream
 */
export const AdminAiChatStreamQuery = z.object({
  threadId: z.string().optional(),
})

export type AdminAiChatStreamQueryType = z.infer<typeof AdminAiChatStreamQuery>
