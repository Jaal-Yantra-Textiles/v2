import { z } from "zod"

export const LinkDesignsToCustomerSchema = z.object({
  design_ids: z.array(z.string()).min(1),
})
