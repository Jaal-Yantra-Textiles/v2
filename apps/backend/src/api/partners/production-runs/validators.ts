import { z } from "@medusajs/framework/zod"

import { includeCancelledQueryParam } from "../../../lib/partner-cancelled-visibility"

export const listProductionRunsQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  status: z.string().optional(),
  role: z.string().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
  design_id: z.string().optional(),
  /** Cancelled runs are hidden unless this is "true" or `status` names them. */
  include_cancelled: includeCancelledQueryParam,
})

export type ListProductionRunsQuery = z.infer<typeof listProductionRunsQuerySchema>
