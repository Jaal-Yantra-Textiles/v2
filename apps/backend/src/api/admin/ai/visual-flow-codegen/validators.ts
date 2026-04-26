import { z } from "@medusajs/framework/zod"

export const AdminVisualFlowCodegenReq = z.object({
  prompt: z.string().min(1, { message: "prompt is required" }),
  context: z.record(z.any()).optional(),
  desiredOutputKeys: z.array(z.string()).optional(),
  allowExternalPackages: z.boolean().optional(),
  // Optional memory routing
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
})

export type AdminVisualFlowCodegenReqType = z.infer<typeof AdminVisualFlowCodegenReq>
