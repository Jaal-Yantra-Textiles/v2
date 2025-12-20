import { z } from "zod"

export const AdminAiV2ResumeReq = z.object({
  step: z.string().optional(),
  resumeData: z
    .object({
      confirmed: z.boolean().optional(),
      request: z
        .object({
          method: z.string().optional(),
          path: z.string().optional(),
          query: z.record(z.any()).optional(),
          body: z.record(z.any()).optional(),
        })
        .optional(),
      context: z.record(z.any()).optional(),
    })
    .optional(),
})

export type AdminAiV2ResumeReqType = z.infer<typeof AdminAiV2ResumeReq>
