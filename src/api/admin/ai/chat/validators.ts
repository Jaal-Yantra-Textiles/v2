import { z } from "zod"

export const AdminGeneralChatReq = z.object({
  message: z.string().min(1, { message: "message is required" }),
  // Memory context
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  // Additional context to pass to the agent
  context: z.record(z.any()).optional(),
})

export type AdminGeneralChatReqType = z.infer<typeof AdminGeneralChatReq>

// Streaming via SSE typically uses GET + query params. Provide a query validator.
export const AdminGeneralChatStreamQuery = z.object({
  message: z.string().min(1, { message: "message is required" }),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z
    .preprocess((val) => {
      if (typeof val === "string" && val.length) {
        try {
          return JSON.parse(val)
        } catch {
          return undefined
        }
      }
      return val
    }, z.record(z.any()).optional()),
})

export type AdminGeneralChatStreamQueryType = z.infer<typeof AdminGeneralChatStreamQuery>
