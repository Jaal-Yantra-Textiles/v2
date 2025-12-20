import { z } from "zod"

export const AdminAiV2ChatReq = z.object({
  message: z.string().min(1),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z.record(z.any()).optional(),
})

export type AdminAiV2ChatReqType = z.infer<typeof AdminAiV2ChatReq>

export const AdminAiV2ChatStreamQuery = z.object({
  message: z.string().min(1),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z.preprocess((val) => {
    if (typeof val === "string" && val.trim()) {
      try {
        return JSON.parse(val)
      } catch {
        return undefined
      }
    }
    return val
  }, z.record(z.any()).optional()),
})

export type AdminAiV2ChatStreamQueryType = z.infer<typeof AdminAiV2ChatStreamQuery>
