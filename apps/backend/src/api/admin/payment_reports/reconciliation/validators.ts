import { z } from "zod"

export const ListReconciliationsQuerySchema = z.object({
  status: z
    .enum(["Pending", "Matched", "Discrepant", "Settled", "Waived"])
    .optional(),
  partner_id: z.string().optional(),
  reference_type: z
    .enum(["payment_submission", "inventory_order", "manual"])
    .optional(),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
})

export const CreateReconciliationSchema = z.object({
  reference_type: z.enum(["payment_submission", "inventory_order", "manual"]),
  reference_id: z.string().optional(),
  partner_id: z.string().optional(),
  expected_amount: z.number(),
  actual_amount: z.number().optional(),
  payment_id: z.string().optional(),
  notes: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export const UpdateReconciliationSchema = z.object({
  actual_amount: z.number().optional(),
  status: z
    .enum(["Pending", "Matched", "Discrepant", "Settled", "Waived"])
    .optional(),
  notes: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export const SettleReconciliationSchema = z.object({
  notes: z.string().optional(),
})
