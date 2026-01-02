import { z } from "zod"

const AssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  quantity: z.number().optional(),
})

export const AdminCreateProductionRunReq = z.object({
  design_id: z.string().min(1),
  partner_id: z.string().optional(),
  quantity: z.number().optional(),
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  order_id: z.string().optional(),
  order_line_item_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export const AdminApproveProductionRunReq = z.object({
  assignments: z.array(AssignmentSchema).optional(),
})

export const AdminSendProductionRunToProductionReq = z.object({
  template_names: z.array(z.string()).min(1),
})

export const AdminStartDispatchProductionRunReq = z.object({})

export const AdminResumeDispatchProductionRunReq = z.object({
  template_names: z.array(z.string()).min(1),
  transaction_id: z.string().min(1),
})

export type AdminCreateProductionRunReq = z.infer<typeof AdminCreateProductionRunReq>
export type AdminApproveProductionRunReq = z.infer<typeof AdminApproveProductionRunReq>
export type AdminSendProductionRunToProductionReq = z.infer<typeof AdminSendProductionRunToProductionReq>
export type AdminStartDispatchProductionRunReq = z.infer<typeof AdminStartDispatchProductionRunReq>
export type AdminResumeDispatchProductionRunReq = z.infer<typeof AdminResumeDispatchProductionRunReq>
