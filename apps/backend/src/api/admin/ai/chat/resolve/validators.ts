import { z as z } from "@medusajs/framework/zod"

/**
 * Validator for POST /admin/ai/chat/resolve
 * Resolves natural language queries into executable plans
 */
export const AdminAiChatResolveReq = z.object({
  query: z.string().min(1, "Query is required"),
  options: z.object({
    useIndexedFirst: z.boolean().optional(),
    skipLLM: z.boolean().optional(),
  }).optional(),
})

export type AdminAiChatResolveReqType = z.infer<typeof AdminAiChatResolveReq>

/**
 * Validator for GET /admin/ai/chat/resolve
 * Used for status check or search-only mode
 */
export const AdminAiChatResolveQuery = z.object({
  q: z.string().optional(),
})

export type AdminAiChatResolveQueryType = z.infer<typeof AdminAiChatResolveQuery>
