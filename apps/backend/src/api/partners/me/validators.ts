import { z } from "@medusajs/framework/zod"

export const updatePartnerMeSchema = z
  .object({
    first_name: z.string().min(1).max(120).optional(),
    last_name: z.string().min(1).max(120).optional(),
    phone: z.string().min(1).max(40).nullable().optional(),
    preferred_language: z.string().min(2).max(10).nullable().optional(),
  })
  .strict()

export type UpdatePartnerMeInput = z.infer<typeof updatePartnerMeSchema>

// Phone login PIN (#2320). Strength rules live in the workflow (pinProblem) so
// the message names what is wrong; this only bounds the shape.
export const setPartnerMePinSchema = z
  .object({
    pin: z.string().min(1).max(12),
  })
  .strict()

export type SetPartnerMePinInput = z.infer<typeof setPartnerMePinSchema>
