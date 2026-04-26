import { z } from "@medusajs/framework/zod"

// ─── Shared date-range params (used by all live-reporting routes) ─────────────

export const ReportingQuerySchema = z.object({
  period_start: z.string().optional(),   // ISO 8601 date string
  period_end:   z.string().optional(),
  status:       z.enum(["Pending", "Processing", "Completed", "Failed", "Cancelled"]).optional(),
  payment_type: z.enum(["Bank", "Cash", "Digital_Wallet"]).optional(),
  limit:        z.coerce.number().min(1).max(500).optional().default(100),
  offset:       z.coerce.number().min(0).optional().default(0),
})
export type ReportingQuery = z.infer<typeof ReportingQuerySchema>

// ─── POST /admin/payment_reports — generate + persist a snapshot ──────────────

export const CreatePaymentReportSchema = z.object({
  name:         z.string().optional(),
  period_start: z.string(),              // required for snapshots
  period_end:   z.string(),
  entity_type:  z.enum(["all", "partner", "person"]).default("all"),
  entity_id:    z.string().optional(),   // required when entity_type != "all"
  status:       z.enum(["Pending", "Processing", "Completed", "Failed", "Cancelled"]).optional(),
  payment_type: z.enum(["Bank", "Cash", "Digital_Wallet"]).optional(),
  metadata:     z.record(z.any()).optional(),
})
export type CreatePaymentReport = z.infer<typeof CreatePaymentReportSchema>

// ─── List saved reports ───────────────────────────────────────────────────────

export const ListPaymentReportsQuerySchema = z.object({
  entity_type: z.enum(["all", "partner", "person"]).optional(),
  entity_id:   z.string().optional(),
  limit:       z.coerce.number().min(1).max(200).optional().default(20),
  offset:      z.coerce.number().min(0).optional().default(0),
})
export type ListPaymentReportsQuery = z.infer<typeof ListPaymentReportsQuerySchema>

// ─── Aliases used by generated route boilerplate ─────────────────────────────

export type Payment_report = CreatePaymentReport

// ─── PATCH /admin/payment_reports/:id ────────────────────────────────────────

export const UpdatePaymentReportSchema = z.object({
  name:     z.string().optional(),
  metadata: z.record(z.any()).optional(),
})
export type UpdatePayment_report = z.infer<typeof UpdatePaymentReportSchema>
