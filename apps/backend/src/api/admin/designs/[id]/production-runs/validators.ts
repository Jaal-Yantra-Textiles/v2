import { z } from "@medusajs/framework/zod"

const ProductionAssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  quantity: z.number().positive(),
  order: z.number().int().positive().optional(),
  // See production-runs/validators.ts for the rationale. The admin UI's
  // "Send to production" toggle sends `template_names: null` when no
  // templates are picked — `.optional()` alone rejected that with
  // "Field is required" and never let the request reach the workflow.
  template_names: z.array(z.string()).nullish(),
})

export const AdminCreateDesignProductionRunSchema = z.object({
  quantity: z.number().positive().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
  assignments: z.array(ProductionAssignmentSchema).min(1).optional(),
})

export type AdminCreateDesignProductionRunReq = z.infer<
  typeof AdminCreateDesignProductionRunSchema
>
