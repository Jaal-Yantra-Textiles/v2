import { z } from "zod"

export const CreateDesignOrderSchema = z.object({
  design_ids: z.array(z.string()).min(1),
  currency_code: z.string().length(3).optional(),
  price_overrides: z.record(z.string(), z.number().min(0)).optional(),
  override_currency: z.string().length(3).optional(),
})

/**
 * The customer-less twin (#1817). Same body, plus an OPTIONAL customer —
 * `/admin/designs/draft-order` has no id in its path, so if a buyer is known
 * it travels in the body instead.
 */
export const CreateDesignDraftOrderSchema = CreateDesignOrderSchema.extend({
  customer_id: z.string().min(1).nullish(),
})
