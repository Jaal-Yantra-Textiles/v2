import { z } from "@medusajs/framework/zod"

const AssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  quantity: z.number().optional(),
  order: z.number().int().positive().optional(),
  // `.nullish()` (= optional + nullable) accepts undefined, null, or
  // an array. The admin UI sends `null` when the "Send to production"
  // toggle is on but no templates are picked — `.optional()` alone
  // rejected that with "Field is required" and never let the request
  // reach the workflow, so the run was never created and no WhatsApp
  // fired. With null/empty the auto-dispatch loop in the route handler
  // skips dispatch — the run lands in `approved`/idle.
  template_names: z.array(z.string()).nullish(),
})

export const AdminCreateProductionRunReq = z.object({
  design_id: z.string().min(1),
  partner_id: z.string().optional(),
  quantity: z.number().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  order_id: z.string().optional(),
  order_line_item_id: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const AdminApproveProductionRunReq = z.object({
  assignments: z.array(AssignmentSchema).optional(),
})

export const AdminSendProductionRunToProductionReq = z.object({
  template_names: z.array(z.string()).min(1),
})

export const AdminStartDispatchProductionRunReq = z.object({})

export const AdminCancelProductionRunReq = z.object({
  reason: z.string().optional(),
})

export const AdminResumeDispatchProductionRunReq = z.object({
  template_names: z.array(z.string()).min(1),
  transaction_id: z.string().min(1),
})

export type AdminCreateProductionRunReq = z.infer<typeof AdminCreateProductionRunReq>
export type AdminApproveProductionRunReq = z.infer<typeof AdminApproveProductionRunReq>
export type AdminSendProductionRunToProductionReq = z.infer<typeof AdminSendProductionRunToProductionReq>
export type AdminStartDispatchProductionRunReq = z.infer<typeof AdminStartDispatchProductionRunReq>
export type AdminResumeDispatchProductionRunReq = z.infer<typeof AdminResumeDispatchProductionRunReq>
