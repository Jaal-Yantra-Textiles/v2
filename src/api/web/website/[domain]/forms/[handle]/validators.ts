import { z } from "@medusajs/framework/zod"

export const webSubmitFormResponseSchema = z.object({
  email: z.string().email().nullable().optional(),
  data: z.record(z.any()),
  page_url: z.string().nullable().optional(),
  referrer: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
})

export type WebSubmitFormResponse = z.infer<typeof webSubmitFormResponseSchema>

export const webVerifyFormResponseSchema = z.object({
  response_id: z.string().min(1),
  code: z.string().length(6),
})

export type WebVerifyFormResponse = z.infer<typeof webVerifyFormResponseSchema>
