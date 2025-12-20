import { z } from "zod"

export const AdminRagSearchQuery = z.object({
  q: z.string().min(1, { message: "q is required" }),
  method: z.string().optional(),
  topK: z.preprocess((val) => {
    if (typeof val === "string" && val.length) {
      const n = Number(val)
      return Number.isFinite(n) ? n : undefined
    }
    return val
  }, z.number().int().min(1).max(50).optional()),
})

export type AdminRagSearchQueryType = z.infer<typeof AdminRagSearchQuery>
