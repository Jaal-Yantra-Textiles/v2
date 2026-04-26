import { z } from "zod"

export const CreateDesignOrderSchema = z.object({
  design_ids: z.array(z.string()).min(1),
  currency_code: z.string().length(3).optional(),
  price_overrides: z.record(z.string(), z.number().min(0)).optional(),
  override_currency: z.string().length(3).optional(),
})
